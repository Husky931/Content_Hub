import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  tasks,
  attempts,
  users,
  channels,
  messages,
  notifications,
  channelMods,
} from "@/db/schema";
import { getAuthFromCookies } from "@/lib/auth";
import { eq, and, sql } from "drizzle-orm";
import { publishSystemMessage, publishTaskUpdate, publishNotification } from "@/lib/ws-publish";
import { webhookAttemptSubmitted } from "@/lib/backend-webhook";
import { validateDeliverablesError } from "@/lib/validate-deliverables";
import { validateDeliverablesAsync } from "@/lib/validate-deliverables-server";
import type { DeliverableSlot } from "@/types/deliverable-slot";

// POST /api/tasks/[taskId]/attempts — submit an attempt (creator)
export async function POST(
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
    const { deliverables } = body;

    if (!deliverables || (typeof deliverables === "object" && Object.keys(deliverables).length === 0)) {
      return NextResponse.json(
        { error: "Deliverables are required" },
        { status: 400 }
      );
    }

    // Get the task
    const [task] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Locked tasks: only the locked creator can submit (revision attempt)
    // Also enforce lock expiry — if the lock has expired, auto-unlock the task
    if (task.status === "locked" && task.lockExpiresAt && new Date(task.lockExpiresAt) < new Date()) {
      await db
        .update(tasks)
        .set({
          status: "active",
          lockedById: null,
          lockExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, taskId));
      task.status = "active";
      task.lockedById = null;
      task.lockExpiresAt = null;
    }

    const isLockedForUser =
      task.status === "locked" && task.lockedById === auth.userId;

    if (task.status !== "active" && !isLockedForUser) {
      return NextResponse.json(
        { error: "Task is not accepting submissions" },
        { status: 400 }
      );
    }

    // Check if deadline passed
    if (task.deadline && new Date(task.deadline) < new Date()) {
      return NextResponse.json(
        { error: "Task deadline has passed" },
        { status: 400 }
      );
    }

    // Count user's existing attempts on this task
    const [attemptCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(attempts)
      .where(
        and(eq(attempts.taskId, taskId), eq(attempts.userId, auth.userId))
      );

    // Locked revision attempts don't count against maxAttempts
    if (!isLockedForUser && attemptCount.count >= task.maxAttempts) {
      return NextResponse.json(
        { error: `Maximum attempts (${task.maxAttempts}) reached` },
        { status: 400 }
      );
    }

    // Check if user has a blocked attempt
    const [blockedAttempt] = await db
      .select({ id: attempts.id })
      .from(attempts)
      .where(
        and(
          eq(attempts.taskId, taskId),
          eq(attempts.userId, auth.userId),
          eq(attempts.status, "blocked")
        )
      )
      .limit(1);

    if (blockedAttempt) {
      return NextResponse.json(
        { error: "You are blocked from this task" },
        { status: 403 }
      );
    }

    // Validate deliverables against slot definitions
    const taskSlots = task.deliverableSlots as DeliverableSlot[] | null;
    if (taskSlots && taskSlots.length > 0 && deliverables?.slots) {
      // Phase 1: metadata checks (file size, extensions, text, selections, rating)
      const validationError = validateDeliverablesError(taskSlots, deliverables.slots);
      if (validationError) {
        return NextResponse.json(
          { error: validationError },
          { status: 400 }
        );
      }

      // Phase 2+3: file-content checks (TSV columns, SRT parsing, image/video/audio probing)
      try {
        const asyncResults = await validateDeliverablesAsync(taskSlots, deliverables.slots);
        const asyncFailure = asyncResults.find((r) => !r.passed);
        if (asyncFailure) {
          return NextResponse.json(
            { error: `${asyncFailure.slotTitle}: ${asyncFailure.detail || asyncFailure.check}` },
            { status: 400 }
          );
        }
      } catch {
        // If file-content validation fails to run (e.g. file unreachable), don't block submission
      }
    }

    // Create the attempt
    const [newAttempt] = await db
      .insert(attempts)
      .values({
        taskId,
        userId: auth.userId,
        deliverables,
        status: "submitted",
      })
      .returning();

    // Get user info for system message + webhook
    const [submitter] = await db
      .select({ username: users.username, displayName: users.displayName, email: users.email })
      .from(users)
      .where(eq(users.id, auth.userId))
      .limit(1);

    const displayName = submitter.displayName || submitter.username;

    // Post system message to channel
    const sysContent = `${displayName} submitted an attempt for "${task.title}"`;
    const [sysMsg] = await db.insert(messages).values({
      channelId: task.channelId,
      userId: auth.userId,
      type: "system",
      content: sysContent,
    }).returning();

    // Get channel slug for notification navigation
    const [channel] = await db
      .select({ slug: channels.slug })
      .from(channels)
      .where(eq(channels.id, task.channelId))
      .limit(1);

    // Notify the task creator (mod) about the new submission
    if (task.createdById !== auth.userId) {
      await db.insert(notifications).values({
        userId: task.createdById,
        type: "attempt_submitted",
        title: "New attempt submitted",
        body: `${displayName} submitted an attempt for "${task.title}"`,
        data: { taskId, attemptId: newAttempt.id, channelSlug: channel?.slug },
      });
    }

    // Also notify all assigned mods of this channel (except the task creator and submitter)
    const channelModRows = await db
      .select({ userId: channelMods.userId })
      .from(channelMods)
      .where(eq(channelMods.channelId, task.channelId));

    const modIdsToNotify = channelModRows
      .map((m) => m.userId)
      .filter((id) => id !== task.createdById && id !== auth.userId);

    if (modIdsToNotify.length > 0) {
      await db.insert(notifications).values(
        modIdsToNotify.map((modId) => ({
          userId: modId,
          type: "attempt_submitted" as const,
          title: "New attempt submitted",
          body: `${displayName} submitted an attempt for "${task.title}"`,
          data: { taskId, attemptId: newAttempt.id, channelSlug: channel?.slug },
        }))
      );
    }

    // Real-time: broadcast system message + task update to channel (must await on serverless)
    if (channel?.slug) {
      await Promise.all([
        publishSystemMessage(channel.slug, {
          id: sysMsg.id,
          type: "system",
          content: sysContent,
          createdAt: sysMsg.createdAt,
        }),
        publishTaskUpdate(channel.slug, { id: taskId, status: task.status, title: task.title }),
      ]);
    }

    // Real-time: notify mods via bell badge
    const notifyPromises: Promise<void>[] = [];
    if (task.createdById !== auth.userId) {
      notifyPromises.push(publishNotification(task.createdById, {
        type: "attempt_submitted",
        title: "New attempt submitted",
        unreadCount: -1,
      }));
    }
    for (const modId of modIdsToNotify) {
      notifyPromises.push(publishNotification(modId, {
        type: "attempt_submitted",
        title: "New attempt submitted",
        unreadCount: -1,
      }));
    }
    await Promise.all(notifyPromises);

    // Outgoing webhook to Edtech backend
    await webhookAttemptSubmitted({
      taskId,
      attemptId: newAttempt.id,
      userId: auth.userId,
      deliverables: newAttempt.deliverables,
      username: submitter.username,
      displayName: submitter.displayName,
      email: submitter.email,
      externalId: task.externalId,
      taskTitle: task.title,
      channelSlug: channel?.slug || null,
      bountyUsd: task.bountyUsd,
      bountyRmb: task.bountyRmb,
      attemptNumber: attemptCount.count + 1,
      maxAttempts: task.maxAttempts,
    });

    return NextResponse.json({ attempt: newAttempt }, { status: 201 });
  } catch (error) {
    console.error("Submit attempt error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
