<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import FileUpload from "./FileUpload.vue";
import type { UploadedFile } from "./FileUpload.vue";
import DeliverableSlotEditor from "./DeliverableSlotEditor.vue";
import type { DeliverableSlot } from "./DeliverableSlotEditor.vue";

const FRONTEND_URL = import.meta.env.VITE_FRONTEND_URL || "http://localhost:3000";
const API_KEY = import.meta.env.VITE_BACKEND_API_KEY || "test-api-key";

// Channel list (fetched from frontend)
interface Channel {
  slug: string;
  name: string;
  nameCn: string | null;
}
const availableChannels = ref<Channel[]>([]);
const channelsLoading = ref(false);
const channelsError = ref("");

// Form fields
const channelSlug = ref("");
const title = ref("");
const titleCn = ref("");
const description = ref("");
const descriptionCn = ref("");
const bountyUsd = ref("");
const bountyRmb = ref("");
const bonusBountyUsd = ref("");
const bonusBountyRmb = ref("");
const maxAttempts = ref(5);
const deadline = ref("");

function generateExternalId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "ext-";
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

const externalId = ref(generateExternalId());

async function fetchChannels() {
  channelsLoading.value = true;
  channelsError.value = "";
  try {
    const res = await fetch(`${FRONTEND_URL}/api/tasks/sync`, {
      headers: { "X-API-Key": API_KEY },
    });
    if (!res.ok) {
      const data = await res.json();
      channelsError.value = data.error || `Error ${res.status}`;
      return;
    }
    const data = await res.json();
    availableChannels.value = data.channels || [];
    if (availableChannels.value.length > 0 && !channelSlug.value) {
      channelSlug.value = availableChannels.value[0].slug;
    }
  } catch (err: any) {
    channelsError.value = `Cannot reach frontend: ${err.message}`;
  } finally {
    channelsLoading.value = false;
  }
}

onMounted(fetchChannels);

// Checklist (review)
const checklistItems = ref<string[]>([]);
const newChecklistItem = ref("");

// Self-checklist (creator guidance)
const selfChecklistItems = ref<string[]>([]);
const newSelfChecklistItem = ref("");

// Deliverable slots
const deliverableSlots = ref<DeliverableSlot[]>([]);

// Attachments
const attachments = ref<UploadedFile[]>([]);

// State
const submitting = ref(false);
const result = ref<{ success: boolean; message: string } | null>(null);

const canSubmit = computed(
  () => channelSlug.value && title.value && description.value && !submitting.value
);

function addChecklistItem() {
  const text = newChecklistItem.value.trim();
  if (!text) return;
  checklistItems.value.push(text);
  newChecklistItem.value = "";
}

function removeChecklistItem(index: number) {
  checklistItems.value.splice(index, 1);
}

function handleChecklistKeydown(e: KeyboardEvent) {
  if (e.key === "Enter") {
    e.preventDefault();
    addChecklistItem();
  }
}

function addSelfChecklistItem() {
  const text = newSelfChecklistItem.value.trim();
  if (!text) return;
  selfChecklistItems.value.push(text);
  newSelfChecklistItem.value = "";
}

function removeSelfChecklistItem(index: number) {
  selfChecklistItems.value.splice(index, 1);
}

function handleSelfChecklistKeydown(e: KeyboardEvent) {
  if (e.key === "Enter") {
    e.preventDefault();
    addSelfChecklistItem();
  }
}

async function handleSubmit() {
  submitting.value = true;
  result.value = null;

  const payload: Record<string, any> = {
    channelSlug: channelSlug.value,
    title: title.value,
    description: description.value,
    maxAttempts: maxAttempts.value,
  };

  if (titleCn.value) payload.titleCn = titleCn.value;
  if (descriptionCn.value) payload.descriptionCn = descriptionCn.value;
  if (bountyUsd.value) payload.bountyUsd = bountyUsd.value;
  if (bountyRmb.value) payload.bountyRmb = bountyRmb.value;
  if (bonusBountyUsd.value) payload.bonusBountyUsd = bonusBountyUsd.value;
  if (bonusBountyRmb.value) payload.bonusBountyRmb = bonusBountyRmb.value;
  if (deadline.value) payload.deadline = new Date(deadline.value).toISOString();
  if (externalId.value) payload.externalId = externalId.value;

  if (checklistItems.value.length > 0) {
    payload.checklist = checklistItems.value.map((label) => ({ label }));
  }

  if (selfChecklistItems.value.length > 0) {
    payload.selfChecklist = selfChecklistItems.value.map((label) => ({ label }));
  }

  if (deliverableSlots.value.length > 0) {
    payload.deliverableSlots = deliverableSlots.value;
  }

  if (attachments.value.length > 0) {
    payload.attachments = attachments.value.map((f) => ({
      name: f.name,
      url: f.url,
      type: f.type,
      size: f.size,
    }));
  }

  try {
    const res = await fetch(`${FRONTEND_URL}/api/tasks/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": API_KEY,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (res.ok) {
      result.value = {
        success: true,
        message: `Task synced successfully! ID: ${data.task?.id}`,
      };
      // Reset form
      title.value = "";
      titleCn.value = "";
      description.value = "";
      descriptionCn.value = "";
      bountyUsd.value = "";
      bountyRmb.value = "";
      bonusBountyUsd.value = "";
      bonusBountyRmb.value = "";
      maxAttempts.value = 5;
      deadline.value = "";
      externalId.value = generateExternalId();
      checklistItems.value = [];
      selfChecklistItems.value = [];
      deliverableSlots.value = [];
      attachments.value = [];
    } else {
      result.value = {
        success: false,
        message: `Error ${res.status}: ${data.error || "Unknown error"}`,
      };
    }
  } catch (err: any) {
    result.value = {
      success: false,
      message: `Network error: ${err.message}. Is the frontend running on ${FRONTEND_URL}?`,
    };
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <form class="task-form" @submit.prevent="handleSubmit">
    <!-- Result banner -->
    <div v-if="result" class="result" :class="result.success ? 'success' : 'error'">
      {{ result.message }}
      <button class="dismiss" @click="result = null">x</button>
    </div>

    <!-- Channel -->
    <div class="field">
      <label>Target Channel *</label>
      <div v-if="channelsLoading" class="hint">Loading channels...</div>
      <div v-else-if="channelsError" class="channel-error">
        {{ channelsError }}
        <button type="button" class="retry-btn" @click="fetchChannels">Retry</button>
      </div>
      <select v-else v-model="channelSlug" required>
        <option value="" disabled>Select a task channel</option>
        <option v-for="ch in availableChannels" :key="ch.slug" :value="ch.slug">
          {{ ch.name }}{{ ch.nameCn ? ` (${ch.nameCn})` : "" }} — {{ ch.slug }}
        </option>
      </select>
    </div>

    <!-- Title -->
    <div class="row">
      <div class="field flex-1">
        <label>Title (EN) *</label>
        <input v-model="title" placeholder="Task title in English" required />
      </div>
      <div class="field flex-1">
        <label>Title (CN)</label>
        <input v-model="titleCn" placeholder="Task title in Chinese (optional)" />
      </div>
    </div>

    <!-- Description -->
    <div class="row">
      <div class="field flex-1">
        <label>Description (EN) *</label>
        <textarea v-model="description" placeholder="Task description..." rows="4" required />
      </div>
      <div class="field flex-1">
        <label>Description (CN)</label>
        <textarea v-model="descriptionCn" placeholder="Chinese description (optional)..." rows="4" />
      </div>
    </div>

    <!-- Bounty -->
    <div class="section-title">Bounty</div>
    <div class="row">
      <div class="field">
        <label>Base USD</label>
        <input v-model="bountyUsd" type="text" placeholder="25.00" />
      </div>
      <div class="field">
        <label>Base RMB</label>
        <input v-model="bountyRmb" type="text" placeholder="180.00" />
      </div>
      <div class="field">
        <label>Bonus USD</label>
        <input v-model="bonusBountyUsd" type="text" placeholder="10.00" />
      </div>
      <div class="field">
        <label>Bonus RMB</label>
        <input v-model="bonusBountyRmb" type="text" placeholder="72.00" />
      </div>
    </div>

    <!-- Settings -->
    <div class="row">
      <div class="field">
        <label>Max Attempts</label>
        <input v-model.number="maxAttempts" type="number" min="1" max="50" />
      </div>
      <div class="field">
        <label>Deadline</label>
        <input v-model="deadline" type="datetime-local" />
      </div>
      <div class="field">
        <label>External ID (auto-generated)</label>
        <input v-model="externalId" readonly class="readonly" />
      </div>
    </div>

    <!-- Checklist -->
    <div class="section-title">Review Checklist</div>
    <div class="checklist">
      <div class="checklist-input">
        <input
          v-model="newChecklistItem"
          placeholder="Add checklist item..."
          @keydown="handleChecklistKeydown"
        />
        <button type="button" class="add-btn" @click="addChecklistItem">+ Add</button>
      </div>
      <div v-if="checklistItems.length > 0" class="checklist-items">
        <div v-for="(item, i) in checklistItems" :key="i" class="checklist-item">
          <span class="check-icon">&#10003;</span>
          <span class="check-text">{{ item }}</span>
          <button type="button" class="remove-btn" @click="removeChecklistItem(i)">x</button>
        </div>
      </div>
    </div>

    <!-- Deliverable Slots -->
    <div class="section-title">Deliverable Slots</div>
    <DeliverableSlotEditor
      :slots="deliverableSlots"
      @update:slots="deliverableSlots = $event"
    />

    <!-- Self-Checklist (creator guidance) -->
    <div class="section-title">Creator Self-Checklist</div>
    <div class="checklist">
      <div class="checklist-input">
        <input
          v-model="newSelfChecklistItem"
          placeholder="Add guidance item for creators..."
          @keydown="handleSelfChecklistKeydown"
        />
        <button type="button" class="add-btn" @click="addSelfChecklistItem">+ Add</button>
      </div>
      <div v-if="selfChecklistItems.length > 0" class="checklist-items">
        <div v-for="(item, i) in selfChecklistItems" :key="i" class="checklist-item self">
          <span class="check-icon">&#9679;</span>
          <span class="check-text">{{ item }}</span>
          <button type="button" class="remove-btn" @click="removeSelfChecklistItem(i)">x</button>
        </div>
      </div>
    </div>

    <!-- File Attachments -->
    <div class="section-title">Reference Attachments</div>
    <FileUpload
      :files="attachments"
      :max-files="10"
      label="Upload reference files (scripts, examples, guides)"
      @update:files="attachments = $event"
    />

    <!-- Submit -->
    <div class="submit-row">
      <button type="submit" class="submit-btn" :disabled="!canSubmit">
        <span v-if="submitting">Sending...</span>
        <span v-else>Send to ContentHub</span>
      </button>
      <span class="submit-hint">
        Posts to {{ FRONTEND_URL }}/api/tasks/sync
      </span>
    </div>
  </form>
</template>

<style scoped>
.task-form {
  max-width: 800px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field label {
  font-size: 13px;
  font-weight: 600;
  color: #444;
}

.field input,
.field textarea,
.field select {
  padding: 8px 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
  transition: border-color 0.2s;
  background: white;
}

.field input:focus,
.field textarea:focus,
.field select:focus {
  outline: none;
  border-color: #4a90d9;
}

.field input.readonly {
  background: #f5f5f5;
  color: #888;
  cursor: default;
}

.channel-error {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #c53030;
}

.retry-btn {
  padding: 4px 12px;
  background: #4a90d9;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}

.hint {
  font-size: 11px;
  color: #999;
}

.row {
  display: flex;
  gap: 12px;
}

.flex-1 {
  flex: 1;
}

.section-title {
  font-size: 15px;
  font-weight: 700;
  color: #333;
  margin-top: 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid #eee;
}

.checklist-input {
  display: flex;
  gap: 8px;
}

.checklist-input input {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
}

.checklist-input input:focus {
  outline: none;
  border-color: #4a90d9;
}

.add-btn {
  padding: 8px 16px;
  background: #4a90d9;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.add-btn:hover {
  background: #3a7bc8;
}

.checklist-items {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.checklist-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: #f0faf0;
  border-radius: 6px;
  font-size: 13px;
}

.check-icon {
  color: #4a9;
  font-weight: 700;
}

.check-text {
  flex: 1;
}

.checklist-item.self {
  background: #f0f4ff;
}

.remove-btn {
  background: none;
  border: none;
  color: #e55;
  font-weight: 700;
  cursor: pointer;
  font-size: 14px;
}

.submit-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}

.submit-btn {
  padding: 12px 32px;
  background: #2d8c4e;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.2s;
}

.submit-btn:hover:not(:disabled) {
  background: #247a42;
}

.submit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.submit-hint {
  font-size: 12px;
  color: #999;
}

.result {
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.result.success {
  background: #e8f5e9;
  color: #2d8c4e;
  border: 1px solid #c8e6c9;
}

.result.error {
  background: #fde8e8;
  color: #c53030;
  border: 1px solid #fcc;
}

.dismiss {
  margin-left: auto;
  background: none;
  border: none;
  font-weight: 700;
  cursor: pointer;
  color: inherit;
  font-size: 16px;
}
</style>
