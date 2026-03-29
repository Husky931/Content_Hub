import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  tasks,
  attempts,
  users,
  channels,
  channelMods,
  messages,
  notifications,
  ledgerEntries,
} from "@/db/schema";
import { getAuthFromCookies } from "@/lib/auth";
import { eq, and, ne } from "drizzle-orm";
import { publishSystemMessage, publishTaskUpdate, publishNotification, publishWalletUpdate } from "@/lib/ws-publish";
import { webhookTaskCompleted } from "@/lib/backend-webhook";

// PATCH /api/tasks/[taskId]/attempts/[attemptId] — review an attempt (mod/supermod/admin)
export async function PATCH(
  req: NextRequest,
  {
    params,
  }: { params: Promise<{ taskId: string; attemptId: string }> }
) {
  try {
    const auth = await getAuthFromCookies();
    if (!auth) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    if (!["admin", "supermod", "mod"].includes(auth.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { taskId, attemptId } = await params;
    const body = await req.json();
    const { status: newStatus, reviewNote, rejectionReason, checklistResults } = body;

    if (!newStatus || !["approved", "rejected"].includes(newStatus)) {
      return NextResponse.json(
        { error: "Status must be 'approved' or 'rejected'" },
        { status: 400 }
      );
    }

    // Get the attempt
    const [attempt] = await db
      .select()
      .from(attempts)
      .where(and(eq(attempts.id, attemptId), eq(attempts.taskId, taskId)))
      .limit(1);

    if (!attempt) {
      return NextResponse.json(
        { error: "Attempt not found" },
        { status: 404 }
      );
    }

    if (attempt.status !== "submitted") {
      return NextResponse.json(
        { error: `Cannot review an attempt with status '${attempt.status}'` },
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

    // The user who submitted the attempt cannot review it
    if (attempt.userId === auth.userId) {
      return NextResponse.json(
        { error: "You cannot review your own submission" },
        { status: 403 }
      );
    }

    // Must have claimed this task's review queue
    if (!task.reviewClaimedById) {
      return NextResponse.json(
        { error: "You must claim this task for review first" },
        { status: 400 }
      );
    }
    if (task.reviewClaimedById !== auth.userId) {
      return NextResponse.json(
        { error: "This task's review is claimed by another reviewer" },
        { status: 409 }
      );
    }

    // Non-admin roles can only review tasks from channels they are assigned to
    if (auth.role === "mod" || auth.role === "supermod") {
      const [modAssignment] = await db
        .select({ id: channelMods.id })
        .from(channelMods)
        .where(
          and(
            eq(channelMods.channelId, task.channelId),
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

    // Server-side checklist enforcement: if the task has a checklist, approval requires all items to pass
    const taskChecklist = task.checklist as { label: string }[] | null;
    if (newStatus === "approved" && taskChecklist && taskChecklist.length > 0) {
      if (!Array.isArray(checklistResults) || checklistResults.length !== taskChecklist.length) {
        return NextResponse.json(
          { error: "Checklist results are required for approval — all items must be checked" },
          { status: 400 }
        );
      }
      const allPassed = checklistResults.every((v: unknown) => v === true);
      if (!allPassed) {
        return NextResponse.json(
          { error: "Cannot approve — not all checklist items passed" },
          { status: 400 }
        );
      }
    }

    // --- Critical section: use a transaction with optimistic locking to prevent double-payment ---
    const txResult = await db.transaction(async (tx) => {
      // Optimistic lock: only update if status is still "submitted"
      const [updatedAttempt] = await tx
        .update(attempts)
        .set({
          status: newStatus,
          reviewerId: auth.userId,
          reviewNote: reviewNote || null,
          rejectionReason: newStatus === "rejected" ? rejectionReason || null : null,
          updatedAt: new Date(),
        })
        .where(and(eq(attempts.id, attemptId), eq(attempts.status, "submitted")))
        .returning();

      // If no rows updated, another reviewer already processed this attempt
      if (!updatedAttempt) {
        return { conflict: true } as const;
      }

      let otherSubmitted: { id: string; userId: string }[] = [];

      if (newStatus === "approved") {
        // Find other submitted attempts before auto-rejecting them
        otherSubmitted = await tx
          .select({ id: attempts.id, userId: attempts.userId })
          .from(attempts)
          .where(
            and(
              eq(attempts.taskId, taskId),
              ne(attempts.id, attemptId),
              eq(attempts.status, "submitted")
            )
          );

        // Auto-reject all other submitted attempts for this task
        if (otherSubmitted.length > 0) {
          await tx
            .update(attempts)
            .set({
              status: "rejected",
              rejectionReason: "Another attempt was approved",
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(attempts.taskId, taskId),
                ne(attempts.id, attemptId),
                eq(attempts.status, "submitted")
              )
            );

          // Notify each auto-rejected user
          await tx.insert(notifications).values(
            otherSubmitted.map((a) => ({
              userId: a.userId,
              type: "task_rejected",
              title: "Submission not selected",
              body: `Your submission for "${task.title}" was not selected — another attempt was approved.`,
              data: { taskId, attemptId: a.id },
            }))
          );
        }

        // Move task to approved + release review claim
        await tx
          .update(tasks)
          .set({
            status: "approved",
            reviewClaimedById: null,
            reviewClaimedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(tasks.id, taskId));

        // Create ledger entry for the creator (inside transaction to prevent double-payment)
        await tx.insert(ledgerEntries).values({
          userId: attempt.userId,
          taskId,
          attemptId,
          type: "task_earning",
          amountUsd: task.bountyUsd,
          amountRmb: task.bountyRmb,
          description: `Earning for task: ${task.title}`,
        });
      }

      return { conflict: false, updatedAttempt, otherSubmitted } as const;
    });

    // If another reviewer already processed this attempt, return 409 Conflict
    if (txResult.conflict) {
      return NextResponse.json(
        { error: "This attempt has already been reviewed" },
        { status: 409 }
      );
    }

    const { updatedAttempt, otherSubmitted } = txResult;

    // Get submitter info
    const [submitter] = await db
      .select({ username: users.username, displayName: users.displayName, email: users.email })
      .from(users)
      .where(eq(users.id, attempt.userId))
      .limit(1);
    const displayName = submitter.displayName || submitter.username;

    // Get reviewer info for webhook
    const [reviewer] = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, auth.userId))
      .limit(1);

    // Get channel slug for notification navigation
    const [channel] = await db
      .select({ slug: channels.slug })
      .from(channels)
      .where(eq(channels.id, task.channelId))
      .limit(1);
    const channelSlug = channel?.slug;

    if (newStatus === "approved") {

      // Post system message
      const approveContent = `${displayName}'s submission for "${task.title}" was approved! +$${task.bountyUsd || "0"} / +¥${task.bountyRmb || "0"}`;
      const [approveSysMsg] = await db.insert(messages).values({
        channelId: task.channelId,
        userId: auth.userId,
        type: "system",
        content: approveContent,
      }).returning();

      // Notify the creator
      await db.insert(notifications).values({
        userId: attempt.userId,
        type: "task_approved",
        title: "Task approved!",
        body: `Your submission for "${task.title}" was approved. $${task.bountyUsd || "0"} / ¥${task.bountyRmb || "0"} added to your wallet.`,
        data: { taskId, attemptId, channelSlug },
      });

      // Real-time: broadcast system message, task update, notification, wallet update (must await on serverless)
      const approvePublishes: Promise<void>[] = [];
      if (channelSlug) {
        approvePublishes.push(
          publishSystemMessage(channelSlug, {
            id: approveSysMsg.id,
            type: "system",
            content: approveContent,
            createdAt: approveSysMsg.createdAt,
          }),
          publishTaskUpdate(channelSlug, { id: taskId, status: "approved" }),
        );
      }
      approvePublishes.push(
        publishNotification(attempt.userId, {
          type: "task_approved",
          title: "Task approved!",
          unreadCount: -1,
        }),
      );
      for (const a of otherSubmitted) {
        approvePublishes.push(
          publishNotification(a.userId, {
            type: "task_rejected",
            title: "Submission not selected",
            unreadCount: -1,
          }),
        );
      }
      approvePublishes.push(publishWalletUpdate(attempt.userId, { changed: true }));
      await Promise.all(approvePublishes);

      // Outgoing webhook to Edtech backend
      await webhookTaskCompleted({
        taskId,
        attemptId,
        userId: attempt.userId,
        bountyUsd: task.bountyUsd,
        bountyRmb: task.bountyRmb,
        username: submitter.username,
        displayName: submitter.displayName,
        email: submitter.email,
        externalId: task.externalId,
        taskTitle: task.title,
        channelSlug: channelSlug || null,
        bonusBountyUsd: task.bonusBountyUsd,
        bonusBountyRmb: task.bonusBountyRmb,
        reviewerUsername: reviewer.username,
        deliverables: attempt.deliverables,
      });
    } else {
      // Rejected
      const rejectionMsg = rejectionReason
        ? `${displayName}'s submission for "${task.title}" was rejected. Reason: ${rejectionReason}`
        : `${displayName}'s submission for "${task.title}" was rejected.`;
      const [rejectSysMsg] = await db.insert(messages).values({
        channelId: task.channelId,
        userId: auth.userId,
        type: "system",
        content: rejectionMsg,
      }).returning();

      await db.insert(notifications).values({
        userId: attempt.userId,
        type: "task_rejected",
        title: "Submission rejected",
        body: `Your submission for "${task.title}" was rejected. ${rejectionReason || ""}`.trim(),
        data: { taskId, attemptId, channelSlug },
      });

      // Real-time: broadcast system message, task update, + notification (must await on serverless)
      const rejectPublishes: Promise<void>[] = [];
      if (channelSlug) {
        rejectPublishes.push(
          publishSystemMessage(channelSlug, { id: rejectSysMsg.id, type: "system", content: rejectionMsg, createdAt: rejectSysMsg.createdAt }),
          publishTaskUpdate(channelSlug, { id: taskId, status: task.status, title: task.title }),
        );
      }
      rejectPublishes.push(
        publishNotification(attempt.userId, {
          type: "task_rejected",
          title: "Submission rejected",
          unreadCount: -1,
        }),
      );
      await Promise.all(rejectPublishes);
    }

    return NextResponse.json({ attempt: updatedAttempt });
  } catch (error) {
    console.error("Review attempt error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PUT /api/tasks/[taskId]/attempts/[attemptId] — edit own submitted attempt
export async function PUT(
  req: NextRequest,
  {
    params,
  }: { params: Promise<{ taskId: string; attemptId: string }> }
) {
  try {
    const auth = await getAuthFromCookies();
    if (!auth) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { taskId, attemptId } = await params;
    const body = await req.json();
    const { deliverables } = body;

    if (!deliverables || (typeof deliverables === "object" && Object.keys(deliverables).length === 0)) {
      return NextResponse.json(
        { error: "Deliverables are required" },
        { status: 400 }
      );
    }

    // Get the attempt — must be own and still "submitted"
    const [attempt] = await db
      .select()
      .from(attempts)
      .where(
        and(
          eq(attempts.id, attemptId),
          eq(attempts.taskId, taskId),
          eq(attempts.userId, auth.userId),
          eq(attempts.status, "submitted")
        )
      )
      .limit(1);

    if (!attempt) {
      return NextResponse.json(
        { error: "Attempt not found or cannot be edited" },
        { status: 404 }
      );
    }

    const [updated] = await db
      .update(attempts)
      .set({ deliverables, updatedAt: new Date() })
      .where(eq(attempts.id, attemptId))
      .returning();

    return NextResponse.json({ attempt: updated });
  } catch (error) {
    console.error("Edit attempt error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE /api/tasks/[taskId]/attempts/[attemptId] — delete own submitted attempt
export async function DELETE(
  _req: NextRequest,
  {
    params,
  }: { params: Promise<{ taskId: string; attemptId: string }> }
) {
  try {
    const auth = await getAuthFromCookies();
    if (!auth) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { taskId, attemptId } = await params;

    // Get the attempt — must be own and still "submitted"
    const [attempt] = await db
      .select()
      .from(attempts)
      .where(
        and(
          eq(attempts.id, attemptId),
          eq(attempts.taskId, taskId),
          eq(attempts.userId, auth.userId),
          eq(attempts.status, "submitted")
        )
      )
      .limit(1);

    if (!attempt) {
      return NextResponse.json(
        { error: "Attempt not found or cannot be deleted" },
        { status: 404 }
      );
    }

    await db.delete(attempts).where(eq(attempts.id, attemptId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete attempt error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
