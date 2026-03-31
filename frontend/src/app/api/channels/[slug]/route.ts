import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { channels, messages, users } from "@/db/schema";
import { eq, asc, sql, isNull } from "drizzle-orm";
import { getAuthFromCookies } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const auth = await getAuthFromCookies();

    // Find channel
    const [channel] = await db
      .select()
      .from(channels)
      .where(eq(channels.slug, slug))
      .limit(1);

    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    // Build privacy filter: only show private messages to participants
    const privacyFilter = auth
      ? sql`AND (${messages.privateToUserId} IS NULL OR ${messages.userId} = ${auth.userId} OR ${messages.privateToUserId} = ${auth.userId})`
      : sql`AND ${messages.privateToUserId} IS NULL`;

    // Get all non-deleted messages with user info (including replies)
    const channelMessages = await db
      .select({
        id: messages.id,
        content: messages.content,
        type: messages.type,
        replyToId: messages.replyToId,
        privateToUserId: messages.privateToUserId,
        createdAt: messages.createdAt,
        updatedAt: messages.updatedAt,
        userId: messages.userId,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        role: users.role,
      })
      .from(messages)
      .innerJoin(users, eq(messages.userId, users.id))
      .where(
        sql`${messages.channelId} = ${channel.id} AND ${messages.deletedAt} IS NULL ${privacyFilter}`
      )
      .orderBy(asc(messages.createdAt))
      .limit(200);

    // Build reply count map: parentId → count (exclude deleted, respect privacy)
    const replyCounts = await db
      .select({
        parentId: messages.replyToId,
        count: sql<number>`count(*)::int`,
      })
      .from(messages)
      .where(
        sql`${messages.channelId} = ${channel.id} AND ${messages.deletedAt} IS NULL ${privacyFilter}`
      )
      .groupBy(messages.replyToId);

    const replyCountMap: Record<string, number> = {};
    for (const r of replyCounts) {
      if (r.parentId) replyCountMap[r.parentId] = r.count;
    }

    return NextResponse.json({
      channel: {
        id: channel.id,
        name: channel.name,
        nameCn: channel.nameCn,
        type: channel.type,
        description: channel.description,
        descriptionCn: channel.descriptionCn,
        requiredTagId: channel.requiredTagId,
      },
      messages: channelMessages.map((m) => ({
        id: m.id,
        content: m.content,
        type: m.type,
        replyToId: m.replyToId || null,
        privateToUserId: m.privateToUserId || null,
        replyCount: replyCountMap[m.id] || 0,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt || null,
        user: {
          id: m.userId,
          username: m.username,
          displayName: m.displayName,
          avatarUrl: m.avatarUrl,
          role: m.role,
        },
      })),
    });
  } catch (error) {
    console.error("Channel fetch error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
