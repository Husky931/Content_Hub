import { NextResponse } from "next/server";
import { db } from "@/db";
import { taskTemplates, users } from "@/db/schema";
import { getAuthFromCookies } from "@/lib/auth";
import { desc, eq } from "drizzle-orm";

// GET /api/templates — list all templates
export async function GET() {
  try {
    const auth = await getAuthFromCookies();
    if (!auth || !["admin", "supermod", "mod"].includes(auth.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rows = await db
      .select({
        id: taskTemplates.id,
        name: taskTemplates.name,
        nameCn: taskTemplates.nameCn,
        category: taskTemplates.category,
        description: taskTemplates.description,
        descriptionCn: taskTemplates.descriptionCn,
        bountyUsd: taskTemplates.bountyUsd,
        bountyRmb: taskTemplates.bountyRmb,
        bonusBountyUsd: taskTemplates.bonusBountyUsd,
        bonusBountyRmb: taskTemplates.bonusBountyRmb,
        maxAttempts: taskTemplates.maxAttempts,
        checklist: taskTemplates.checklist,
        selfChecklist: taskTemplates.selfChecklist,
        deliverableSlots: taskTemplates.deliverableSlots,
        attachments: taskTemplates.attachments,
        createdByUsername: users.username,
        createdAt: taskTemplates.createdAt,
      })
      .from(taskTemplates)
      .innerJoin(users, eq(taskTemplates.createdById, users.id))
      .orderBy(desc(taskTemplates.createdAt));

    return NextResponse.json({ templates: rows });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/templates — create template (admin/supermod only)
export async function POST(req: Request) {
  try {
    const auth = await getAuthFromCookies();
    if (!auth || !["admin", "supermod"].includes(auth.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { name, nameCn, category, description, descriptionCn, bountyUsd, bountyRmb, bonusBountyUsd, bonusBountyRmb, maxAttempts, checklist, selfChecklist, deliverableSlots, attachments } = body;

    if (!name || !category) {
      return NextResponse.json({ error: "Name and category are required" }, { status: 400 });
    }

    const [created] = await db
      .insert(taskTemplates)
      .values({
        name,
        nameCn: nameCn || null,
        category,
        description: description || null,
        descriptionCn: descriptionCn || null,
        bountyUsd: bountyUsd || null,
        bountyRmb: bountyRmb || null,
        bonusBountyUsd: bonusBountyUsd || null,
        bonusBountyRmb: bonusBountyRmb || null,
        maxAttempts: maxAttempts || 5,
        checklist: checklist || null,
        selfChecklist: selfChecklist || null,
        deliverableSlots: deliverableSlots || null,
        attachments: attachments || null,
        createdById: auth.userId,
      })
      .returning();

    return NextResponse.json({ template: created }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
