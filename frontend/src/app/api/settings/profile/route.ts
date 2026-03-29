import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getAuthFromCookies } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { moderateBio } from "@/lib/llm";

export async function PUT(req: NextRequest) {
  try {
    const auth = await getAuthFromCookies();
    if (!auth) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { displayName, bio } = await req.json();

    // Moderate bio text if provided
    const trimmedBio = bio?.trim() || null;
    if (trimmedBio) {
      const modResult = await moderateBio(trimmedBio);
      if (!modResult.approved) {
        return NextResponse.json(
          { error: modResult.reason || "Bio content was rejected by moderation" },
          { status: 422 }
        );
      }
    }

    const [updated] = await db
      .update(users)
      .set({
        displayName: displayName?.trim() || null,
        bio: trimmedBio,
        updatedAt: new Date(),
      })
      .where(eq(users.id, auth.userId))
      .returning();

    return NextResponse.json({
      user: {
        id: updated.id,
        email: updated.email,
        username: updated.username,
        role: updated.role,
        status: updated.status,
        currency: updated.currency,
        displayName: updated.displayName,
        avatarUrl: updated.avatarUrl,
        bio: updated.bio,
        onboardingCompleted: updated.onboardingCompleted,
        createdAt: updated.createdAt,
      },
    });
  } catch (error) {
    console.error("Profile update error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
