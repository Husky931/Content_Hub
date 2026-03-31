import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { tasks, users, channels, messages, notifications, attempts } from "@/db/schema";
import { getAuthFromCookies } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { publishSystemMessage, publishTaskUpdate, publishNotification } from "@/lib/ws-publish";

/**
 * POST /api/tasks/[taskId]/lock — Lock a task for exclusive 48h revision by a specific creator.
 * Body: { creatorId: string }
 * Only mod/supermod/admin.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const auth = await getAuthFromCookies();
    if (!auth) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!["mod", "supermod", "admin"].includes(auth.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { taskId } = await params;
    const { creatorId } = await req.json();

    if (!creatorId) {
      return NextResponse.json({ error: "creatorId is required" }, { status: 400 });
    }

    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (task.status !== "active") {
      return NextResponse.json(
        { error: "Can only lock active tasks" },
        { status: 400 }
      );
    }

    // Set lock: 48 hours from now
    const lockExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    await db
      .update(tasks)
      .set({
        status: "locked",
        lockedById: creatorId,
        lockExpiresAt,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, taskId));

    // Auto-reject the creator's submitted attempt so they can submit a revision
    await db
      .update(attempts)
      .set({
        status: "rejected",
        rejectionReason: "Locked for revision — please resubmit with improvements",
        reviewerId: auth.userId,
      })
      .where(
        and(
          eq(attempts.taskId, taskId),
          eq(attempts.userId, creatorId),
          eq(attempts.status, "submitted")
        )
      );

    // Get creator name
    const [creator] = await db
      .select({ username: users.username, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, creatorId))
      .limit(1);
    const creatorName = creator?.displayName || creator?.username || "A creator";

    // Get channel slug
    const [channel] = await db
      .select({ slug: channels.slug })
      .from(channels)
      .where(eq(channels.id, task.channelId))
      .limit(1);
    const channelSlug = channel?.slug;

    // Post system message
    const sysContent = `Task "${task.title}" locked for ${creatorName} — 48h exclusive revision`;
    const [sysMsg] = await db
      .insert(messages)
      .values({
        channelId: task.channelId,
        userId: auth.userId,
        type: "system",
        content: sysContent,
      })
      .returning();

    // Notify the locked creator
    const [notif] = await db
      .insert(notifications)
      .values({
        userId: creatorId,
        type: "task_locked",
        title: "Task locked for you",
        body: `You have 48 hours to revise your submission for "${task.title}"`,
        data: { taskId, channelSlug },
      })
      .returning();

    // Real-time broadcasts
    const publishes: Promise<void>[] = [];
    if (channelSlug) {
      publishes.push(
        publishSystemMessage(channelSlug, {
          id: sysMsg.id,
          type: "system",
          content: sysContent,
          createdAt: sysMsg.createdAt,
        }),
        publishTaskUpdate(channelSlug, {
          id: taskId,
          status: "locked",
          lockedById: creatorId,
          lockExpiresAt: lockExpiresAt.toISOString(),
        })
      );
    }
    publishes.push(
      publishNotification(creatorId, {
        type: "task_locked",
        title: notif.title,
        unreadCount: -1,
      })
    );
    await Promise.all(publishes);

    return NextResponse.json({
      success: true,
      lockExpiresAt: lockExpiresAt.toISOString(),
    });
  } catch (error) {
    console.error("Lock task error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
