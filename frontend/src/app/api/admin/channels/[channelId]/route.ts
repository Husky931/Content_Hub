import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { channels, channelMods, tags, users, messages, tasks } from "@/db/schema";
import { getAuthFromCookies } from "@/lib/auth";
import { eq, and, count } from "drizzle-orm";

// GET /api/admin/channels/[channelId] — get channel details with mods
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  try {
    const auth = await getAuthFromCookies();
    if (!auth || !["admin", "supermod"].includes(auth.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { channelId } = await params;

    const [channel] = await db
      .select()
      .from(channels)
      .where(eq(channels.id, channelId))
      .limit(1);

    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    // Get assigned mods
    const mods = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        role: users.role,
        assignedAt: channelMods.assignedAt,
      })
      .from(channelMods)
      .innerJoin(users, eq(channelMods.userId, users.id))
      .where(eq(channelMods.channelId, channelId));

    return NextResponse.json({ channel, mods });
  } catch (error) {
    console.error("Get channel error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PATCH /api/admin/channels/[channelId] — update channel details
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  try {
    const auth = await getAuthFromCookies();
    if (!auth || !["admin", "supermod"].includes(auth.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { channelId } = await params;

    // Check channel exists
    const [channel] = await db
      .select()
      .from(channels)
      .where(eq(channels.id, channelId))
      .limit(1);

    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    if (channel.isFixed) {
      return NextResponse.json(
        { error: "Cannot edit fixed/seeded channels" },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { name, nameCn, description, descriptionCn, requiredTagId } = body;

    // Build update object — only include provided fields
    const updates: Record<string, unknown> = {};

    if (name !== undefined) {
      if (!name) {
        return NextResponse.json(
          { error: "Name cannot be empty" },
          { status: 400 }
        );
      }
      updates.name = name;
      // Regenerate slug from new name
      const newSlug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

      // Check slug uniqueness (excluding current channel)
      const [existing] = await db
        .select({ id: channels.id })
        .from(channels)
        .where(eq(channels.slug, newSlug))
        .limit(1);

      if (existing && existing.id !== channelId) {
        return NextResponse.json(
          { error: "A channel with this name already exists" },
          { status: 409 }
        );
      }
      updates.slug = newSlug;
    }

    if (nameCn !== undefined) updates.nameCn = nameCn || null;
    if (description !== undefined) updates.description = description || null;
    if (descriptionCn !== undefined) updates.descriptionCn = descriptionCn || null;

    if (requiredTagId !== undefined && channel.type === "task") {
      if (requiredTagId) {
        // Validate tag exists
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
      updates.requiredTagId = requiredTagId || null;
    }

    if (Object.keys(updates).length === 0) {
      // Nothing to change — return current channel as-is (not an error)
      return NextResponse.json({ channel });
    }

    const [updated] = await db
      .update(channels)
      .set(updates)
      .where(eq(channels.id, channelId))
      .returning();

    return NextResponse.json({ channel: updated });
  } catch (error) {
    console.error("Update channel error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/channels/[channelId] — delete a channel
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  try {
    const auth = await getAuthFromCookies();
    if (!auth || auth.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { channelId } = await params;

    const [channel] = await db
      .select()
      .from(channels)
      .where(eq(channels.id, channelId))
      .limit(1);

    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    if (channel.isFixed) {
      return NextResponse.json(
        { error: "Cannot delete fixed/seeded channels" },
        { status: 400 }
      );
    }

    // Check for associated tasks/messages count for awareness
    const [msgCount] = await db
      .select({ count: count() })
      .from(messages)
      .where(eq(messages.channelId, channelId));

    const [taskCount] = await db
      .select({ count: count() })
      .from(tasks)
      .where(eq(tasks.channelId, channelId));

    // Delete the channel (cascade will handle channel_mods, messages, tasks)
    await db.delete(channels).where(eq(channels.id, channelId));

    return NextResponse.json({
      message: "Channel deleted",
      deletedCounts: {
        messages: msgCount.count,
        tasks: taskCount.count,
      },
    });
  } catch (error) {
    console.error("Delete channel error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
