import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { channels, channelMods, users } from "@/db/schema";
import { getAuthFromCookies } from "@/lib/auth";
import { eq, and, inArray } from "drizzle-orm";

// GET /api/admin/channels/[channelId]/mods — list current mods
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  try {
    const auth = await getAuthFromCookies();
    if (!auth || !["admin", "supermod", "mod"].includes(auth.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { channelId } = await params;

    const [channel] = await db
      .select({ id: channels.id })
      .from(channels)
      .where(eq(channels.id, channelId))
      .limit(1);

    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    // Regular mods can only view mods for channels they are assigned to
    if (auth.role === "mod") {
      const [assignment] = await db
        .select({ channelId: channelMods.channelId })
        .from(channelMods)
        .where(and(eq(channelMods.channelId, channelId), eq(channelMods.userId, auth.userId)))
        .limit(1);
      if (!assignment) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

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

    return NextResponse.json({ mods });
  } catch (error) {
    console.error("Get channel mods error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PUT /api/admin/channels/[channelId]/mods — replace mod list
export async function PUT(
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
      .select({ id: channels.id })
      .from(channels)
      .where(eq(channels.id, channelId))
      .limit(1);

    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    const body = await req.json();
    const { modUserIds } = body;

    if (!Array.isArray(modUserIds)) {
      return NextResponse.json(
        { error: "modUserIds must be an array" },
        { status: 400 }
      );
    }

    // Validate all user IDs exist and have appropriate roles
    if (modUserIds.length > 0) {
      const validUsers = await db
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(inArray(users.id, modUserIds));

      const invalidRoles = validUsers.filter(
        (u) => !["mod", "supermod", "admin"].includes(u.role)
      );
      if (invalidRoles.length > 0) {
        return NextResponse.json(
          { error: "All assigned users must have mod, supermod, or admin role" },
          { status: 400 }
        );
      }

      if (validUsers.length !== modUserIds.length) {
        return NextResponse.json(
          { error: "One or more user IDs are invalid" },
          { status: 400 }
        );
      }
    }

    // Delete all existing mods for this channel
    await db
      .delete(channelMods)
      .where(eq(channelMods.channelId, channelId));

    // Insert new mods
    if (modUserIds.length > 0) {
      await db.insert(channelMods).values(
        modUserIds.map((uid: string) => ({
          channelId,
          userId: uid,
        }))
      );
    }

    // Return updated mod list
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

    return NextResponse.json({ mods });
  } catch (error) {
    console.error("Update channel mods error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
