import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { tasks, channels, users, attempts, channelMods } from "@/db/schema";
import { getAuthFromCookies } from "@/lib/auth";
import { eq, desc, sql, inArray, and } from "drizzle-orm";

// GET /api/admin/tasks — list all tasks (admin/mod/supermod)
export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthFromCookies();
    if (!auth || !["admin", "supermod", "mod"].includes(auth.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const includeSubmittedAttempts =
      req.nextUrl.searchParams.get("includeSubmittedAttempts") === "true";

    let allTasks = await db
      .select({
        id: tasks.id,
        channelId: tasks.channelId,
        createdById: tasks.createdById,
        title: tasks.title,
        titleCn: tasks.titleCn,
        status: tasks.status,
        bountyUsd: tasks.bountyUsd,
        bountyRmb: tasks.bountyRmb,
        maxAttempts: tasks.maxAttempts,
        deadline: tasks.deadline,
        createdAt: tasks.createdAt,
        checklist: tasks.checklist,
        selfChecklist: tasks.selfChecklist,
        attachments: tasks.attachments,
        deliverableSlots: tasks.deliverableSlots,
        channelName: channels.name,
        channelSlug: channels.slug,
        createdByUsername: users.username,
        lockedById: tasks.lockedById,
        lockExpiresAt: tasks.lockExpiresAt,
      })
      .from(tasks)
      .innerJoin(channels, eq(tasks.channelId, channels.id))
      .innerJoin(users, eq(tasks.createdById, users.id))
      .orderBy(desc(tasks.createdAt));

    // Only admins can see all tasks
    // Mods and supermods can see tasks they created OR tasks from channels they are assigned to
    let modChannelIds: string[] = [];
    if (auth.role === "mod" || auth.role === "supermod") {
      const modChannels = await db
        .select({ channelId: channelMods.channelId })
        .from(channelMods)
        .where(eq(channelMods.userId, auth.userId));
      modChannelIds = modChannels.map((c) => c.channelId);
      const modChannelIdSet = new Set(modChannelIds);
      allTasks = allTasks.filter(
        (t) => t.createdById === auth.userId || modChannelIdSet.has(t.channelId)
      );
    }

    // Get attempt counts
    const taskIds = allTasks.map((t) => t.id);
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

    // Optionally include submitted attempts for review page
    let submittedAttempts: any[] = [];
    if (includeSubmittedAttempts && taskIds.length > 0) {
      submittedAttempts = await db
        .select({
          id: attempts.id,
          taskId: attempts.taskId,
          userId: attempts.userId,
          status: attempts.status,
          deliverables: attempts.deliverables,
          createdAt: attempts.createdAt,
          username: users.username,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
        })
        .from(attempts)
        .innerJoin(users, eq(attempts.userId, users.id))
        .where(
          and(
            inArray(attempts.taskId, taskIds),
            eq(attempts.status, "submitted")
          )
        );
    }

    return NextResponse.json({
      tasks: allTasks.map((t) => ({
        ...t,
        attemptCount: attemptCounts[t.id] || 0,
      })),
      ...(includeSubmittedAttempts ? { submittedAttempts } : {}),
      ...(modChannelIds.length > 0 ? { modChannelIds } : {}),
    });
  } catch (error) {
    console.error("Admin list tasks error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
