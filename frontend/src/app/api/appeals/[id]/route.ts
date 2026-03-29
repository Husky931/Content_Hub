import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  appeals,
  attempts,
  tasks,
  channels,
  users,
  messages,
  notifications,
} from "@/db/schema";
import { getAuthFromCookies } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { publishMessage, publishNotification, publishTaskUpdate } from "@/lib/ws-publish";

/**
 * PATCH /api/appeals/[id] — Resolve an appeal (grant or deny)
 * Only mod/supermod/admin
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthFromCookies();
    if (!auth) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    if (!["mod", "supermod", "admin"].includes(auth.role)) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    const { id } = await params;
    const { status: newStatus, arbitratorNote } = await req.json();

    if (!newStatus || !["granted", "denied"].includes(newStatus)) {
      return NextResponse.json(
        { error: "Status must be 'granted' or 'denied'" },
        { status: 400 }
      );
    }

    // Get the appeal
    const [appeal] = await db
      .select()
      .from(appeals)
      .where(eq(appeals.id, id))
      .limit(1);

    if (!appeal) {
      return NextResponse.json(
        { error: "Appeal not found" },
        { status: 404 }
      );
    }

    if (appeal.status !== "pending") {
      return NextResponse.json(
        { error: "Appeal already resolved" },
        { status: 400 }
      );
    }

    // Get the attempt to check the original reviewer
    const [attemptForReviewerCheck] = await db
      .select({ reviewerId: attempts.reviewerId })
      .from(attempts)
      .where(eq(attempts.id, appeal.attemptId))
      .limit(1);

    // The original reviewer who rejected cannot be the appeal arbitrator
    if (attemptForReviewerCheck?.reviewerId === auth.userId) {
      return NextResponse.json(
        { error: "The original reviewer cannot arbitrate this appeal" },
        { status: 403 }
      );
    }

    // Update the appeal
    await db
      .update(appeals)
      .set({
        status: newStatus,
        arbitratorId: auth.userId,
        arbitratorNote: arbitratorNote?.trim() || null,
        resolvedAt: new Date(),
      })
      .where(eq(appeals.id, id));

    // Get attempt, task, and channel info
    const [attempt] = await db
      .select()
      .from(attempts)
      .where(eq(attempts.id, appeal.attemptId))
      .limit(1);

    const [task] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, attempt!.taskId))
      .limit(1);

    const [channel] = await db
      .select()
      .from(channels)
      .where(eq(channels.id, task!.channelId))
      .limit(1);

    const [appealUser] = await db
      .select({
        username: users.username,
        displayName: users.displayName,
      })
      .from(users)
      .where(eq(users.id, appeal.userId))
      .limit(1);

    const creatorName =
      appealUser?.displayName || appealUser?.username || "A creator";

    const [arbitratorUser] = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        role: users.role,
      })
      .from(users)
      .where(eq(users.id, auth.userId))
      .limit(1);

    if (newStatus === "granted") {
      // Uphold the appeal: revert attempt to "submitted" for re-review
      await db
        .update(attempts)
        .set({
          status: "submitted",
          reviewerId: null,
          reviewNote: null,
          rejectionReason: null,
          updatedAt: new Date(),
        })
        .where(eq(attempts.id, appeal.attemptId));

      // If task is not active, revert to active
      if (task && task.status !== "active") {
        await db
          .update(tasks)
          .set({ status: "active", updatedAt: new Date() })
          .where(eq(tasks.id, task.id));
      }

      // System message in the task's original channel
      if (channel) {
        const sysContent = `Appeal upheld for ${creatorName} on "${task?.title}" — re-submitted for review`;
        const [sysMsg] = await db
          .insert(messages)
          .values({
            channelId: channel.id,
            userId: auth.userId,
            type: "system",
            content: sysContent,
          })
          .returning();

        await publishMessage(channel.slug, {
          id: sysMsg.id,
          content: sysMsg.content,
          type: sysMsg.type,
          replyToId: null,
          replyCount: 0,
          createdAt: sysMsg.createdAt,
          user: arbitratorUser,
        });
      }

      // Broadcast task update to the task's channel (real-time TaskCard refresh)
      if (channel) {
        await publishTaskUpdate(channel.slug, { id: task?.id, status: task?.status });
      }

      // Notify creator
      const [notif] = await db
        .insert(notifications)
        .values({
          userId: appeal.userId,
          type: "appeal_granted",
          title: "Appeal upheld",
          body: `Your appeal for "${task?.title}" was upheld. Your submission has been re-submitted for review.`,
          data: {
            appealId: appeal.id,
            taskId: task?.id,
            channelSlug: channel?.slug,
          },
        })
        .returning();

      await publishNotification(appeal.userId, {
        type: "appeal_granted",
        title: notif.title,
        unreadCount: -1,
      });
    } else {
      // Deny the appeal: attempt stays rejected
      // Broadcast task update so creator's TaskCard shows denied state in real-time
      if (channel) {
        await publishTaskUpdate(channel.slug, { id: task?.id, status: task?.status });
      }

      // Notify creator
      const [notif] = await db
        .insert(notifications)
        .values({
          userId: appeal.userId,
          type: "appeal_denied",
          title: "Appeal denied",
          body: `Your appeal for "${task?.title}" was denied.${arbitratorNote ? ` Note: ${arbitratorNote.trim()}` : ""}`,
          data: {
            appealId: appeal.id,
            taskId: task?.id,
            channelSlug: channel?.slug,
          },
        })
        .returning();

      await publishNotification(appeal.userId, {
        type: "appeal_denied",
        title: notif.title,
        unreadCount: -1,
      });
    }

    // Post resolution message in #appeals channel
    const [appealsChannel] = await db
      .select({ id: channels.id })
      .from(channels)
      .where(eq(channels.slug, "appeals"))
      .limit(1);

    if (appealsChannel) {
      const resolutionContent =
        newStatus === "granted"
          ? `✅ Appeal by ${creatorName} for "${task?.title}" — UPHELD by ${arbitratorUser?.displayName || arbitratorUser?.username}`
          : `❌ Appeal by ${creatorName} for "${task?.title}" — DENIED by ${arbitratorUser?.displayName || arbitratorUser?.username}`;

      const [sysMsg] = await db
        .insert(messages)
        .values({
          channelId: appealsChannel.id,
          userId: auth.userId,
          type: "system",
          content: resolutionContent,
        })
        .returning();

      await publishMessage("appeals", {
        id: sysMsg.id,
        content: sysMsg.content,
        type: sysMsg.type,
        replyToId: null,
        replyCount: 0,
        createdAt: sysMsg.createdAt,
        user: arbitratorUser,
      });
    }

    return NextResponse.json({ success: true, status: newStatus });
  } catch (error) {
    console.error("Resolve appeal error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
