# Issue #31 — Manual QA: Automated Deliverable Checks

Mark each step: **[X]** = pass, **[O]** = fail

---

## Video Checks

**Setup:** As admin, create a task with a Video deliverable slot. Set: min file size 1 KB, duration >= 5s, resolution >= 1920x1080, aspect ratio 16:9. As a creator, go to that task.

### Test A: Valid video passes all checks

- [ ] Upload a 1080p video that is at least 5 seconds long and 16:9
- [ ] Click Submit — should succeed with no errors
- [ ] Confirm the attempt appears as "submitted" in the channel

### Test B: Short video gets rejected

- [ ] Upload a 1080p video that is only 2 seconds long
- [ ] Click Submit — should show an error mentioning duration
- [ ] Confirm no attempt was created

### Test C: Low resolution video gets rejected

- [ ] Upload a 480p video (e.g. 854x480) that is long enough
- [ ] Click Submit — should show an error mentioning resolution
- [ ] Confirm no attempt was created

### Test D: Wrong aspect ratio gets rejected

- [ ] Upload a 4:3 video (e.g. 1440x1080)
- [ ] Click Submit — should show an error mentioning aspect ratio

---

## Audio Checks

**Setup:** Create a task with an Audio deliverable slot. Set: duration >= 10s, max file size 50 MB.

### Test A: Valid audio passes

- [ ] Upload an audio file longer than 10 seconds, under 50 MB
- [ ] Click Submit — should succeed

### Test B: Short audio gets rejected

- [ ] Upload an audio file that is only 3 seconds long
- [ ] Click Submit — should show an error mentioning duration

### Test C: Audio too large gets rejected

- [ ] Upload an audio file bigger than 50 MB
- [ ] Click Submit — should show an error mentioning file size (this one is caught client-side, before even hitting the server)

---

## Image Checks

**Setup:** Create a task with an Image deliverable slot. Set: resolution >= 1920x1080, aspect ratio 16:9.

### Test A: Valid image passes

- [ ] Upload a 1920x1080 (or larger) image with 16:9 ratio
- [ ] Click Submit — should succeed

### Test B: Small image gets rejected

- [ ] Upload a 640x480 image
- [ ] Click Submit — should show an error mentioning resolution

### Test C: Wrong ratio gets rejected

- [ ] Upload a 1920x1920 square image (1:1 ratio)
- [ ] Click Submit — should show an error mentioning aspect ratio

---

## SRT Checks

**Setup:** Create a task with an SRT deliverable slot. Enable both "SRT format valid" and "No timestamp overlaps" in the slot settings.

### Test A: Valid SRT passes

- [ ] Create a valid `.srt` file like this and upload it:
  ```
  1
  00:00:01,000 --> 00:00:03,000
  Hello world

  2
  00:00:04,000 --> 00:00:06,000
  Second subtitle
  ```
- [ ] Click Submit — should succeed

### Test B: Malformed SRT gets rejected

- [ ] Create a broken `.srt` file (bad timestamps):
  ```
  1
  this is not a timestamp
  Hello world
  ```
- [ ] Upload it and click Submit — should show an error mentioning SRT format

### Test C: Overlapping timestamps get rejected

- [ ] Create an `.srt` file where timestamps overlap:
  ```
  1
  00:00:01,000 --> 00:00:05,000
  First subtitle

  2
  00:00:03,000 --> 00:00:07,000
  This overlaps with the first one
  ```
- [ ] Upload it and click Submit — should show an error mentioning timestamp overlap

---

## TSV Checks

**Setup:** Create a task with a TSV deliverable slot. Set the column pattern to `name,age,city`. Enable both "Exact column match" and "No missing columns".

### Test A: Valid TSV passes

- [ ] Create a `.tsv` file with the correct header:
  ```
  name	age	city
  Alice	30	Beijing
  ```
- [ ] Upload it and click Submit — should succeed

### Test B: Wrong column order gets rejected (exact match)

- [ ] Create a `.tsv` file with swapped columns:
  ```
  city	name	age
  Beijing	Alice	30
  ```
- [ ] Upload it and click Submit — should show an error about column mismatch

### Test C: Missing column gets rejected

- [ ] Create a `.tsv` file missing a column:
  ```
  name	age
  Alice	30
  ```
- [ ] Upload it and click Submit — should show an error about missing column "city"

---

## File Extension Check (upload-other)

**Setup:** Create a task with an "Other File" deliverable slot. Set allowed extensions to `.csv, .json`.

### Test A: Allowed extension passes

- [ ] Upload a file named `data.csv`
- [ ] Click Submit — should succeed

### Test B: Wrong extension gets rejected

- [ ] Upload a file named `data.xlsx`
- [ ] Click Submit — should show an error mentioning allowed extensions

---

## File Size Checks (any upload type)

**Setup:** Create a task with any upload slot. Set min file size to 1 KB and max file size to 5 MB.

### Test A: File within range passes

- [ ] Upload a file that is between 1 KB and 5 MB
- [ ] Click Submit — should succeed

### Test B: File too small gets rejected

- [ ] Upload a tiny file under 1 KB (e.g. a text file with one letter)
- [ ] Click Submit — should show an error mentioning minimum size

### Test C: File too large gets rejected

- [ ] Upload a file bigger than 5 MB
- [ ] Click Submit — should show an error mentioning maximum size

---

## Text Length + Regex (textbox / upload-text)

**Setup:** Create a task with a Textbox deliverable slot. Set min length 10, max length 200, regex `^[A-Z]` (must start with uppercase).

### Test A: Valid text passes

- [ ] Type "Hello this is a proper submission" in the textbox
- [ ] Click Submit — should succeed

### Test B: Text too short gets rejected

- [ ] Type "Hi" (only 2 chars)
- [ ] Click Submit — should show an error mentioning minimum characters

### Test C: Text too long gets rejected

- [ ] Paste a 300-character string
- [ ] Click Submit — should show an error mentioning maximum characters

### Test D: Regex fail gets rejected

- [ ] Type "lowercase start of text that is long enough"
- [ ] Click Submit — should show an error mentioning the regex pattern

---

## Selection Count (multiple-selection)

**Setup:** Create a task with a Multiple Selection slot. Set options to "Red, Blue, Green, Yellow". Set min selections 2, max selections 3.

### Test A: Valid selection count passes

- [ ] Select "Red" and "Blue" (2 selections)
- [ ] Click Submit — should succeed

### Test B: Too few selections gets rejected

- [ ] Select only "Red" (1 selection)
- [ ] Click Submit — should show an error mentioning minimum selections

### Test C: Too many selections gets rejected

- [ ] Select all 4 options
- [ ] Click Submit — should show an error mentioning maximum selections

---

## Rating (rating)

**Setup:** Create a task with a Rating slot. Set min 1, max 5, step 1.

### Test A: Valid rating passes

- [ ] Select rating 3
- [ ] Click Submit — should succeed

### Test B: API bypass with out-of-range rating gets rejected

- [ ] Open browser console and submit directly with rating 99:
  ```js
  fetch('/api/tasks/TASK_ID/attempts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deliverables: { slots: [{ slotId: 'SLOT_ID', rating: 99 }] }
    })
  }).then(r => r.json()).then(console.log)
  ```
- [ ] Confirm the response is an error about rating range

---

## Notes

- Replace `TASK_ID` and `SLOT_ID` with real UUIDs from your database
- Video/audio/image checks only run server-side — the client checks file size but the server does the ffprobe/image probe
- If a file can't be fetched by the server (e.g. OSS unreachable), those checks are skipped gracefully — the submission goes through
- TSV files use **tab** separators, not commas — make sure your test files use actual tabs
