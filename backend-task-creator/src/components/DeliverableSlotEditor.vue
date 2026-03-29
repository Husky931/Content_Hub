<script setup lang="ts">
import { ref, computed } from "vue";

export interface SlotCheck {
  label: string;
}

export interface DeliverableSlot {
  id: string;
  type: SlotType;
  title: string;
  description: string;
  checks: SlotCheck[];
  required?: boolean;
  fileExtensions?: string;
  selectionOptions?: string;
  minSelections?: number;
  maxSelections?: number;
  ratingMin?: number;
  ratingMax?: number;
  ratingStep?: number;
  minFileSize?: number | null;
  minFileSizeUnit?: string;
  maxFileSize?: number | null;
  maxFileSizeUnit?: string;
  tsvColumnPattern?: string;
  tsvCheckMissingColumns?: boolean;
  tsvExactColumnMatch?: boolean;
  srtValidateParsing?: boolean;
  srtNoOverlaps?: boolean;
  textRegex?: string;
  textMinLength?: number | null;
  textMaxLength?: number | null;
  videoDurationMin?: number | null;
  videoDurationMax?: number | null;
  videoDurationOp?: string;
  videoResolution?: string;
  videoResolutionCustom?: string;
  videoAspectRatio?: string;
  videoAspectRatioCustom?: string;
  audioDurationMin?: number | null;
  audioDurationMax?: number | null;
  audioDurationOp?: string;
  imageResolution?: string;
  imageResolutionCustom?: string;
  imageAspectRatio?: string;
  imageAspectRatioCustom?: string;
}

export type SlotType =
  | "upload-text"
  | "upload-tsv"
  | "upload-srt"
  | "upload-video"
  | "upload-image"
  | "upload-audio"
  | "upload-other"
  | "textbox"
  | "multiple-selection"
  | "rating";

const SLOT_TYPES: { value: SlotType; label: string; desc: string; icon: string }[] = [
  { value: "upload-text", label: "Text / Markdown", desc: "Upload .txt or .md files", icon: "📄" },
  { value: "upload-tsv", label: "TSV", desc: "Upload tab-separated data", icon: "📊" },
  { value: "upload-srt", label: "SRT", desc: "Upload subtitle files", icon: "🔤" },
  { value: "upload-video", label: "Video", desc: "Upload video files", icon: "🎬" },
  { value: "upload-image", label: "Image", desc: "Upload image files", icon: "🖼️" },
  { value: "upload-audio", label: "Audio", desc: "Upload audio files", icon: "🎵" },
  { value: "upload-other", label: "Other File", desc: "Custom file extension matching", icon: "📁" },
  { value: "textbox", label: "Textbox", desc: "Free text input field", icon: "⌨️" },
  { value: "multiple-selection", label: "Multiple Selection", desc: "Pick from predefined options", icon: "☑️" },
  { value: "rating", label: "Rating", desc: "Numeric rating scale", icon: "⭐" },
];

function isUploadType(type: string): boolean {
  return type.startsWith("upload-");
}

function createDefaultSlot(type: SlotType): DeliverableSlot {
  return {
    id: crypto.randomUUID(),
    type,
    title: "",
    description: "",
    checks: [],
    required: true,
    fileExtensions: "",
    selectionOptions: "",
    minSelections: 0,
    maxSelections: 0,
    ratingMin: 1,
    ratingMax: 5,
    ratingStep: 1,
    minFileSize: 1,
    minFileSizeUnit: "KB",
    maxFileSize: null,
    maxFileSizeUnit: "MB",
    tsvColumnPattern: "",
    tsvCheckMissingColumns: false,
    tsvExactColumnMatch: false,
    srtValidateParsing: true,
    srtNoOverlaps: true,
    textRegex: "",
    textMinLength: null,
    textMaxLength: null,
    videoDurationMin: 1,
    videoDurationMax: null,
    videoDurationOp: "gte",
    videoResolution: "",
    videoResolutionCustom: "",
    videoAspectRatio: "",
    videoAspectRatioCustom: "",
    audioDurationMin: 1,
    audioDurationMax: null,
    audioDurationOp: "gte",
    imageResolution: "",
    imageResolutionCustom: "",
    imageAspectRatio: "",
    imageAspectRatioCustom: "",
  };
}

function buildChecksFromSlot(slot: DeliverableSlot): SlotCheck[] {
  const checks: SlotCheck[] = [];
  if (isUploadType(slot.type)) {
    if (slot.minFileSize) checks.push({ label: `Min size: ${slot.minFileSize} ${slot.minFileSizeUnit}` });
    if (slot.maxFileSize) checks.push({ label: `Max size: ${slot.maxFileSize} ${slot.maxFileSizeUnit}` });
  }
  if (slot.type === "upload-tsv") {
    if (slot.tsvExactColumnMatch && slot.tsvColumnPattern) checks.push({ label: "Columns: exact match" });
    if (slot.tsvCheckMissingColumns) checks.push({ label: "No missing columns" });
  }
  if (slot.type === "upload-srt") {
    if (slot.srtValidateParsing) checks.push({ label: "SRT format valid" });
    if (slot.srtNoOverlaps) checks.push({ label: "No timestamp overlaps" });
  }
  if (slot.type === "upload-text" || slot.type === "textbox") {
    if (slot.textRegex) checks.push({ label: `Regex: ${slot.textRegex}` });
    if (slot.textMinLength) checks.push({ label: `Min ${slot.textMinLength} chars` });
    if (slot.textMaxLength) checks.push({ label: `Max ${slot.textMaxLength} chars` });
  }
  if (slot.type === "upload-video") {
    if (slot.videoDurationOp === "between" && (slot.videoDurationMin || slot.videoDurationMax)) {
      checks.push({ label: `Duration: ${slot.videoDurationMin ?? "?"}–${slot.videoDurationMax ?? "?"}s` });
    } else if (slot.videoDurationOp === "gte" && slot.videoDurationMin) {
      checks.push({ label: `Duration >= ${slot.videoDurationMin}s` });
    } else if (slot.videoDurationOp === "lte" && slot.videoDurationMax) {
      checks.push({ label: `Duration <= ${slot.videoDurationMax}s` });
    }
    const vRes = slot.videoResolution === "custom" ? slot.videoResolutionCustom : slot.videoResolution;
    if (vRes) checks.push({ label: `Resolution >= ${vRes}` });
    const vRatio = slot.videoAspectRatio === "custom" ? slot.videoAspectRatioCustom : slot.videoAspectRatio;
    if (vRatio) checks.push({ label: `Ratio: ${vRatio}` });
  }
  if (slot.type === "upload-audio") {
    if (slot.audioDurationOp === "between" && (slot.audioDurationMin || slot.audioDurationMax)) {
      checks.push({ label: `Duration: ${slot.audioDurationMin ?? "?"}–${slot.audioDurationMax ?? "?"}s` });
    } else if (slot.audioDurationOp === "gte" && slot.audioDurationMin) {
      checks.push({ label: `Duration >= ${slot.audioDurationMin}s` });
    } else if (slot.audioDurationOp === "lte" && slot.audioDurationMax) {
      checks.push({ label: `Duration <= ${slot.audioDurationMax}s` });
    }
  }
  if (slot.type === "upload-image") {
    const iRes = slot.imageResolution === "custom" ? slot.imageResolutionCustom : slot.imageResolution;
    if (iRes) checks.push({ label: `Resolution >= ${iRes}` });
    const iRatio = slot.imageAspectRatio === "custom" ? slot.imageAspectRatioCustom : slot.imageAspectRatio;
    if (iRatio) checks.push({ label: `Ratio: ${iRatio}` });
  }
  if (slot.type === "upload-other" && slot.fileExtensions) {
    checks.push({ label: `Extensions: ${slot.fileExtensions}` });
  }
  if (slot.type === "multiple-selection") {
    if (slot.minSelections) checks.push({ label: `Min ${slot.minSelections} selected` });
    if (slot.maxSelections) checks.push({ label: `Max ${slot.maxSelections} selected` });
  }
  return checks;
}

const props = defineProps<{
  slots: DeliverableSlot[];
}>();

const emit = defineEmits<{
  (e: "update:slots", slots: DeliverableSlot[]): void;
}>();

const showTypePicker = ref(false);
const expandedSlotId = ref<string | null>(null);

function addSlot(type: SlotType) {
  const slot = createDefaultSlot(type);
  emit("update:slots", [...props.slots, slot]);
  showTypePicker.value = false;
  expandedSlotId.value = slot.id;
}

function removeSlot(index: number) {
  const updated = [...props.slots];
  updated.splice(index, 1);
  emit("update:slots", updated);
}

function cloneSlot(index: number) {
  const original = props.slots[index];
  const cloned: DeliverableSlot = { ...JSON.parse(JSON.stringify(original)), id: crypto.randomUUID() };
  cloned.title = original.title ? `${original.title} (copy)` : "(copy)";
  const updated = [...props.slots];
  updated.splice(index + 1, 0, cloned);
  emit("update:slots", updated);
}

function moveSlot(index: number, direction: -1 | 1) {
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= props.slots.length) return;
  const updated = [...props.slots];
  [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
  emit("update:slots", updated);
}

function updateSlot(index: number, field: string, value: any) {
  const updated = [...props.slots];
  updated[index] = { ...updated[index], [field]: value };
  // Auto-rebuild checks
  updated[index].checks = buildChecksFromSlot(updated[index]);
  emit("update:slots", updated);
}

function toggleExpand(id: string) {
  expandedSlotId.value = expandedSlotId.value === id ? null : id;
}

function slotLabel(type: string): string {
  return SLOT_TYPES.find((s) => s.value === type)?.label || type;
}

function slotIcon(type: string): string {
  return SLOT_TYPES.find((s) => s.value === type)?.icon || "📄";
}

const RESOLUTION_OPTIONS = ["", "720p", "1080p", "1440p", "4K", "custom"];
const ASPECT_RATIO_OPTIONS = ["", "16:9", "4:3", "1:1", "9:16", "custom"];
</script>

<template>
  <div class="slot-editor">
    <!-- Slot list -->
    <div v-if="slots.length > 0" class="slot-list">
      <div v-for="(slot, i) in slots" :key="slot.id" class="slot-card">
        <!-- Slot header -->
        <div class="slot-header" @click="toggleExpand(slot.id)">
          <span class="slot-icon">{{ slotIcon(slot.type) }}</span>
          <span class="slot-type-badge">{{ slotLabel(slot.type) }}</span>
          <span class="slot-title">{{ slot.title || "(untitled)" }}</span>
          <span class="slot-required" :class="slot.required ? 'required' : 'optional'">
            {{ slot.required ? "REQUIRED" : "OPTIONAL" }}
          </span>
          <span class="slot-expand">{{ expandedSlotId === slot.id ? "▾" : "▸" }}</span>
        </div>

        <!-- Checks summary when collapsed -->
        <div v-if="expandedSlotId !== slot.id && slot.checks.length > 0" class="checks-summary">
          <span v-for="(c, ci) in slot.checks" :key="ci" class="check-pill">{{ c.label }}</span>
        </div>

        <!-- Expanded edit form -->
        <div v-if="expandedSlotId === slot.id" class="slot-body">
          <!-- Common fields -->
          <div class="form-row">
            <div class="form-field flex-1">
              <label>Title</label>
              <input :value="slot.title" @input="updateSlot(i, 'title', ($event.target as HTMLInputElement).value)" placeholder="e.g. Main video file" />
            </div>
            <div class="form-field">
              <label>Required</label>
              <select :value="slot.required ? 'yes' : 'no'" @change="updateSlot(i, 'required', ($event.target as HTMLSelectElement).value === 'yes')">
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
          </div>

          <div class="form-field">
            <label>Description</label>
            <textarea :value="slot.description" @input="updateSlot(i, 'description', ($event.target as HTMLTextAreaElement).value)" placeholder="Instructions for this deliverable..." rows="2" />
          </div>

          <!-- File size (all upload types) -->
          <template v-if="isUploadType(slot.type)">
            <div class="subsection-title">File Size Limits</div>
            <div class="form-row">
              <div class="form-field">
                <label>Min Size</label>
                <div class="input-with-unit">
                  <input type="number" :value="slot.minFileSize" @input="updateSlot(i, 'minFileSize', ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : null)" min="0" />
                  <select :value="slot.minFileSizeUnit" @change="updateSlot(i, 'minFileSizeUnit', ($event.target as HTMLSelectElement).value)">
                    <option>KB</option><option>MB</option><option>GB</option>
                  </select>
                </div>
              </div>
              <div class="form-field">
                <label>Max Size</label>
                <div class="input-with-unit">
                  <input type="number" :value="slot.maxFileSize" @input="updateSlot(i, 'maxFileSize', ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : null)" min="0" />
                  <select :value="slot.maxFileSizeUnit" @change="updateSlot(i, 'maxFileSizeUnit', ($event.target as HTMLSelectElement).value)">
                    <option>KB</option><option>MB</option><option>GB</option>
                  </select>
                </div>
              </div>
            </div>
          </template>

          <!-- upload-other: file extensions -->
          <template v-if="slot.type === 'upload-other'">
            <div class="form-field">
              <label>Allowed Extensions (comma-separated)</label>
              <input :value="slot.fileExtensions" @input="updateSlot(i, 'fileExtensions', ($event.target as HTMLInputElement).value)" placeholder=".csv, .xlsx, .json" />
            </div>
          </template>

          <!-- TSV-specific -->
          <template v-if="slot.type === 'upload-tsv'">
            <div class="subsection-title">TSV Validation</div>
            <div class="form-field">
              <label>Expected Column Pattern</label>
              <input :value="slot.tsvColumnPattern" @input="updateSlot(i, 'tsvColumnPattern', ($event.target as HTMLInputElement).value)" placeholder="col1\tcol2\tcol3" />
            </div>
            <div class="form-row">
              <label class="checkbox-label">
                <input type="checkbox" :checked="slot.tsvCheckMissingColumns" @change="updateSlot(i, 'tsvCheckMissingColumns', ($event.target as HTMLInputElement).checked)" />
                Check for missing columns
              </label>
              <label class="checkbox-label">
                <input type="checkbox" :checked="slot.tsvExactColumnMatch" @change="updateSlot(i, 'tsvExactColumnMatch', ($event.target as HTMLInputElement).checked)" />
                Exact column match
              </label>
            </div>
          </template>

          <!-- SRT-specific -->
          <template v-if="slot.type === 'upload-srt'">
            <div class="subsection-title">SRT Validation</div>
            <div class="form-row">
              <label class="checkbox-label">
                <input type="checkbox" :checked="slot.srtValidateParsing" @change="updateSlot(i, 'srtValidateParsing', ($event.target as HTMLInputElement).checked)" />
                Validate SRT parsing
              </label>
              <label class="checkbox-label">
                <input type="checkbox" :checked="slot.srtNoOverlaps" @change="updateSlot(i, 'srtNoOverlaps', ($event.target as HTMLInputElement).checked)" />
                No timestamp overlaps
              </label>
            </div>
          </template>

          <!-- Text / Textbox validation -->
          <template v-if="slot.type === 'upload-text' || slot.type === 'textbox'">
            <div class="subsection-title">Text Validation</div>
            <div class="form-field">
              <label>Regex Pattern</label>
              <input :value="slot.textRegex" @input="updateSlot(i, 'textRegex', ($event.target as HTMLInputElement).value)" placeholder="e.g. ^[A-Z].*" />
            </div>
            <div class="form-row">
              <div class="form-field">
                <label>Min Length</label>
                <input type="number" :value="slot.textMinLength" @input="updateSlot(i, 'textMinLength', ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : null)" min="0" />
              </div>
              <div class="form-field">
                <label>Max Length</label>
                <input type="number" :value="slot.textMaxLength" @input="updateSlot(i, 'textMaxLength', ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : null)" min="0" />
              </div>
            </div>
          </template>

          <!-- Video-specific -->
          <template v-if="slot.type === 'upload-video'">
            <div class="subsection-title">Video Constraints</div>
            <div class="form-row">
              <div class="form-field">
                <label>Duration Rule</label>
                <select :value="slot.videoDurationOp" @change="updateSlot(i, 'videoDurationOp', ($event.target as HTMLSelectElement).value)">
                  <option value="gte">At least (>=)</option>
                  <option value="lte">At most (<=)</option>
                  <option value="between">Between</option>
                </select>
              </div>
              <div class="form-field">
                <label>Min (seconds)</label>
                <input type="number" :value="slot.videoDurationMin" @input="updateSlot(i, 'videoDurationMin', ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : null)" min="0" />
              </div>
              <div class="form-field" v-if="slot.videoDurationOp === 'between' || slot.videoDurationOp === 'lte'">
                <label>Max (seconds)</label>
                <input type="number" :value="slot.videoDurationMax" @input="updateSlot(i, 'videoDurationMax', ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : null)" min="0" />
              </div>
            </div>
            <div class="form-row">
              <div class="form-field">
                <label>Resolution</label>
                <select :value="slot.videoResolution" @change="updateSlot(i, 'videoResolution', ($event.target as HTMLSelectElement).value)">
                  <option v-for="r in RESOLUTION_OPTIONS" :key="r" :value="r">{{ r || '(none)' }}</option>
                </select>
              </div>
              <div class="form-field" v-if="slot.videoResolution === 'custom'">
                <label>Custom Resolution</label>
                <input :value="slot.videoResolutionCustom" @input="updateSlot(i, 'videoResolutionCustom', ($event.target as HTMLInputElement).value)" placeholder="1920x1080" />
              </div>
              <div class="form-field">
                <label>Aspect Ratio</label>
                <select :value="slot.videoAspectRatio" @change="updateSlot(i, 'videoAspectRatio', ($event.target as HTMLSelectElement).value)">
                  <option v-for="r in ASPECT_RATIO_OPTIONS" :key="r" :value="r">{{ r || '(none)' }}</option>
                </select>
              </div>
              <div class="form-field" v-if="slot.videoAspectRatio === 'custom'">
                <label>Custom Ratio</label>
                <input :value="slot.videoAspectRatioCustom" @input="updateSlot(i, 'videoAspectRatioCustom', ($event.target as HTMLInputElement).value)" placeholder="21:9" />
              </div>
            </div>
          </template>

          <!-- Audio-specific -->
          <template v-if="slot.type === 'upload-audio'">
            <div class="subsection-title">Audio Constraints</div>
            <div class="form-row">
              <div class="form-field">
                <label>Duration Rule</label>
                <select :value="slot.audioDurationOp" @change="updateSlot(i, 'audioDurationOp', ($event.target as HTMLSelectElement).value)">
                  <option value="gte">At least (>=)</option>
                  <option value="lte">At most (<=)</option>
                  <option value="between">Between</option>
                </select>
              </div>
              <div class="form-field">
                <label>Min (seconds)</label>
                <input type="number" :value="slot.audioDurationMin" @input="updateSlot(i, 'audioDurationMin', ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : null)" min="0" />
              </div>
              <div class="form-field" v-if="slot.audioDurationOp === 'between' || slot.audioDurationOp === 'lte'">
                <label>Max (seconds)</label>
                <input type="number" :value="slot.audioDurationMax" @input="updateSlot(i, 'audioDurationMax', ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : null)" min="0" />
              </div>
            </div>
          </template>

          <!-- Image-specific -->
          <template v-if="slot.type === 'upload-image'">
            <div class="subsection-title">Image Constraints</div>
            <div class="form-row">
              <div class="form-field">
                <label>Resolution</label>
                <select :value="slot.imageResolution" @change="updateSlot(i, 'imageResolution', ($event.target as HTMLSelectElement).value)">
                  <option v-for="r in RESOLUTION_OPTIONS" :key="r" :value="r">{{ r || '(none)' }}</option>
                </select>
              </div>
              <div class="form-field" v-if="slot.imageResolution === 'custom'">
                <label>Custom Resolution</label>
                <input :value="slot.imageResolutionCustom" @input="updateSlot(i, 'imageResolutionCustom', ($event.target as HTMLInputElement).value)" placeholder="1920x1080" />
              </div>
              <div class="form-field">
                <label>Aspect Ratio</label>
                <select :value="slot.imageAspectRatio" @change="updateSlot(i, 'imageAspectRatio', ($event.target as HTMLSelectElement).value)">
                  <option v-for="r in ASPECT_RATIO_OPTIONS" :key="r" :value="r">{{ r || '(none)' }}</option>
                </select>
              </div>
              <div class="form-field" v-if="slot.imageAspectRatio === 'custom'">
                <label>Custom Ratio</label>
                <input :value="slot.imageAspectRatioCustom" @input="updateSlot(i, 'imageAspectRatioCustom', ($event.target as HTMLInputElement).value)" placeholder="3:2" />
              </div>
            </div>
          </template>

          <!-- Multiple Selection -->
          <template v-if="slot.type === 'multiple-selection'">
            <div class="subsection-title">Selection Options</div>
            <div class="form-field">
              <label>Options (one per line)</label>
              <textarea :value="slot.selectionOptions" @input="updateSlot(i, 'selectionOptions', ($event.target as HTMLTextAreaElement).value)" placeholder="Option A&#10;Option B&#10;Option C" rows="4" />
            </div>
            <div class="form-row">
              <div class="form-field">
                <label>Min Selections</label>
                <input type="number" :value="slot.minSelections" @input="updateSlot(i, 'minSelections', Number(($event.target as HTMLInputElement).value))" min="0" />
              </div>
              <div class="form-field">
                <label>Max Selections</label>
                <input type="number" :value="slot.maxSelections" @input="updateSlot(i, 'maxSelections', Number(($event.target as HTMLInputElement).value))" min="0" />
              </div>
            </div>
          </template>

          <!-- Rating -->
          <template v-if="slot.type === 'rating'">
            <div class="subsection-title">Rating Scale</div>
            <div class="form-row">
              <div class="form-field">
                <label>Min</label>
                <input type="number" :value="slot.ratingMin" @input="updateSlot(i, 'ratingMin', Number(($event.target as HTMLInputElement).value))" />
              </div>
              <div class="form-field">
                <label>Max</label>
                <input type="number" :value="slot.ratingMax" @input="updateSlot(i, 'ratingMax', Number(($event.target as HTMLInputElement).value))" />
              </div>
              <div class="form-field">
                <label>Step</label>
                <input type="number" :value="slot.ratingStep" @input="updateSlot(i, 'ratingStep', Number(($event.target as HTMLInputElement).value))" min="0.1" step="0.1" />
              </div>
            </div>
          </template>

          <!-- Auto-generated checks preview -->
          <div v-if="slot.checks.length > 0" class="checks-preview">
            <div class="subsection-title">Auto-generated Checks</div>
            <span v-for="(c, ci) in slot.checks" :key="ci" class="check-pill">{{ c.label }}</span>
          </div>

          <!-- Slot actions -->
          <div class="slot-actions">
            <button type="button" class="action-btn" @click="moveSlot(i, -1)" :disabled="i === 0" title="Move up">↑</button>
            <button type="button" class="action-btn" @click="moveSlot(i, 1)" :disabled="i === slots.length - 1" title="Move down">↓</button>
            <button type="button" class="action-btn" @click="cloneSlot(i)" title="Clone">⧉</button>
            <button type="button" class="action-btn danger" @click="removeSlot(i)" title="Delete">✕</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else class="empty-state">
      No deliverable slots defined. Click "Add Slot" to define what creators need to submit.
    </div>

    <!-- Type picker -->
    <div v-if="showTypePicker" class="type-picker">
      <div class="type-picker-title">Choose deliverable type:</div>
      <div class="type-grid">
        <button
          v-for="st in SLOT_TYPES"
          :key="st.value"
          type="button"
          class="type-option"
          @click="addSlot(st.value)"
        >
          <span class="type-icon">{{ st.icon }}</span>
          <span class="type-label">{{ st.label }}</span>
          <span class="type-desc">{{ st.desc }}</span>
        </button>
      </div>
      <button type="button" class="cancel-btn" @click="showTypePicker = false">Cancel</button>
    </div>

    <button v-else type="button" class="add-slot-btn" @click="showTypePicker = true">
      + Add Deliverable Slot
    </button>
  </div>
</template>

<style scoped>
.slot-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.slot-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.slot-card {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  overflow: hidden;
  background: #fafafa;
}

.slot-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}

.slot-header:hover {
  background: #f0f0f0;
}

.slot-icon {
  font-size: 18px;
}

.slot-type-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  background: #e8eaf6;
  color: #3949ab;
  text-transform: uppercase;
}

.slot-title {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
  color: #333;
}

.slot-required {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 3px;
  text-transform: uppercase;
}

.slot-required.required {
  background: #e8f5e9;
  color: #2e7d32;
}

.slot-required.optional {
  background: #fff3e0;
  color: #e65100;
}

.slot-expand {
  font-size: 12px;
  color: #999;
}

.checks-summary {
  padding: 0 12px 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.check-pill {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: #e3f2fd;
  color: #1565c0;
}

.slot-body {
  padding: 12px;
  border-top: 1px solid #e0e0e0;
  background: white;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.form-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.form-field.flex-1 {
  flex: 1;
}

.form-field label {
  font-size: 12px;
  font-weight: 600;
  color: #555;
}

.form-field input,
.form-field textarea,
.form-field select {
  padding: 6px 8px;
  border: 1px solid #ddd;
  border-radius: 5px;
  font-size: 13px;
  font-family: inherit;
}

.form-field input:focus,
.form-field textarea:focus,
.form-field select:focus {
  outline: none;
  border-color: #4a90d9;
}

.input-with-unit {
  display: flex;
  gap: 4px;
}

.input-with-unit input {
  width: 80px;
  padding: 6px 8px;
  border: 1px solid #ddd;
  border-radius: 5px;
  font-size: 13px;
}

.input-with-unit select {
  padding: 6px 4px;
  border: 1px solid #ddd;
  border-radius: 5px;
  font-size: 13px;
}

.input-with-unit input:focus,
.input-with-unit select:focus {
  outline: none;
  border-color: #4a90d9;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #444;
  cursor: pointer;
}

.checkbox-label input[type="checkbox"] {
  cursor: pointer;
}

.subsection-title {
  font-size: 12px;
  font-weight: 700;
  color: #777;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-top: 4px;
}

.checks-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.slot-actions {
  display: flex;
  gap: 6px;
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px solid #eee;
}

.action-btn {
  padding: 4px 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
}

.action-btn:hover:not(:disabled) {
  background: #f0f0f0;
}

.action-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.action-btn.danger {
  color: #e53935;
  border-color: #ffcdd2;
}

.action-btn.danger:hover {
  background: #ffebee;
}

.empty-state {
  padding: 16px;
  text-align: center;
  color: #999;
  font-size: 13px;
  background: #fafafa;
  border: 1px dashed #ddd;
  border-radius: 8px;
}

.type-picker {
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 12px;
  background: #fafafa;
}

.type-picker-title {
  font-size: 13px;
  font-weight: 600;
  color: #555;
  margin-bottom: 8px;
}

.type-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 6px;
  margin-bottom: 8px;
}

.type-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 8px;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  background: white;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.type-option:hover {
  border-color: #4a90d9;
  background: #f0f7ff;
}

.type-icon {
  font-size: 22px;
}

.type-label {
  font-size: 12px;
  font-weight: 600;
  color: #333;
}

.type-desc {
  font-size: 10px;
  color: #999;
  text-align: center;
}

.cancel-btn {
  padding: 6px 16px;
  border: 1px solid #ddd;
  border-radius: 5px;
  background: white;
  font-size: 13px;
  cursor: pointer;
}

.cancel-btn:hover {
  background: #f5f5f5;
}

.add-slot-btn {
  padding: 10px 20px;
  border: 2px dashed #ccc;
  border-radius: 8px;
  background: transparent;
  font-size: 14px;
  font-weight: 600;
  color: #666;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}

.add-slot-btn:hover {
  border-color: #4a90d9;
  color: #4a90d9;
}
</style>
