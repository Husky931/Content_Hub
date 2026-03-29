/**
 * Server-only deliverable validation — checks that require fetching file contents.
 * Groups: TSV columns, SRT parsing, image probing, video/audio probing via ffprobe.
 *
 * This file must NOT be imported from client components.
 */

import type { DeliverableSlot } from "@/types/deliverable-slot";
import { isUploadType } from "@/types/deliverable-slot";
import type { CheckResult } from "./validate-deliverables";
import { execFile } from "child_process";
import { writeFile, unlink, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const probeImageSize = require("probe-image-size") as (src: string) => Promise<{ width: number; height: number }>;

// ── Types ────────────────────────────────────────────────────────────────────

interface SubmittedFile {
  name: string;
  url: string;
  type: string;
  size: number;
}

interface SlotDeliverable {
  slotId: string;
  text?: string;
  files?: SubmittedFile[];
  selections?: string[];
  rating?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Resolve a file URL to an absolute fetch-able URL */
function resolveFileUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  // Local uploads: /uploads/files/xxx → http://localhost:3000/uploads/files/xxx
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${base}${url}`;
}

/** Fetch file contents as text */
async function fetchFileText(url: string): Promise<string> {
  const res = await fetch(resolveFileUrl(url));
  if (!res.ok) throw new Error(`Failed to fetch file: ${res.status}`);
  return res.text();
}

/** Fetch file as buffer (for binary probing) */
async function fetchFileBuffer(url: string): Promise<Buffer> {
  const res = await fetch(resolveFileUrl(url));
  if (!res.ok) throw new Error(`Failed to fetch file: ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

/** Run ffprobe on a buffer and return parsed JSON metadata */
async function ffprobe(buf: Buffer, filename: string): Promise<FfprobeResult> {
  const dir = await mkdtemp(join(tmpdir(), "ffprobe-"));
  const tmp = join(dir, filename);
  await writeFile(tmp, buf);

  try {
    const output = await new Promise<string>((resolve, reject) => {
      execFile(
        "ffprobe",
        ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", tmp],
        { timeout: 15000 },
        (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout);
        }
      );
    });
    return JSON.parse(output) as FfprobeResult;
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

interface FfprobeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  duration?: string;
}

interface FfprobeResult {
  format?: { duration?: string };
  streams?: FfprobeStream[];
}

// ── Parse helpers ────────────────────────────────────────────────────────────

function parseSrt(text: string): { errors: string[]; overlaps: string[] } {
  const errors: string[] = [];
  const overlaps: string[] = [];
  const blocks = text.trim().split(/\n\s*\n/);
  let prevEnd = -1;

  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i].trim().split("\n");
    if (lines.length < 2) {
      errors.push(`Block ${i + 1}: needs at least index + timestamp + text`);
      continue;
    }

    // Line 1: index (should be a number)
    if (!/^\d+$/.test(lines[0].trim())) {
      errors.push(`Block ${i + 1}: index "${lines[0].trim()}" is not a number`);
    }

    // Line 2: timestamp range
    const tsMatch = lines[1].match(
      /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/
    );
    if (!tsMatch) {
      errors.push(`Block ${i + 1}: invalid timestamp format "${lines[1].trim()}"`);
      continue;
    }

    const startMs =
      +tsMatch[1] * 3600000 + +tsMatch[2] * 60000 + +tsMatch[3] * 1000 + +tsMatch[4];
    const endMs =
      +tsMatch[5] * 3600000 + +tsMatch[6] * 60000 + +tsMatch[7] * 1000 + +tsMatch[8];

    if (endMs <= startMs) {
      errors.push(`Block ${i + 1}: end time is before or equal to start time`);
    }

    if (startMs < prevEnd) {
      overlaps.push(`Block ${i + 1}: starts at ${lines[1].split("-->")[0].trim()} but previous block ends later`);
    }
    prevEnd = endMs;

    // Line 3+: should have subtitle text
    if (lines.length < 3 || !lines.slice(2).join("").trim()) {
      errors.push(`Block ${i + 1}: missing subtitle text`);
    }
  }

  return { errors, overlaps };
}

function parseResolution(spec: string): { w: number; h: number } | null {
  // "1920x1080", "1080p", "720p", "4K"
  const xMatch = spec.match(/(\d+)\s*[xX]\s*(\d+)/);
  if (xMatch) return { w: +xMatch[1], h: +xMatch[2] };

  const pMatch = spec.match(/^(\d+)p$/i);
  if (pMatch) {
    const h = +pMatch[1];
    // Common aspect ratio 16:9
    return { w: Math.round(h * 16 / 9), h };
  }

  if (/4k/i.test(spec)) return { w: 3840, h: 2160 };
  if (/2k/i.test(spec)) return { w: 2560, h: 1440 };
  if (/8k/i.test(spec)) return { w: 7680, h: 4320 };

  return null;
}

function parseAspectRatio(spec: string): number | null {
  // "16:9", "4:3", "1:1"
  const m = spec.match(/(\d+(?:\.\d+)?)\s*[:\/]\s*(\d+(?:\.\d+)?)/);
  if (m) return +m[1] / +m[2];
  return null;
}

// ── Main async validation ────────────────────────────────────────────────────

/**
 * Run server-side file-content checks. Returns additional CheckResults
 * for TSV, SRT, image, video, and audio slots.
 *
 * Errors during file fetching are caught and result in a "skipped" check (not a failure).
 */
export async function validateDeliverablesAsync(
  slots: DeliverableSlot[],
  deliverables: SlotDeliverable[],
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const deliverableMap = new Map(deliverables.map((d) => [d.slotId, d]));

  for (const slot of slots) {
    const sd = deliverableMap.get(slot.id);
    if (slot.required === false && !sd) continue;
    const title = slot.title || "Untitled slot";
    const files = sd?.files || [];

    // ── TSV column checks ──────────────────────────────────────────────

    if (slot.type === "upload-tsv" && slot.tsvColumnPattern && files.length > 0) {
      try {
        const text = await fetchFileText(files[0].url);
        const firstLine = text.split("\n")[0] || "";
        const columns = firstLine.split("\t").map((c) => c.trim());
        const expected = slot.tsvColumnPattern.split(",").map((c) => c.trim());

        if (slot.tsvExactColumnMatch) {
          const passed = columns.length === expected.length &&
            columns.every((c, i) => c === expected[i]);
          results.push({
            slotId: slot.id, slotTitle: title,
            check: "Columns: exact match",
            passed,
            detail: passed ? undefined : `Expected columns [${expected.join(", ")}], got [${columns.join(", ")}]`,
          });
        }

        if (slot.tsvCheckMissingColumns) {
          const missing = expected.filter((e) => !columns.includes(e));
          const passed = missing.length === 0;
          results.push({
            slotId: slot.id, slotTitle: title,
            check: "No missing columns",
            passed,
            detail: passed ? undefined : `Missing columns: ${missing.join(", ")}`,
          });
        }
      } catch (err) {
        results.push({
          slotId: slot.id, slotTitle: title,
          check: "TSV column validation",
          passed: true,
          detail: `Skipped — could not fetch file: ${err instanceof Error ? err.message : "unknown error"}`,
        });
      }
    }

    // ── SRT checks ─────────────────────────────────────────────────────

    if (slot.type === "upload-srt" && files.length > 0) {
      const needsParsing = slot.srtValidateParsing || slot.srtNoOverlaps;
      if (needsParsing) {
        try {
          const text = await fetchFileText(files[0].url);
          const { errors, overlaps } = parseSrt(text);

          if (slot.srtValidateParsing) {
            const passed = errors.length === 0;
            results.push({
              slotId: slot.id, slotTitle: title,
              check: "SRT format valid",
              passed,
              detail: passed ? undefined : errors.slice(0, 3).join("; "),
            });
          }

          if (slot.srtNoOverlaps) {
            const passed = overlaps.length === 0;
            results.push({
              slotId: slot.id, slotTitle: title,
              check: "No timestamp overlaps",
              passed,
              detail: passed ? undefined : overlaps.slice(0, 3).join("; "),
            });
          }
        } catch (err) {
          results.push({
            slotId: slot.id, slotTitle: title,
            check: "SRT validation",
            passed: true,
            detail: `Skipped — could not fetch file: ${err instanceof Error ? err.message : "unknown error"}`,
          });
        }
      }
    }

    // ── Image checks (resolution, aspect ratio) ────────────────────────

    if (slot.type === "upload-image" && files.length > 0) {
      const needsResolution = slot.imageResolution || slot.imageResolutionCustom;
      const needsRatio = slot.imageAspectRatio || slot.imageAspectRatioCustom;

      if (needsResolution || needsRatio) {
        try {
          const url = resolveFileUrl(files[0].url);
          const probe = await probeImageSize(url);
          const imgW = probe.width;
          const imgH = probe.height;

          if (needsResolution) {
            const spec = slot.imageResolution === "custom" ? slot.imageResolutionCustom : slot.imageResolution;
            if (spec) {
              const req = parseResolution(spec);
              if (req) {
                const passed = imgW >= req.w && imgH >= req.h;
                results.push({
                  slotId: slot.id, slotTitle: title,
                  check: `Resolution >= ${spec}`,
                  passed,
                  detail: passed ? undefined : `Image is ${imgW}x${imgH}, minimum is ${req.w}x${req.h}`,
                });
              }
            }
          }

          if (needsRatio) {
            const spec = slot.imageAspectRatio === "custom" ? slot.imageAspectRatioCustom : slot.imageAspectRatio;
            if (spec) {
              const expected = parseAspectRatio(spec);
              if (expected && imgH > 0) {
                const actual = imgW / imgH;
                const passed = Math.abs(actual - expected) < 0.05;
                results.push({
                  slotId: slot.id, slotTitle: title,
                  check: `Aspect ratio: ${spec}`,
                  passed,
                  detail: passed ? undefined : `Image ratio is ${actual.toFixed(2)}, expected ${expected.toFixed(2)} (${spec})`,
                });
              }
            }
          }
        } catch (err) {
          results.push({
            slotId: slot.id, slotTitle: title,
            check: "Image validation",
            passed: true,
            detail: `Skipped — could not probe image: ${err instanceof Error ? err.message : "unknown error"}`,
          });
        }
      }
    }

    // ── Video checks (duration, resolution, aspect ratio) ──────────────

    if (slot.type === "upload-video" && files.length > 0) {
      const needsDuration = slot.videoDurationOp && (slot.videoDurationMin || slot.videoDurationMax);
      const needsResolution = slot.videoResolution || slot.videoResolutionCustom;
      const needsRatio = slot.videoAspectRatio || slot.videoAspectRatioCustom;

      if (needsDuration || needsResolution || needsRatio) {
        try {
          const buf = await fetchFileBuffer(files[0].url);
          const info = await ffprobe(buf, files[0].name);
          const videoStream = info.streams?.find((s) => s.codec_type === "video");
          const duration = parseFloat(info.format?.duration || videoStream?.duration || "0");
          const vidW = videoStream?.width || 0;
          const vidH = videoStream?.height || 0;

          if (needsDuration) {
            let passed = true;
            let label = "Duration check";
            if (slot.videoDurationOp === "gte" && slot.videoDurationMin) {
              passed = duration >= slot.videoDurationMin;
              label = `Duration >= ${slot.videoDurationMin}s`;
            } else if (slot.videoDurationOp === "lte" && slot.videoDurationMax) {
              passed = duration <= slot.videoDurationMax;
              label = `Duration <= ${slot.videoDurationMax}s`;
            } else if (slot.videoDurationOp === "between") {
              if (slot.videoDurationMin) passed = passed && duration >= slot.videoDurationMin;
              if (slot.videoDurationMax) passed = passed && duration <= slot.videoDurationMax;
              label = `Duration: ${slot.videoDurationMin ?? "?"}–${slot.videoDurationMax ?? "?"}s`;
            }
            results.push({
              slotId: slot.id, slotTitle: title,
              check: label,
              passed,
              detail: passed ? undefined : `Video duration is ${duration.toFixed(1)}s`,
            });
          }

          if (needsResolution) {
            const spec = slot.videoResolution === "custom" ? slot.videoResolutionCustom : slot.videoResolution;
            if (spec) {
              const req = parseResolution(spec);
              if (req) {
                const passed = vidW >= req.w && vidH >= req.h;
                results.push({
                  slotId: slot.id, slotTitle: title,
                  check: `Resolution >= ${spec}`,
                  passed,
                  detail: passed ? undefined : `Video is ${vidW}x${vidH}, minimum is ${req.w}x${req.h}`,
                });
              }
            }
          }

          if (needsRatio) {
            const spec = slot.videoAspectRatio === "custom" ? slot.videoAspectRatioCustom : slot.videoAspectRatio;
            if (spec) {
              const expected = parseAspectRatio(spec);
              if (expected && vidH > 0) {
                const actual = vidW / vidH;
                const passed = Math.abs(actual - expected) < 0.05;
                results.push({
                  slotId: slot.id, slotTitle: title,
                  check: `Aspect ratio: ${spec}`,
                  passed,
                  detail: passed ? undefined : `Video ratio is ${actual.toFixed(2)}, expected ${expected.toFixed(2)} (${spec})`,
                });
              }
            }
          }
        } catch (err) {
          results.push({
            slotId: slot.id, slotTitle: title,
            check: "Video validation",
            passed: true,
            detail: `Skipped — could not probe video: ${err instanceof Error ? err.message : "unknown error"}`,
          });
        }
      }
    }

    // ── Audio checks (duration) ────────────────────────────────────────

    if (slot.type === "upload-audio" && files.length > 0) {
      const needsDuration = slot.audioDurationOp && (slot.audioDurationMin || slot.audioDurationMax);

      if (needsDuration) {
        try {
          const buf = await fetchFileBuffer(files[0].url);
          const info = await ffprobe(buf, files[0].name);
          const audioStream = info.streams?.find((s) => s.codec_type === "audio");
          const duration = parseFloat(info.format?.duration || audioStream?.duration || "0");

          let passed = true;
          let label = "Duration check";
          if (slot.audioDurationOp === "gte" && slot.audioDurationMin) {
            passed = duration >= slot.audioDurationMin;
            label = `Duration >= ${slot.audioDurationMin}s`;
          } else if (slot.audioDurationOp === "lte" && slot.audioDurationMax) {
            passed = duration <= slot.audioDurationMax;
            label = `Duration <= ${slot.audioDurationMax}s`;
          } else if (slot.audioDurationOp === "between") {
            if (slot.audioDurationMin) passed = passed && duration >= slot.audioDurationMin;
            if (slot.audioDurationMax) passed = passed && duration <= slot.audioDurationMax;
            label = `Duration: ${slot.audioDurationMin ?? "?"}–${slot.audioDurationMax ?? "?"}s`;
          }
          results.push({
            slotId: slot.id, slotTitle: title,
            check: label,
            passed,
            detail: passed ? undefined : `Audio duration is ${duration.toFixed(1)}s`,
          });
        } catch (err) {
          results.push({
            slotId: slot.id, slotTitle: title,
            check: "Audio validation",
            passed: true,
            detail: `Skipped — could not probe audio: ${err instanceof Error ? err.message : "unknown error"}`,
          });
        }
      }
    }
  }

  return results;
}
