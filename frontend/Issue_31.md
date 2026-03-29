# Issue #31 — Automated Deliverable Checks

Validation runs on both client and server:
- **Client** (TaskCard.tsx) — metadata checks only (instant feedback)
- **Server** (POST /api/tasks/[taskId]/attempts) — metadata checks + file-content checks

Code:
- `src/lib/validate-deliverables.ts` — shared client+server (metadata)
- `src/lib/validate-deliverables-server.ts` — server-only (TSV, SRT, image, video, audio)

---

## Text / Markdown (upload-text)

- Min File Size — (X)
- Max File Size — (X)
- Text Regex — (X)
- Text Min Length — (X)
- Text Max Length — (X)

## TSV (upload-tsv)

- Min File Size — (X)
- Max File Size — (X)
- Column Exact Match — (X)
- No Missing Columns — (X)

## SRT (upload-srt)

- Min File Size — (X)
- Max File Size — (X)
- SRT Format Valid — (X)
- No Timestamp Overlaps — (X)

## Video (upload-video)

- Min File Size — (X)
- Max File Size — (X)
- Duration — (X)
- Resolution — (X)
- Aspect Ratio — (X)

## Image (upload-image)

- Min File Size — (X)
- Max File Size — (X)
- Resolution — (X)
- Aspect Ratio — (X)

## Audio (upload-audio)

- Min File Size — (X)
- Max File Size — (X)
- Duration — (X)

## Other File (upload-other)

- Min File Size — (X)
- Max File Size — (X)
- File Extensions — (X)

## Textbox (textbox)

- Text Regex — (X)
- Text Min Length — (X)
- Text Max Length — (X)

## Multiple Selection (multiple-selection)

- Min Selections — (X)
- Max Selections — (X)

## Rating (rating)

- Rating Range (min/max) — (X)
- Rating Step — (X)

---

## Score: 33/33 checks implemented

### Production requirement

- Dockerfile updated to install `ffmpeg` (for video/audio probing)
- `probe-image-size` npm package added (for image dimension reading)
- File-content checks (TSV, SRT, image, video, audio) gracefully skip if the file can't be fetched — they don't block submission
