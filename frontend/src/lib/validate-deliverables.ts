/**
 * Deliverable slot validation — shared between client (TaskCard) and server (attempts API).
 *
 * Phase 1: metadata-only checks (no file fetching needed).
 * Phase 2/3 checks (TSV columns, SRT parsing, video/audio/image probing) are NOT here yet —
 * see Issue_31.md for the full roadmap.
 */

import type { DeliverableSlot } from "@/types/deliverable-slot";
import { isUploadType } from "@/types/deliverable-slot";

// ── Types matching what the client/server receive ────────────────────────────

interface SubmittedFile {
  name: string;
  url: string;
  type: string;
  size: number; // bytes
}

interface SlotDeliverable {
  slotId: string;
  text?: string;
  files?: SubmittedFile[];
  selections?: string[];
  rating?: number;
}

export interface CheckResult {
  slotId: string;
  slotTitle: string;
  check: string;   // human-readable label
  passed: boolean;
  detail?: string;  // failure reason
}

// ── Unit conversion ──────────────────────────────────────────────────────────

function toBytes(value: number, unit: string): number {
  switch (unit) {
    case "B": return value;
    case "KB": return value * 1024;
    case "MB": return value * 1024 * 1024;
    case "GB": return value * 1024 * 1024 * 1024;
    default: return value * 1024; // default KB
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

// ── Main validation function ─────────────────────────────────────────────────

/**
 * Validate submitted deliverables against their slot definitions.
 * Returns an array of individual check results (pass/fail per check per slot).
 * If the returned array has any `passed: false`, the submission should be rejected.
 */
export function validateDeliverables(
  slots: DeliverableSlot[],
  deliverables: SlotDeliverable[],
): CheckResult[] {
  const results: CheckResult[] = [];
  const deliverableMap = new Map(deliverables.map((d) => [d.slotId, d]));

  for (const slot of slots) {
    const sd = deliverableMap.get(slot.id);
    const title = slot.title || "Untitled slot";

    // Skip optional slots that have no deliverable at all
    if (slot.required === false && !sd) continue;

    // ── File size checks (all upload types) ──────────────────────────────

    if (isUploadType(slot.type)) {
      const files = sd?.files || [];

      if (slot.minFileSize && slot.minFileSizeUnit) {
        const minBytes = toBytes(slot.minFileSize, slot.minFileSizeUnit);
        for (const f of files) {
          const passed = f.size >= minBytes;
          results.push({
            slotId: slot.id,
            slotTitle: title,
            check: `Min file size: ${slot.minFileSize} ${slot.minFileSizeUnit}`,
            passed,
            detail: passed ? undefined : `"${f.name}" is ${formatBytes(f.size)}, minimum is ${slot.minFileSize} ${slot.minFileSizeUnit}`,
          });
        }
      }

      if (slot.maxFileSize && slot.maxFileSizeUnit) {
        const maxBytes = toBytes(slot.maxFileSize, slot.maxFileSizeUnit);
        for (const f of files) {
          const passed = f.size <= maxBytes;
          results.push({
            slotId: slot.id,
            slotTitle: title,
            check: `Max file size: ${slot.maxFileSize} ${slot.maxFileSizeUnit}`,
            passed,
            detail: passed ? undefined : `"${f.name}" is ${formatBytes(f.size)}, maximum is ${slot.maxFileSize} ${slot.maxFileSizeUnit}`,
          });
        }
      }
    }

    // ── File extension check (upload-other) ──────────────────────────────

    if (slot.type === "upload-other" && slot.fileExtensions) {
      const allowed = slot.fileExtensions
        .split(",")
        .map((ext) => ext.trim().toLowerCase().replace(/^\./, ""));
      const files = sd?.files || [];

      for (const f of files) {
        const ext = f.name.split(".").pop()?.toLowerCase() || "";
        const passed = allowed.includes(ext);
        results.push({
          slotId: slot.id,
          slotTitle: title,
          check: `Allowed extensions: ${slot.fileExtensions}`,
          passed,
          detail: passed ? undefined : `"${f.name}" has extension ".${ext}", allowed: ${slot.fileExtensions}`,
        });
      }
    }

    // ── Text length & regex checks (upload-text, textbox) ────────────────

    if (slot.type === "upload-text" || slot.type === "textbox") {
      const text = sd?.text || "";

      if (slot.textMinLength) {
        const passed = text.length >= slot.textMinLength;
        results.push({
          slotId: slot.id,
          slotTitle: title,
          check: `Min ${slot.textMinLength} characters`,
          passed,
          detail: passed ? undefined : `Text is ${text.length} chars, minimum is ${slot.textMinLength}`,
        });
      }

      if (slot.textMaxLength) {
        const passed = text.length <= slot.textMaxLength;
        results.push({
          slotId: slot.id,
          slotTitle: title,
          check: `Max ${slot.textMaxLength} characters`,
          passed,
          detail: passed ? undefined : `Text is ${text.length} chars, maximum is ${slot.textMaxLength}`,
        });
      }

      if (slot.textRegex) {
        try {
          const regex = new RegExp(slot.textRegex);
          const passed = regex.test(text);
          results.push({
            slotId: slot.id,
            slotTitle: title,
            check: `Regex: ${slot.textRegex}`,
            passed,
            detail: passed ? undefined : `Text does not match pattern: ${slot.textRegex}`,
          });
        } catch {
          // Invalid regex configured — skip, don't block the creator
          results.push({
            slotId: slot.id,
            slotTitle: title,
            check: `Regex: ${slot.textRegex}`,
            passed: true,
            detail: "Regex pattern is invalid — skipped",
          });
        }
      }
    }

    // ── Selection count checks (multiple-selection) ──────────────────────

    if (slot.type === "multiple-selection") {
      const count = sd?.selections?.length || 0;

      if (slot.minSelections) {
        const passed = count >= slot.minSelections;
        results.push({
          slotId: slot.id,
          slotTitle: title,
          check: `Min ${slot.minSelections} selections`,
          passed,
          detail: passed ? undefined : `Selected ${count}, minimum is ${slot.minSelections}`,
        });
      }

      if (slot.maxSelections) {
        const passed = count <= slot.maxSelections;
        results.push({
          slotId: slot.id,
          slotTitle: title,
          check: `Max ${slot.maxSelections} selections`,
          passed,
          detail: passed ? undefined : `Selected ${count}, maximum is ${slot.maxSelections}`,
        });
      }
    }

    // ── Rating range check ───────────────────────────────────────────────

    if (slot.type === "rating" && sd?.rating !== undefined) {
      const min = slot.ratingMin ?? 1;
      const max = slot.ratingMax ?? 5;
      const passed = sd.rating >= min && sd.rating <= max;
      results.push({
        slotId: slot.id,
        slotTitle: title,
        check: `Rating between ${min}–${max}`,
        passed,
        detail: passed ? undefined : `Rating is ${sd.rating}, must be between ${min} and ${max}`,
      });

      // Step validation (e.g. step=0.5 means 1, 1.5, 2, ... are valid)
      if (slot.ratingStep && slot.ratingStep > 0) {
        const remainder = (sd.rating - min) % slot.ratingStep;
        const stepPassed = Math.abs(remainder) < 0.0001;
        results.push({
          slotId: slot.id,
          slotTitle: title,
          check: `Rating step: ${slot.ratingStep}`,
          passed: stepPassed,
          detail: stepPassed ? undefined : `Rating ${sd.rating} is not a valid step (step size: ${slot.ratingStep})`,
        });
      }
    }
  }

  return results;
}

/**
 * Convenience: returns null if all checks pass, or a human-readable error string if any fail.
 */
export function validateDeliverablesError(
  slots: DeliverableSlot[],
  deliverables: SlotDeliverable[],
): string | null {
  const results = validateDeliverables(slots, deliverables);
  const failures = results.filter((r) => !r.passed);
  if (failures.length === 0) return null;

  // Return first failure as the error message
  const f = failures[0];
  return `${f.slotTitle}: ${f.detail || f.check}`;
}
