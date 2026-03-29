import { validateDeliverablesAsync } from "@/lib/validate-deliverables-server";
import type { DeliverableSlot } from "@/types/deliverable-slot";
import { createDefaultSlot } from "@/types/deliverable-slot";

// Helper
function slot(type: DeliverableSlot["type"], overrides: Partial<DeliverableSlot> = {}): DeliverableSlot {
  return { ...createDefaultSlot(type), id: "slot-1", ...overrides };
}

// Mock global fetch for file content tests
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function mockFetchText(content: string) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    text: async () => content,
    arrayBuffer: async () => Buffer.from(content),
  });
}

function mockFetchFail() {
  mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ────────────────────────────────────────────────
// TSV column checks
// ────────────────────────────────────────────────

describe("TSV column checks", () => {
  it("passes when columns match exactly", async () => {
    const s = slot("upload-tsv", {
      tsvColumnPattern: "name,age,city",
      tsvExactColumnMatch: true,
    });
    mockFetchText("name\tage\tcity\nAlice\t30\tBeijing\n");

    const results = await validateDeliverablesAsync([s], [
      { slotId: "slot-1", files: [{ name: "data.tsv", url: "/uploads/data.tsv", type: "text/tsv", size: 100 }] },
    ]);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it("fails when columns are in wrong order (exact match)", async () => {
    const s = slot("upload-tsv", {
      tsvColumnPattern: "name,age,city",
      tsvExactColumnMatch: true,
    });
    mockFetchText("city\tname\tage\nBeijing\tAlice\t30\n");

    const results = await validateDeliverablesAsync([s], [
      { slotId: "slot-1", files: [{ name: "data.tsv", url: "/uploads/data.tsv", type: "text/tsv", size: 100 }] },
    ]);
    const fail = results.find((r) => !r.passed);
    expect(fail).toBeDefined();
    expect(fail!.check).toContain("exact match");
  });

  it("fails when columns are missing", async () => {
    const s = slot("upload-tsv", {
      tsvColumnPattern: "name,age,city",
      tsvCheckMissingColumns: true,
    });
    mockFetchText("name\tage\nAlice\t30\n");

    const results = await validateDeliverablesAsync([s], [
      { slotId: "slot-1", files: [{ name: "data.tsv", url: "/uploads/data.tsv", type: "text/tsv", size: 100 }] },
    ]);
    const fail = results.find((r) => !r.passed);
    expect(fail).toBeDefined();
    expect(fail!.detail).toContain("city");
  });

  it("passes when all required columns are present (any order)", async () => {
    const s = slot("upload-tsv", {
      tsvColumnPattern: "name,age,city",
      tsvCheckMissingColumns: true,
      tsvExactColumnMatch: false,
    });
    mockFetchText("city\tname\tage\textra\nBeijing\tAlice\t30\tX\n");

    const results = await validateDeliverablesAsync([s], [
      { slotId: "slot-1", files: [{ name: "data.tsv", url: "/uploads/data.tsv", type: "text/tsv", size: 100 }] },
    ]);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it("skips gracefully when file fetch fails", async () => {
    const s = slot("upload-tsv", {
      tsvColumnPattern: "name,age",
      tsvExactColumnMatch: true,
    });
    mockFetchFail();

    const results = await validateDeliverablesAsync([s], [
      { slotId: "slot-1", files: [{ name: "data.tsv", url: "/uploads/data.tsv", type: "text/tsv", size: 100 }] },
    ]);
    // Should not fail — skipped
    expect(results.every((r) => r.passed)).toBe(true);
    expect(results[0].detail).toContain("Skipped");
  });
});

// ────────────────────────────────────────────────
// SRT checks
// ────────────────────────────────────────────────

describe("SRT checks", () => {
  const validSrt = `1
00:00:01,000 --> 00:00:03,000
Hello world

2
00:00:04,000 --> 00:00:06,000
Second subtitle
`;

  it("passes for a valid SRT file", async () => {
    const s = slot("upload-srt", { srtValidateParsing: true, srtNoOverlaps: true });
    mockFetchText(validSrt);

    const results = await validateDeliverablesAsync([s], [
      { slotId: "slot-1", files: [{ name: "sub.srt", url: "/uploads/sub.srt", type: "text/srt", size: 100 }] },
    ]);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it("fails for malformed SRT (bad timestamp)", async () => {
    const badSrt = `1
this is not a timestamp
Hello world
`;
    const s = slot("upload-srt", { srtValidateParsing: true });
    mockFetchText(badSrt);

    const results = await validateDeliverablesAsync([s], [
      { slotId: "slot-1", files: [{ name: "sub.srt", url: "/uploads/sub.srt", type: "text/srt", size: 100 }] },
    ]);
    const fail = results.find((r) => !r.passed);
    expect(fail).toBeDefined();
    expect(fail!.check).toContain("SRT format");
  });

  it("fails when timestamps overlap", async () => {
    const overlapSrt = `1
00:00:01,000 --> 00:00:05,000
First subtitle

2
00:00:03,000 --> 00:00:07,000
This overlaps
`;
    const s = slot("upload-srt", { srtNoOverlaps: true });
    mockFetchText(overlapSrt);

    const results = await validateDeliverablesAsync([s], [
      { slotId: "slot-1", files: [{ name: "sub.srt", url: "/uploads/sub.srt", type: "text/srt", size: 100 }] },
    ]);
    const fail = results.find((r) => !r.passed && r.check.includes("overlap"));
    expect(fail).toBeDefined();
  });

  it("skips when file fetch fails", async () => {
    const s = slot("upload-srt", { srtValidateParsing: true });
    mockFetchFail();

    const results = await validateDeliverablesAsync([s], [
      { slotId: "slot-1", files: [{ name: "sub.srt", url: "/uploads/sub.srt", type: "text/srt", size: 100 }] },
    ]);
    expect(results.every((r) => r.passed)).toBe(true);
    expect(results[0].detail).toContain("Skipped");
  });
});

// ────────────────────────────────────────────────
// Slots that don't need async checks are skipped
// ────────────────────────────────────────────────

describe("no-op for metadata-only slots", () => {
  it("returns empty results for textbox", async () => {
    const s = slot("textbox", { textMinLength: 5 });
    const results = await validateDeliverablesAsync([s], [
      { slotId: "slot-1", text: "Hi" },
    ]);
    expect(results.length).toBe(0);
  });

  it("returns empty results for rating", async () => {
    const s = slot("rating", { ratingMin: 1, ratingMax: 5 });
    const results = await validateDeliverablesAsync([s], [
      { slotId: "slot-1", rating: 3 },
    ]);
    expect(results.length).toBe(0);
  });

  it("returns empty results for multiple-selection", async () => {
    const s = slot("multiple-selection", { minSelections: 1 });
    const results = await validateDeliverablesAsync([s], [
      { slotId: "slot-1", selections: ["A"] },
    ]);
    expect(results.length).toBe(0);
  });
});

// ────────────────────────────────────────────────
// Image, video, audio — probe-based tests
// These need real files so we just test the skip behavior
// and verify the function doesn't crash on unreachable files
// ────────────────────────────────────────────────

describe("image checks (graceful skip on failure)", () => {
  it("skips when image cannot be probed", async () => {
    const s = slot("upload-image", { imageResolution: "1920x1080" });
    // probe-image-size will fail on a non-existent URL
    const results = await validateDeliverablesAsync([s], [
      { slotId: "slot-1", files: [{ name: "img.png", url: "http://localhost:99999/fake.png", type: "image/png", size: 1000 }] },
    ]);
    expect(results.every((r) => r.passed)).toBe(true);
    expect(results[0].detail).toContain("Skipped");
  });
});

describe("video checks (graceful skip on failure)", () => {
  it("skips when video cannot be fetched", async () => {
    const s = slot("upload-video", { videoDurationOp: "gte", videoDurationMin: 5 });
    mockFetchFail();

    const results = await validateDeliverablesAsync([s], [
      { slotId: "slot-1", files: [{ name: "vid.mp4", url: "/uploads/fake.mp4", type: "video/mp4", size: 1000 }] },
    ]);
    expect(results.every((r) => r.passed)).toBe(true);
    expect(results[0].detail).toContain("Skipped");
  });
});

describe("audio checks (graceful skip on failure)", () => {
  it("skips when audio cannot be fetched", async () => {
    const s = slot("upload-audio", { audioDurationOp: "gte", audioDurationMin: 10 });
    mockFetchFail();

    const results = await validateDeliverablesAsync([s], [
      { slotId: "slot-1", files: [{ name: "audio.mp3", url: "/uploads/fake.mp3", type: "audio/mp3", size: 1000 }] },
    ]);
    expect(results.every((r) => r.passed)).toBe(true);
    expect(results[0].detail).toContain("Skipped");
  });
});
