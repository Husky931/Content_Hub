import {
  validateDeliverables,
  validateDeliverablesError,
  type CheckResult,
} from "@/lib/validate-deliverables";
import type { DeliverableSlot } from "@/types/deliverable-slot";
import { createDefaultSlot } from "@/types/deliverable-slot";

// Helper to make a slot with overrides
function slot(type: DeliverableSlot["type"], overrides: Partial<DeliverableSlot> = {}): DeliverableSlot {
  return { ...createDefaultSlot(type), id: "slot-1", ...overrides };
}

// ────────────────────────────────────────────────
// File size checks (all upload types)
// ────────────────────────────────────────────────

describe("file size checks", () => {
  it("passes when file is within min/max range", () => {
    const s = slot("upload-video", { minFileSize: 1, minFileSizeUnit: "KB", maxFileSize: 10, maxFileSizeUnit: "MB" });
    const results = validateDeliverables([s], [
      { slotId: "slot-1", files: [{ name: "vid.mp4", url: "/f", type: "video/mp4", size: 500_000 }] },
    ]);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it("fails when file is below minimum size", () => {
    const s = slot("upload-audio", { minFileSize: 100, minFileSizeUnit: "KB" });
    const results = validateDeliverables([s], [
      { slotId: "slot-1", files: [{ name: "tiny.mp3", url: "/f", type: "audio/mp3", size: 50 }] },
    ]);
    const fail = results.find((r) => !r.passed);
    expect(fail).toBeDefined();
    expect(fail!.detail).toContain("minimum");
  });

  it("fails when file exceeds maximum size", () => {
    const s = slot("upload-image", { maxFileSize: 5, maxFileSizeUnit: "MB" });
    const results = validateDeliverables([s], [
      { slotId: "slot-1", files: [{ name: "huge.png", url: "/f", type: "image/png", size: 10 * 1024 * 1024 }] },
    ]);
    const fail = results.find((r) => !r.passed);
    expect(fail).toBeDefined();
    expect(fail!.detail).toContain("maximum");
  });

  it("checks each file individually", () => {
    const s = slot("upload-other", { maxFileSize: 1, maxFileSizeUnit: "MB" });
    const results = validateDeliverables([s], [
      {
        slotId: "slot-1",
        files: [
          { name: "ok.zip", url: "/f", type: "application/zip", size: 500_000 },
          { name: "big.zip", url: "/f", type: "application/zip", size: 2_000_000 },
        ],
      },
    ]);
    const passes = results.filter((r) => r.passed);
    const fails = results.filter((r) => !r.passed);
    expect(passes.length).toBeGreaterThanOrEqual(1);
    expect(fails.length).toBeGreaterThanOrEqual(1);
    expect(fails[0].detail).toContain("big.zip");
  });

  it("converts units correctly (GB)", () => {
    const s = slot("upload-video", { maxFileSize: 1, maxFileSizeUnit: "GB" });
    const results = validateDeliverables([s], [
      { slotId: "slot-1", files: [{ name: "v.mp4", url: "/f", type: "video/mp4", size: 500 * 1024 * 1024 }] },
    ]);
    expect(results.every((r) => r.passed)).toBe(true);
  });
});

// ────────────────────────────────────────────────
// File extension checks (upload-other)
// ────────────────────────────────────────────────

describe("file extension checks", () => {
  it("passes when extension is in allowed list", () => {
    const s = slot("upload-other", { fileExtensions: ".csv, .json, .txt" });
    const results = validateDeliverables([s], [
      { slotId: "slot-1", files: [{ name: "data.csv", url: "/f", type: "text/csv", size: 100 }] },
    ]);
    const extResults = results.filter((r) => r.check.includes("extensions"));
    expect(extResults.every((r) => r.passed)).toBe(true);
  });

  it("fails when extension is not allowed", () => {
    const s = slot("upload-other", { fileExtensions: ".csv, .json" });
    const results = validateDeliverables([s], [
      { slotId: "slot-1", files: [{ name: "data.xlsx", url: "/f", type: "application/xlsx", size: 100 }] },
    ]);
    const fail = results.find((r) => !r.passed);
    expect(fail).toBeDefined();
    expect(fail!.detail).toContain("xlsx");
  });

  it("is case-insensitive", () => {
    const s = slot("upload-other", { fileExtensions: "CSV" });
    const results = validateDeliverables([s], [
      { slotId: "slot-1", files: [{ name: "DATA.csv", url: "/f", type: "text/csv", size: 100 }] },
    ]);
    const extResults = results.filter((r) => r.check.includes("extensions"));
    expect(extResults.every((r) => r.passed)).toBe(true);
  });
});

// ────────────────────────────────────────────────
// Text length checks (textbox, upload-text)
// ────────────────────────────────────────────────

describe("text length checks", () => {
  it("passes when text is within min/max range", () => {
    const s = slot("textbox", { textMinLength: 5, textMaxLength: 100 });
    const results = validateDeliverables([s], [
      { slotId: "slot-1", text: "Hello world" },
    ]);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it("fails when text is too short", () => {
    const s = slot("textbox", { textMinLength: 10 });
    const results = validateDeliverables([s], [
      { slotId: "slot-1", text: "Hi" },
    ]);
    const fail = results.find((r) => !r.passed);
    expect(fail).toBeDefined();
    expect(fail!.detail).toContain("2 chars");
  });

  it("fails when text is too long", () => {
    const s = slot("textbox", { textMaxLength: 5 });
    const results = validateDeliverables([s], [
      { slotId: "slot-1", text: "This is way too long" },
    ]);
    const fail = results.find((r) => !r.passed);
    expect(fail).toBeDefined();
    expect(fail!.detail).toContain("maximum is 5");
  });

  it("works for upload-text type too", () => {
    const s = slot("upload-text", { textMinLength: 3 });
    const results = validateDeliverables([s], [
      { slotId: "slot-1", text: "OK" },
    ]);
    expect(results.some((r) => !r.passed)).toBe(true);
  });
});

// ────────────────────────────────────────────────
// Text regex checks
// ────────────────────────────────────────────────

describe("text regex checks", () => {
  it("passes when text matches regex", () => {
    const s = slot("textbox", { textRegex: "^[A-Z]" });
    const results = validateDeliverables([s], [
      { slotId: "slot-1", text: "Hello" },
    ]);
    const regexResults = results.filter((r) => r.check.includes("Regex"));
    expect(regexResults.every((r) => r.passed)).toBe(true);
  });

  it("fails when text does not match regex", () => {
    const s = slot("textbox", { textRegex: "^[A-Z]" });
    const results = validateDeliverables([s], [
      { slotId: "slot-1", text: "lowercase" },
    ]);
    const fail = results.find((r) => !r.passed && r.check.includes("Regex"));
    expect(fail).toBeDefined();
    expect(fail!.detail).toContain("does not match");
  });

  it("skips gracefully when regex is invalid", () => {
    const s = slot("textbox", { textRegex: "[invalid(" });
    const results = validateDeliverables([s], [
      { slotId: "slot-1", text: "anything" },
    ]);
    const regexResults = results.filter((r) => r.check.includes("Regex"));
    // Should pass (skip), not crash
    expect(regexResults.every((r) => r.passed)).toBe(true);
  });
});

// ────────────────────────────────────────────────
// Selection count checks (multiple-selection)
// ────────────────────────────────────────────────

describe("selection count checks", () => {
  it("passes when selection count is within range", () => {
    const s = slot("multiple-selection", { minSelections: 2, maxSelections: 4 });
    const results = validateDeliverables([s], [
      { slotId: "slot-1", selections: ["Red", "Blue", "Green"] },
    ]);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it("fails when too few selections", () => {
    const s = slot("multiple-selection", { minSelections: 2 });
    const results = validateDeliverables([s], [
      { slotId: "slot-1", selections: ["Red"] },
    ]);
    const fail = results.find((r) => !r.passed);
    expect(fail).toBeDefined();
    expect(fail!.detail).toContain("Selected 1");
  });

  it("fails when too many selections", () => {
    const s = slot("multiple-selection", { maxSelections: 2 });
    const results = validateDeliverables([s], [
      { slotId: "slot-1", selections: ["Red", "Blue", "Green", "Yellow"] },
    ]);
    const fail = results.find((r) => !r.passed);
    expect(fail).toBeDefined();
    expect(fail!.detail).toContain("Selected 4");
  });
});

// ────────────────────────────────────────────────
// Rating checks
// ────────────────────────────────────────────────

describe("rating checks", () => {
  it("passes when rating is within range", () => {
    const s = slot("rating", { ratingMin: 1, ratingMax: 5 });
    const results = validateDeliverables([s], [
      { slotId: "slot-1", rating: 3 },
    ]);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it("fails when rating is below minimum", () => {
    const s = slot("rating", { ratingMin: 1, ratingMax: 5 });
    const results = validateDeliverables([s], [
      { slotId: "slot-1", rating: 0 },
    ]);
    const fail = results.find((r) => !r.passed);
    expect(fail).toBeDefined();
    expect(fail!.detail).toContain("must be between");
  });

  it("fails when rating is above maximum", () => {
    const s = slot("rating", { ratingMin: 1, ratingMax: 5 });
    const results = validateDeliverables([s], [
      { slotId: "slot-1", rating: 99 },
    ]);
    expect(results.some((r) => !r.passed)).toBe(true);
  });

  it("validates step alignment", () => {
    const s = slot("rating", { ratingMin: 1, ratingMax: 5, ratingStep: 1 });
    const results = validateDeliverables([s], [
      { slotId: "slot-1", rating: 2.5 },
    ]);
    const stepFail = results.find((r) => r.check.includes("step") && !r.passed);
    expect(stepFail).toBeDefined();
  });

  it("allows valid step values", () => {
    const s = slot("rating", { ratingMin: 1, ratingMax: 5, ratingStep: 0.5 });
    const results = validateDeliverables([s], [
      { slotId: "slot-1", rating: 2.5 },
    ]);
    expect(results.every((r) => r.passed)).toBe(true);
  });
});

// ────────────────────────────────────────────────
// Optional slots
// ────────────────────────────────────────────────

describe("optional slots", () => {
  it("skips optional slots with no deliverable", () => {
    const s = slot("textbox", { required: false, textMinLength: 10 });
    const results = validateDeliverables([s], []);
    expect(results.length).toBe(0);
  });

  it("still validates optional slots that have data", () => {
    const s = slot("textbox", { required: false, textMinLength: 10 });
    const results = validateDeliverables([s], [
      { slotId: "slot-1", text: "Hi" },
    ]);
    expect(results.some((r) => !r.passed)).toBe(true);
  });
});

// ────────────────────────────────────────────────
// validateDeliverablesError convenience function
// ────────────────────────────────────────────────

describe("validateDeliverablesError", () => {
  it("returns null when all checks pass", () => {
    const s = slot("textbox", { textMinLength: 1 });
    const err = validateDeliverablesError([s], [{ slotId: "slot-1", text: "Hello" }]);
    expect(err).toBeNull();
  });

  it("returns human-readable error on failure", () => {
    const s = slot("textbox", { title: "Description", textMinLength: 50 });
    const err = validateDeliverablesError([s], [{ slotId: "slot-1", text: "Short" }]);
    expect(err).not.toBeNull();
    expect(err).toContain("Description");
    expect(err).toContain("5 chars");
  });
});

// ────────────────────────────────────────────────
// Multiple slots at once
// ────────────────────────────────────────────────

describe("multiple slots", () => {
  it("validates all slots independently", () => {
    const slots: DeliverableSlot[] = [
      { ...createDefaultSlot("textbox"), id: "s1", textMinLength: 5 },
      { ...createDefaultSlot("rating"), id: "s2", ratingMin: 1, ratingMax: 5 },
      { ...createDefaultSlot("multiple-selection"), id: "s3", minSelections: 1 },
    ];
    const results = validateDeliverables(slots, [
      { slotId: "s1", text: "Hello world" },
      { slotId: "s2", rating: 3 },
      { slotId: "s3", selections: ["A"] },
    ]);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it("reports failures from the correct slot", () => {
    const slots: DeliverableSlot[] = [
      { ...createDefaultSlot("textbox"), id: "s1", title: "Notes", textMinLength: 100 },
      { ...createDefaultSlot("rating"), id: "s2", title: "Score", ratingMin: 1, ratingMax: 5 },
    ];
    const results = validateDeliverables(slots, [
      { slotId: "s1", text: "Too short" },
      { slotId: "s2", rating: 3 },
    ]);
    const fails = results.filter((r) => !r.passed);
    expect(fails.length).toBe(1);
    expect(fails[0].slotTitle).toBe("Notes");
  });
});
