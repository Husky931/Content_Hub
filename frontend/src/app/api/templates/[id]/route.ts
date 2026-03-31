import { NextResponse } from "next/server";
import { db } from "@/db";
import { taskTemplates } from "@/db/schema";
import { getAuthFromCookies } from "@/lib/auth";
import { eq } from "drizzle-orm";

// PATCH /api/templates/[id] — update template
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthFromCookies();
    if (!auth || !["admin", "supermod"].includes(auth.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const body = await req.json();
    const { name, nameCn, category, description, descriptionCn, bountyUsd, bountyRmb, bonusBountyUsd, bonusBountyRmb, maxAttempts, checklist, selfChecklist, deliverableSlots, attachments } = body;

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name;
    if (nameCn !== undefined) updates.nameCn = nameCn || null;
    if (category !== undefined) updates.category = category;
    if (description !== undefined) updates.description = description || null;
    if (descriptionCn !== undefined) updates.descriptionCn = descriptionCn || null;
    if (bountyUsd !== undefined) updates.bountyUsd = bountyUsd || null;
    if (bountyRmb !== undefined) updates.bountyRmb = bountyRmb || null;
    if (bonusBountyUsd !== undefined) updates.bonusBountyUsd = bonusBountyUsd || null;
    if (bonusBountyRmb !== undefined) updates.bonusBountyRmb = bonusBountyRmb || null;
    if (maxAttempts !== undefined) updates.maxAttempts = maxAttempts;
    if (checklist !== undefined) updates.checklist = checklist;
    if (selfChecklist !== undefined) updates.selfChecklist = selfChecklist;
    if (deliverableSlots !== undefined) updates.deliverableSlots = deliverableSlots;
    if (attachments !== undefined) updates.attachments = attachments;

    const [updated] = await db
      .update(taskTemplates)
      .set(updates)
      .where(eq(taskTemplates.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    return NextResponse.json({ template: updated });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/templates/[id] — delete template
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthFromCookies();
    if (!auth || !["admin", "supermod"].includes(auth.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const [deleted] = await db
      .delete(taskTemplates)
      .where(eq(taskTemplates.id, id))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
