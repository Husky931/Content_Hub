import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { channels, channelMods, tags } from "@/db/schema";
import { getAuthFromCookies } from "@/lib/auth";
import { eq } from "drizzle-orm";

// POST /api/admin/channels — create a new channel (admin only)
export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthFromCookies();
    if (!auth || auth.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { name, nameCn, type, description, descriptionCn, requiredTagId, modUserIds } = body;

    if (!name || !type) {
      return NextResponse.json(
        { error: "name and type are required" },
        { status: 400 }
      );
    }

    if (!["task", "discussion"].includes(type)) {
      return NextResponse.json(
        { error: "Type must be 'task' or 'discussion'" },
        { status: 400 }
      );
    }

    // Generate slug from name (use nameCn fallback for Chinese-only names)
    let slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    // If name is non-ASCII only (e.g. Chinese), use a transliterated fallback
    if (!slug) {
      slug = `ch-${Date.now().toString(36)}`;
    }

    // Check slug uniqueness
    const [existing] = await db
      .select({ id: channels.id })
      .from(channels)
      .where(eq(channels.slug, slug))
      .limit(1);

    if (existing) {
      return NextResponse.json(
        { error: "A channel with this name already exists" },
        { status: 409 }
      );
    }

    // Validate tag if provided
    if (requiredTagId) {
      const [tag] = await db
        .select({ id: tags.id })
        .from(tags)
        .where(eq(tags.id, requiredTagId))
        .limit(1);
      if (!tag) {
        return NextResponse.json(
          { error: "Required tag not found" },
          { status: 400 }
        );
      }
    }

    const [newChannel] = await db
      .insert(channels)
      .values({
        name,
        nameCn: nameCn || null,
        slug,
        type,
        description: description || null,
        descriptionCn: descriptionCn || null,
        isFixed: false,
        requiredTagId: type === "task" ? requiredTagId || null : null,
      })
      .returning();

    // Assign mods if provided
    if (modUserIds && Array.isArray(modUserIds) && modUserIds.length > 0) {
      await db.insert(channelMods).values(
        modUserIds.map((uid: string) => ({
          channelId: newChannel.id,
          userId: uid,
        }))
      );
    }

    return NextResponse.json({ channel: newChannel }, { status: 201 });
  } catch (error) {
    console.error("Create channel error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
