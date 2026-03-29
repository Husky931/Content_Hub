import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, userTags, tags } from "@/db/schema";
import { getAuthFromCookies } from "@/lib/auth";
import { eq, asc } from "drizzle-orm";

export async function GET() {
  try {
    const auth = await getAuthFromCookies();
    if (!auth || auth.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const allUsers = await db
      .select({
        id: users.id,
        email: users.email,
        username: users.username,
        displayName: users.displayName,
        role: users.role,
        status: users.status,
        currency: users.currency,
        onboardingCompleted: users.onboardingCompleted,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(asc(users.createdAt));

    // Get tags for each user
    const allUserTags = await db
      .select({
        userId: userTags.userId,
        tagId: userTags.tagId,
        tagName: tags.name,
        tagColor: tags.color,
      })
      .from(userTags)
      .innerJoin(tags, eq(userTags.tagId, tags.id));

    const tagsByUser = new Map<string, { id: string; name: string; color: string }[]>();
    for (const ut of allUserTags) {
      if (!tagsByUser.has(ut.userId)) tagsByUser.set(ut.userId, []);
      tagsByUser.get(ut.userId)!.push({ id: ut.tagId, name: ut.tagName, color: ut.tagColor });
    }

    return NextResponse.json({
      users: allUsers.map((u) => ({
        ...u,
        tags: tagsByUser.get(u.id) || [],
      })),
    });
  } catch (error) {
    console.error("Admin users error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Update user role or ban status
export async function PATCH(req: NextRequest) {
  try {
    const auth = await getAuthFromCookies();
    if (!auth || auth.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { userId, action, role, banReason } = await req.json();

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    // Prevent self-modification
    if (userId === auth.userId) {
      return NextResponse.json(
        { error: "Cannot modify your own account" },
        { status: 400 }
      );
    }

    if (action === "changeRole") {
      if (!role || !["creator", "supercreator", "mod", "supermod", "admin"].includes(role)) {
        return NextResponse.json({ error: "Invalid role" }, { status: 400 });
      }
      await db
        .update(users)
        .set({ role, updatedAt: new Date() })
        .where(eq(users.id, userId));
    } else if (action === "ban") {
      await db
        .update(users)
        .set({
          status: "banned",
          banReason: banReason || "Banned by admin",
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
    } else if (action === "unban") {
      await db
        .update(users)
        .set({
          status: "verified",
          banReason: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Admin user update error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
