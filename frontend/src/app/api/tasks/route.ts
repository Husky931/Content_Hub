import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  tasks,
  channels,
  users,
  attempts,
  messages,
  notifications,
  userTags,
  appeals,
} from "@/db/schema";
import { getAuthFromCookies } from "@/lib/auth";
import { eq, and, desc, asc, sql, inArray } from "drizzle-orm";
import { publishSystemMessage, publishTaskUpdate } from "@/lib/ws-publish";
import { translateText } from "@/lib/llm";

// GET /api/tasks — list tasks (with filters)
export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthFromCookies();
    if (!auth) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const channelSlug = searchParams.get("channel");
    const status = searchParams.get("status");
    const sort = searchParams.get("sort") || "newest";
    const search = searchParams.get("search");

    // Build query conditions
    const conditions = [];

    if (channelSlug) {
      const [ch] = await db
        .select({ id: channels.id })
        .from(channels)
        .where(eq(channels.slug, channelSlug))
        .limit(1);
      if (ch) {
        conditions.push(eq(tasks.channelId, ch.id));
      }
    }

    if (status) {
      conditions.push(eq(tasks.status, status as any));
    }

    // Only show non-draft tasks to non-admin/mod
    if (!["admin", "supermod", "mod"].includes(auth.role)) {
      conditions.push(sql`${tasks.status} != 'draft'`);
    }

    // Filter tasks to only channels the user can access (tag-gating)
    if (!["supermod", "admin"].includes(auth.role)) {
      // Get user's tags
      const userTagRecords = await db
        .select({ tagId: userTags.tagId })
        .from(userTags)
        .where(eq(userTags.userId, auth.userId));
      const userTagIds = userTagRecords.map((t) => t.tagId);

      // Only show tasks from channels with no required tag, or where user has the tag
      if (userTagIds.length > 0) {
        conditions.push(
          sql`(${channels.requiredTagId} IS NULL OR ${channels.requiredTagId} IN (${sql.join(userTagIds.map(id => sql`${id}`), sql`,`)}))`
        );
      } else {
        conditions.push(sql`${channels.requiredTagId} IS NULL`);
      }
    }

    // Lazy lock expiry: auto-unlock any LOCKED tasks where lockExpiresAt has passed
    const expiredLocks = await db
      .select({ id: tasks.id, channelId: tasks.channelId, title: tasks.title })
      .from(tasks)
      .where(
        and(
          eq(tasks.status, "locked"),
          sql`${tasks.lockExpiresAt} < NOW()`
        )
      );

    for (const expired of expiredLocks) {
      await db
        .update(tasks)
        .set({
          status: "active",
          lockedById: null,
          lockExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, expired.id));

      // Post system message about auto-unlock
      const [ch] = await db
        .select({ slug: channels.slug })
        .from(channels)
        .where(eq(channels.id, expired.channelId))
        .limit(1);

      await db.insert(messages).values({
        channelId: expired.channelId,
        userId: auth.userId,
        type: "system",
        content: `Lock expired on "${expired.title}" — task reopened for all creators`,
      });

      if (ch?.slug) {
        publishTaskUpdate(ch.slug, { id: expired.id, status: "active", lockedById: null, lockExpiresAt: null });
      }
    }

    const whereClause =
      conditions.length > 0 ? and(...conditions) : undefined;

    // Sort
    const orderBy =
      sort === "pay"
        ? desc(tasks.bountyUsd)
        : sort === "deadline"
        ? asc(tasks.deadline)
        : desc(tasks.createdAt);

    const taskRows = await db
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
        createdAt: tasks.createdAt,
        source: tasks.source,
        checklist: tasks.checklist,
        selfChecklist: tasks.selfChecklist,
        attachments: tasks.attachments,
        deliverableSlots: tasks.deliverableSlots,
        channelName: channels.name,
        channelSlug: channels.slug,
        createdByUsername: users.username,
        createdByDisplayName: users.displayName,
        lockedById: tasks.lockedById,
        lockExpiresAt: tasks.lockExpiresAt,
      })
      .from(tasks)
      .innerJoin(channels, eq(tasks.channelId, channels.id))
      .innerJoin(users, eq(tasks.createdById, users.id))
      .where(whereClause)
      .orderBy(orderBy)
      .limit(100);

    // Filter by search
    let filtered = taskRows;
    if (search) {
      const q = search.toLowerCase();
      filtered = taskRows.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.titleCn && t.titleCn.toLowerCase().includes(q)) ||
          t.description.toLowerCase().includes(q)
      );
    }

    // Get attempt counts for each task
    const taskIds = filtered.map((t) => t.id);
    let attemptCounts: Record<string, number> = {};
    if (taskIds.length > 0) {
      const counts = await db
        .select({
          taskId: attempts.taskId,
          count: sql<number>`count(*)::int`,
        })
        .from(attempts)
        .where(inArray(attempts.taskId, taskIds))
        .groupBy(attempts.taskId);
      for (const c of counts) {
        attemptCounts[c.taskId] = c.count;
      }
    }

    // Get per-user attempt counts (how many attempts the current user has made)
    let myAttemptCounts: Record<string, number> = {};
    if (taskIds.length > 0) {
      const myCounts = await db
        .select({
          taskId: attempts.taskId,
          count: sql<number>`count(*)::int`,
        })
        .from(attempts)
        .where(
          and(
            inArray(attempts.taskId, taskIds),
            eq(attempts.userId, auth.userId)
          )
        )
        .groupBy(attempts.taskId);
      for (const c of myCounts) {
        myAttemptCounts[c.taskId] = c.count;
      }
    }

    // Get submitted attempts by OTHER users (pending review) — for "Others Currently Attempting"
    let submittedCounts: Record<string, number> = {};
    let othersAttempting: Record<string, { username: string; displayName: string | null; avatarUrl: string | null; createdAt: Date }[]> = {};
    if (taskIds.length > 0) {
      const submitted = await db
        .select({
          taskId: attempts.taskId,
          username: users.username,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
          createdAt: attempts.createdAt,
        })
        .from(attempts)
        .innerJoin(users, eq(attempts.userId, users.id))
        .where(
          and(
            inArray(attempts.taskId, taskIds),
            eq(attempts.status, "submitted"),
            sql`${attempts.userId} != ${auth.userId}`
          )
        )
        .orderBy(desc(attempts.createdAt));
      for (const s of submitted) {
        submittedCounts[s.taskId] = (submittedCounts[s.taskId] || 0) + 1;
        if (!othersAttempting[s.taskId]) othersAttempting[s.taskId] = [];
        othersAttempting[s.taskId].push({
          username: s.username,
          displayName: s.displayName,
          avatarUrl: s.avatarUrl,
          createdAt: s.createdAt,
        });
      }
    }

    // Get current user's latest attempt for each task
    let myAttempts: Record<string, { id: string; status: string; deliverables: any }> = {};
    // Also get ALL user attempts per task for the "Your Previous Attempts" section
    let myAllAttempts: Record<string, { id: string; status: string; deliverables: any; rejectionReason: string | null; reviewNote: string | null; createdAt: Date }[]> = {};
    if (taskIds.length > 0) {
      const userAttempts = await db
        .select({
          id: attempts.id,
          taskId: attempts.taskId,
          status: attempts.status,
          deliverables: attempts.deliverables,
          rejectionReason: attempts.rejectionReason,
          reviewNote: attempts.reviewNote,
          createdAt: attempts.createdAt,
        })
        .from(attempts)
        .where(
          and(
            inArray(attempts.taskId, taskIds),
            eq(attempts.userId, auth.userId)
          )
        )
        .orderBy(desc(attempts.createdAt));

      // Keep only the latest attempt per task + collect all attempts
      for (const a of userAttempts) {
        if (!myAttempts[a.taskId]) {
          myAttempts[a.taskId] = { id: a.id, status: a.status, deliverables: a.deliverables };
        }
        if (!myAllAttempts[a.taskId]) myAllAttempts[a.taskId] = [];
        myAllAttempts[a.taskId].push({
          id: a.id,
          status: a.status,
          deliverables: a.deliverables,
          rejectionReason: a.rejectionReason,
          reviewNote: a.reviewNote,
          createdAt: a.createdAt,
        });
      }
    }

    // Get current user's appeal status for their attempts (so UI knows if appeal was filed)
    const myAttemptIds = Object.values(myAttempts).map((a) => a.id);
    let myAppealStatuses: Record<string, string> = {};
    if (myAttemptIds.length > 0) {
      const userAppeals = await db
        .select({
          attemptId: appeals.attemptId,
          status: appeals.status,
        })
        .from(appeals)
        .where(
          and(
            inArray(appeals.attemptId, myAttemptIds),
            eq(appeals.userId, auth.userId)
          )
        );
      for (const a of userAppeals) {
        myAppealStatuses[a.attemptId] = a.status;
      }
    }

    return NextResponse.json({
      tasks: filtered.map((t) => {
        const myAttempt = myAttempts[t.id] || null;
        return {
          ...t,
          attemptCount: attemptCounts[t.id] || 0,
          myAttemptCount: myAttemptCounts[t.id] || 0,
          myAttempt: myAttempt
            ? { ...myAttempt, appealStatus: myAppealStatuses[myAttempt.id] || null }
            : null,
          submittedCount: submittedCounts[t.id] || 0,
          othersAttempting: othersAttempting[t.id] || [],
          myAllAttempts: myAllAttempts[t.id] || [],
        };
      }),
    });
  } catch (error) {
    console.error("List tasks error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST /api/tasks — create a new task (admin/mod/supermod)
export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthFromCookies();
    if (!auth) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    if (!["admin", "supermod", "mod"].includes(auth.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const {
      channelId,
      title,
      titleCn,
      description,
      descriptionCn,
      bountyUsd,
      bountyRmb,
      bonusBountyUsd,
      bonusBountyRmb,
      maxAttempts,
      deadline,
      status: taskStatus,
      checklist,
      selfChecklist,
      attachments,
      deliverableSlots,
    } = body;

    if (!channelId || !title || !description) {
      return NextResponse.json(
        { error: "channelId, title, and description are required" },
        { status: 400 }
      );
    }

    // Auto-translate missing language fields via LLM
    let resolvedTitleCn = titleCn || null;
    let resolvedDescriptionCn = descriptionCn || null;

    try {
      if (title && !titleCn) {
        // English title provided, no Chinese — translate to Chinese
        resolvedTitleCn = await translateText(title, "en", "zh");
      }
      if (description && !descriptionCn) {
        resolvedDescriptionCn = await translateText(description, "en", "zh");
      }
    } catch (err) {
      // Translation failure is non-blocking — proceed without translations
      console.error("[task-create] Auto-translation failed:", err);
    }

    // Verify channel exists and is a task channel
    const [channel] = await db
      .select()
      .from(channels)
      .where(eq(channels.id, channelId))
      .limit(1);

    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    if (channel.type !== "task") {
      return NextResponse.json(
        { error: "Tasks can only be created in task channels" },
        { status: 400 }
      );
    }

    const [newTask] = await db
      .insert(tasks)
      .values({
        channelId,
        createdById: auth.userId,
        title,
        titleCn: resolvedTitleCn,
        description,
        descriptionCn: resolvedDescriptionCn,
        bountyUsd: bountyUsd || null,
        bountyRmb: bountyRmb || null,
        bonusBountyUsd: bonusBountyUsd || null,
        bonusBountyRmb: bonusBountyRmb || null,
        maxAttempts: maxAttempts || 5,
        deadline: deadline ? new Date(deadline) : null,
        status: taskStatus === "active" ? "active" : "draft",
        checklist: Array.isArray(checklist) ? checklist : null,
        selfChecklist: Array.isArray(selfChecklist) ? selfChecklist : null,
        attachments: Array.isArray(attachments) ? attachments : null,
        deliverableSlots: Array.isArray(deliverableSlots) ? deliverableSlots : null,
      })
      .returning();

    // If published as active, post system message + notify channel users
    if (newTask.status === "active") {
      // Get creator display name
      const [creator] = await db
        .select({ username: users.username, displayName: users.displayName })
        .from(users)
        .where(eq(users.id, auth.userId))
        .limit(1);
      const creatorName = creator.displayName || creator.username;

      const sysContent = `${creatorName} posted a new task "${title}". Bounty: $${bountyUsd || "0"} / ¥${bountyRmb || "0"}`;
      const sysMsg = await postTaskSystemMessage(channel.id, auth.userId, sysContent);

      // Notify users who have the required tag (if any)
      await notifyChannelUsers(channel, newTask.id, title);

      // Real-time broadcast (must await on serverless)
      await Promise.all([
        publishSystemMessage(channel.slug, { id: sysMsg.id, type: "system", content: sysContent, createdAt: sysMsg.createdAt }),
        publishTaskUpdate(channel.slug, { id: newTask.id, status: "active", title }),
      ]);
    }

    return NextResponse.json({ task: newTask }, { status: 201 });
  } catch (error) {
    console.error("Create task error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Helper: post a system message to a channel (returns inserted row for WS payload)
async function postTaskSystemMessage(
  channelId: string,
  userId: string,
  content: string
) {
  const [msg] = await db.insert(messages).values({
    channelId,
    userId,
    type: "system",
    content,
  }).returning();
  return msg;
}

// Helper: notify users who can see a task channel
async function notifyChannelUsers(
  channel: { id: string; slug: string; requiredTagId: string | null },
  taskId: string,
  taskTitle: string
) {
  try {
    let userIds: string[] = [];
    if (channel.requiredTagId) {
      const taggedUsers = await db
        .select({ userId: userTags.userId })
        .from(userTags)
        .where(eq(userTags.tagId, channel.requiredTagId));
      userIds = taggedUsers.map((u) => u.userId);
    }

    if (userIds.length > 0) {
      await db.insert(notifications).values(
        userIds.map((uid) => ({
          userId: uid,
          type: "new_task",
          title: "New task available",
          body: `"${taskTitle}" is now available in the channel.`,
          data: { taskId, channelId: channel.id, channelSlug: channel.slug },
        }))
      );
    }
  } catch (err) {
    console.error("Notify channel users error:", err);
  }
}
