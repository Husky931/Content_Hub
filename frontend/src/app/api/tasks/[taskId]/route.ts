import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { tasks, channels, users, attempts, messages, notifications, userTags, channelMods } from "@/db/schema";
import { getAuthFromCookies } from "@/lib/auth";
import { eq, and, sql } from "drizzle-orm";
import { publishSystemMessage, publishTaskUpdate } from "@/lib/ws-publish";
import { apiError } from "@/lib/api-error";

// GET /api/tasks/[taskId] — get task detail
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const auth = await getAuthFromCookies();
    if (!auth) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { taskId } = await params;

    const [task] = await db
      .select({
        id: tasks.id,
        channelId: tasks.channelId,
        title: tasks.title,
        titleCn: tasks.titleCn,
        description: tasks.description,
        descriptionCn: tasks.descriptionCn,
        status: tasks.status,
        bountyUsd: tasks.bountyUsd,
        bountyRmb: tasks.bountyRmb,
        bonusBountyUsd: tasks.bonusBountyUsd,
        bonusBountyRmb: tasks.bonusBountyRmb,
        maxAttempts: tasks.maxAttempts,
        deadline: tasks.deadline,
        checklist: tasks.checklist,
        selfChecklist: tasks.selfChecklist,
        attachments: tasks.attachments,
        deliverableSlots: tasks.deliverableSlots,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
        channelName: channels.name,
        channelSlug: channels.slug,
        createdByUsername: users.username,
        createdByDisplayName: users.displayName,
      })
      .from(tasks)
      .innerJoin(channels, eq(tasks.channelId, channels.id))
      .innerJoin(users, eq(tasks.createdById, users.id))
      .where(eq(tasks.id, taskId))
      .limit(1);

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Get attempts for this task
    const taskAttempts = await db
      .select({
        id: attempts.id,
        userId: attempts.userId,
        status: attempts.status,
        deliverables: attempts.deliverables,
        reviewNote: attempts.reviewNote,
        rejectionReason: attempts.rejectionReason,
        createdAt: attempts.createdAt,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
      })
      .from(attempts)
      .innerJoin(users, eq(attempts.userId, users.id))
      .where(eq(attempts.taskId, taskId))
      .orderBy(attempts.createdAt);

    return NextResponse.json({ task, attempts: taskAttempts });
  } catch (error) {
    return apiError("Get task", error);
  }
}

// PATCH /api/tasks/[taskId] — update task (admin/mod/supermod)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const auth = await getAuthFromCookies();
    if (!auth) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { taskId } = await params;
    const body = await req.json();

    const [existingTask] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);

    if (!existingTask) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Allow task creator to archive their own active task
    const isCreator = existingTask.createdById === auth.userId;
    const isCreatorArchiving =
      isCreator &&
      body.status === "archived" &&
      existingTask.status === "active" &&
      Object.keys(body).length === 1;

    if (!isCreatorArchiving && !["admin", "supermod", "mod"].includes(auth.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Non-admin roles can only update tasks from channels they are assigned to
    if (!isCreatorArchiving && (auth.role === "mod" || auth.role === "supermod")) {
      const [modAssignment] = await db
        .select({ id: channelMods.id })
        .from(channelMods)
        .where(
          and(
            eq(channelMods.channelId, existingTask.channelId),
            eq(channelMods.userId, auth.userId)
          )
        )
        .limit(1);
      if (!modAssignment) {
        return NextResponse.json(
          { error: "You are not assigned to this channel" },
          { status: 403 }
        );
      }
    }

    // Handle status transitions
    if (body.status) {
      const validTransitions: Record<string, string[]> = {
        draft: ["active", "archived"],
        active: ["approved", "archived"],
        approved: ["paid", "active", "archived"], // active = supermod reversal
        paid: ["archived"],
      };

      const allowed = validTransitions[existingTask.status] || [];
      if (!allowed.includes(body.status)) {
        return NextResponse.json(
          {
            error: `Cannot transition from ${existingTask.status} to ${body.status}`,
          },
          { status: 400 }
        );
      }

      // If activating from draft, post system message + notify
      if (existingTask.status === "draft" && body.status === "active") {
        const [channel] = await db
          .select()
          .from(channels)
          .where(eq(channels.id, existingTask.channelId))
          .limit(1);

        if (channel) {
          // Get publisher's display name
          const [publisher] = await db
            .select({ username: users.username, displayName: users.displayName })
            .from(users)
            .where(eq(users.id, auth.userId))
            .limit(1);
          const publisherName = publisher.displayName || publisher.username;

          const draftSysContent = `${publisherName} posted a new task "${existingTask.title}". Bounty: $${existingTask.bountyUsd || "0"} / ¥${existingTask.bountyRmb || "0"}`;
          const [draftSysMsg] = await db.insert(messages).values({
            channelId: channel.id,
            userId: auth.userId,
            type: "system",
            content: draftSysContent,
          }).returning();

          // Real-time broadcast (done here where we have the DB message data)
          await Promise.all([
            publishSystemMessage(channel.slug, { id: draftSysMsg.id, type: "system", content: draftSysContent, createdAt: draftSysMsg.createdAt }),
            publishTaskUpdate(channel.slug, { id: taskId, status: "active", title: existingTask.title }),
          ]);

          // Notify users who have the required tag
          if (channel.requiredTagId) {
            const taggedUsers = await db
              .select({ userId: userTags.userId })
              .from(userTags)
              .where(eq(userTags.tagId, channel.requiredTagId));

            if (taggedUsers.length > 0) {
              await db.insert(notifications).values(
                taggedUsers.map((u) => ({
                  userId: u.userId,
                  type: "new_task" as const,
                  title: "New task available",
                  body: `"${existingTask.title}" is now available in the channel.`,
                  data: { taskId, channelId: channel.id, channelSlug: channel.slug },
                }))
              );
            }
          }
        }
      }
    }

    // Build update object
    const updateData: Record<string, any> = { updatedAt: new Date() };
    const allowedFields = [
      "title",
      "titleCn",
      "description",
      "descriptionCn",
      "bountyUsd",
      "bountyRmb",
      "bonusBountyUsd",
      "bonusBountyRmb",
      "maxAttempts",
      "deadline",
      "status",
      "checklist",
      "selfChecklist",
      "attachments",
      "deliverableSlots",
    ];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        if (field === "deadline") {
          updateData[field] = body[field] ? new Date(body[field]) : null;
        } else {
          updateData[field] = body[field];
        }
      }
    }

    const [updated] = await db
      .update(tasks)
      .set(updateData)
      .where(eq(tasks.id, taskId))
      .returning();

    // Real-time: broadcast task updates
    // Note: draft→active broadcast is handled above in the status transition block
    const isDraftToActive = existingTask.status === "draft" && body.status === "active";
    if (!isDraftToActive && existingTask.status !== "draft") {
      const [ch] = await db
        .select({ slug: channels.slug })
        .from(channels)
        .where(eq(channels.id, existingTask.channelId))
        .limit(1);
      if (ch?.slug) {
        await publishTaskUpdate(ch.slug, { id: taskId, status: updated.status, title: updated.title });
      }
    }

    return NextResponse.json({ task: updated });
  } catch (error) {
    return apiError("Update task", error);
  }
}
