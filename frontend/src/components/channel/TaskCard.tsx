"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { ButtonSpinner } from "@/components/ui/Spinner";
import { FileUpload, FilePreviewList, type UploadedFile } from "@/components/ui/FileUpload";
import { useRouter } from "next/navigation";
import type { DeliverableSlot } from "@/types/deliverable-slot";
import { slotTypeLabel, slotTypeIcon, isUploadType, SLOT_TYPE_BADGE } from "@/types/deliverable-slot";
import { useTranslations, useLocale } from "next-intl";
import { localized } from "@/lib/localize";
import { validateDeliverablesError } from "@/lib/validate-deliverables";

/** Per-slot deliverable data submitted by creator */
export interface SlotDeliverable {
  slotId: string;
  text?: string;
  files?: UploadedFile[];
  selections?: string[];
  rating?: number;
}

interface MyAttempt {
  id: string;
  status: string;
  deliverables: { text?: string; files?: UploadedFile[]; slots?: SlotDeliverable[] } | null;
  appealStatus?: string | null;
}

interface TaskCardProps {
  task: {
    id: string;
    title: string;
    titleCn?: string | null;
    description: string;
    descriptionCn?: string | null;
    status: string;
    bountyUsd: string | null;
    bountyRmb: string | null;
    bonusBountyUsd?: string | null;
    bonusBountyRmb?: string | null;
    maxAttempts: number;
    deadline: string | null;
    attemptCount: number;
    myAttemptCount?: number;
    channelSlug: string;
    createdByUsername: string;
    createdByDisplayName?: string | null;
    createdAt?: string;
    myAttempt?: MyAttempt | null;
    submittedCount?: number;
    reviewClaimedBy?: string | null;
    lockedById?: string | null;
    lockExpiresAt?: string | null;
    source?: string | null;
    checklist?: { label: string }[] | null;
    selfChecklist?: { label: string }[] | null;
    attachments?: { name: string; url: string; type: string; size: number }[] | null;
    deliverableSlots?: DeliverableSlot[] | null;
    othersAttempting?: {
      username: string;
      displayName: string | null;
      avatarUrl: string | null;
      createdAt: string;
    }[];
    myAllAttempts?: {
      id: string;
      status: string;
      deliverables: any;
      rejectionReason: string | null;
      reviewNote: string | null;
      createdAt: string;
    }[];
  };
  onAttemptSubmitted?: () => void;
  defaultExpanded?: boolean;
}

const STATUS_STYLE_CLASSES: Record<string, { bg: string; text: string; key: string }> = {
  draft: { bg: "bg-gray-500/20", text: "text-gray-400", key: "draft" },
  active: { bg: "bg-green-500/20", text: "text-green-400", key: "active" },
  locked: { bg: "bg-amber-500/20", text: "text-amber-300", key: "locked" },
  approved: { bg: "bg-blue-500/20", text: "text-blue-400", key: "approved" },
  paid: { bg: "bg-discord-text-muted/20", text: "text-discord-text-muted", key: "paid" },
  archived: { bg: "bg-gray-500/20", text: "text-gray-500", key: "archived" },
};

function useFormatRelativeDate() {
  const t = useTranslations("taskCard");
  return (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t("justNow");
    if (mins < 60) return t("minutesAgo", { mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t("hoursAgo", { hours });
    const days = Math.floor(hours / 24);
    if (days < 7) return t("daysAgo", { days });
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };
}

export function TaskCard({ task, onAttemptSubmitted, defaultExpanded }: TaskCardProps) {
  const { user } = useAuth();
  const router = useRouter();
  const t = useTranslations("taskCard");
  const tTasks = useTranslations("tasks");
  const locale = useLocale();
  const formatRelativeDate = useFormatRelativeDate();
  const cardRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);

  // Auto-scroll into view when opened via deep link
  useEffect(() => {
    if (defaultExpanded && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [defaultExpanded]);
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deliverableText, setDeliverableText] = useState("");
  const [deliverableFiles, setDeliverableFiles] = useState<UploadedFile[]>([]);
  // Per-slot deliverable state (keyed by slot id)
  const [slotTexts, setSlotTexts] = useState<Record<string, string>>({});
  const [slotFiles, setSlotFiles] = useState<Record<string, UploadedFile[]>>({});
  const [slotSelections, setSlotSelections] = useState<Record<string, string[]>>({});
  const [slotRatings, setSlotRatings] = useState<Record<string, number>>({});
  const [error, setError] = useState("");

  const hasSlots = (task.deliverableSlots?.length ?? 0) > 0;
  const [showAppealForm, setShowAppealForm] = useState(false);
  const [appealReason, setAppealReason] = useState("");
  const [appealSubmitting, setAppealSubmitting] = useState(false);
  const [appealFiled, setAppealFiled] = useState(
    !!task.myAttempt?.appealStatus && task.myAttempt.appealStatus !== "denied"
  );
  const [appealDenied, setAppealDenied] = useState(
    task.myAttempt?.appealStatus === "denied"
  );
  const [appealError, setAppealError] = useState("");

  // Sync appeal state when task data changes (e.g. after real-time refetch)
  useEffect(() => {
    const s = task.myAttempt?.appealStatus;
    if (s === "pending" || s === "granted") {
      setAppealFiled(true);
      setAppealDenied(false);
    } else if (s === "denied") {
      setAppealFiled(false);
      setAppealDenied(true);
    }
  }, [task.myAttempt?.appealStatus]);

  const statusStyleDef = STATUS_STYLE_CLASSES[task.status] || STATUS_STYLE_CLASSES.draft;
  const statusStyle = { bg: statusStyleDef.bg, text: statusStyleDef.text, label: tTasks(statusStyleDef.key as any) };
  const isReviewer = ["admin", "supermod", "mod"].includes(user?.role ?? "");

  const submittedCount = task.submittedCount || 0;
  const reviewClaimedBy = task.reviewClaimedBy || null;

  const myAttempt = task.myAttempt;
  const hasSubmittedAttempt = myAttempt?.status === "submitted";
  const hasRejectedAttempt = myAttempt?.status === "rejected";
  const hasApprovedAttempt = myAttempt?.status === "approved";

  const isLockedForMe =
    task.status === "locked" && task.lockedById === user?.id;

  const canSubmit =
    (task.status === "active" || isLockedForMe) &&
    !hasSubmittedAttempt &&
    !hasApprovedAttempt;

  // Countdown timer for locked tasks
  const [lockTimeLeft, setLockTimeLeft] = useState("");
  useEffect(() => {
    if (task.status !== "locked" || !task.lockExpiresAt) return;
    const update = () => {
      const diff = new Date(task.lockExpiresAt!).getTime() - Date.now();
      if (diff <= 0) {
        setLockTimeLeft(t("expired"));
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      setLockTimeLeft(`${h}h ${m}m`);
    };
    update();
    const iv = setInterval(update, 60000);
    return () => clearInterval(iv);
  }, [task.status, task.lockExpiresAt]);

  const creatorName = task.createdByDisplayName || task.createdByUsername;

  const deadlineStr = task.deadline
    ? (() => {
        const d = new Date(task.deadline);
        const now = new Date();
        const diff = d.getTime() - now.getTime();
        if (diff < 0) return t("expired");
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        if (days === 0) return t("dueToday");
        return t("daysLeft", { days });
      })()
    : null;

  const buildSlotDeliverables = (): SlotDeliverable[] | null => {
    if (!hasSlots) return null;
    return task.deliverableSlots!.map((slot) => {
      const sd: SlotDeliverable = { slotId: slot.id };
      if (slot.type === "textbox" || slot.type === "upload-text") {
        sd.text = slotTexts[slot.id] || "";
      }
      if (slot.type === "multiple-selection") {
        sd.selections = slotSelections[slot.id] || [];
      }
      if (slot.type === "rating") {
        sd.rating = slotRatings[slot.id];
      }
      if (isUploadType(slot.type)) {
        sd.files = (slotFiles[slot.id] || []).map((f) => ({ name: f.name, url: f.url, type: f.type, size: f.size }));
      }
      return sd;
    });
  };

  const validateSlotDeliverables = (): string | null => {
    if (!hasSlots) return null;
    // Check required slots have content
    for (const slot of task.deliverableSlots!) {
      if (slot.required === false) continue; // skip optional slots
      if (isUploadType(slot.type) && slot.type !== "upload-text") {
        if (!(slotFiles[slot.id]?.length)) return t("slotFileRequired", { slotName: slot.title || slotTypeLabel(slot.type) });
      }
      if (slot.type === "textbox") {
        if (!slotTexts[slot.id]?.trim()) return t("slotTextRequired", { slotName: slot.title || "Textbox" });
      }
    }
    // Run automated checks (file size, extensions, text length, regex, selections, rating)
    const builtSlots = buildSlotDeliverables();
    if (builtSlots) {
      const checkError = validateDeliverablesError(task.deliverableSlots!, builtSlots);
      if (checkError) return checkError;
    }
    return null;
  };

  const handleSubmit = async () => {
    if (hasSlots) {
      const slotErr = validateSlotDeliverables();
      if (slotErr) { setError(slotErr); return; }
    } else if (!deliverableText.trim() && deliverableFiles.length === 0) {
      setError(t("pleaseEnterTextOrFiles"));
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const deliverables: { text?: string; files?: UploadedFile[]; slots?: SlotDeliverable[] } = {};
      if (hasSlots) {
        deliverables.slots = buildSlotDeliverables()!;
        if (deliverableText.trim()) deliverables.text = deliverableText.trim();
      } else {
        if (deliverableText.trim()) deliverables.text = deliverableText.trim();
        if (deliverableFiles.length > 0) deliverables.files = deliverableFiles.map((f) => ({ name: f.name, url: f.url, type: f.type, size: f.size }));
      }
      const res = await fetch(`/api/tasks/${task.id}/attempts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliverables }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t("failedToSubmit"));
        return;
      }
      setDeliverableText("");
      setDeliverableFiles([]);
      setSlotTexts({}); setSlotFiles({}); setSlotSelections({}); setSlotRatings({});
      setExpanded(false);
      onAttemptSubmitted?.();
    } catch {
      setError(t("networkError"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async () => {
    if (!myAttempt) return;
    if (hasSlots) {
      const slotErr = validateSlotDeliverables();
      if (slotErr) { setError(slotErr); return; }
    } else if (!deliverableText.trim() && deliverableFiles.length === 0) {
      setError(t("pleaseEnterTextOrFiles"));
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const deliverables: { text?: string; files?: UploadedFile[]; slots?: SlotDeliverable[] } = {};
      if (hasSlots) {
        deliverables.slots = buildSlotDeliverables()!;
        if (deliverableText.trim()) deliverables.text = deliverableText.trim();
      } else {
        if (deliverableText.trim()) deliverables.text = deliverableText.trim();
        if (deliverableFiles.length > 0) deliverables.files = deliverableFiles.map((f) => ({ name: f.name, url: f.url, type: f.type, size: f.size }));
      }
      const res = await fetch(
        `/api/tasks/${task.id}/attempts/${myAttempt.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deliverables }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t("failedToUpdate"));
        return;
      }
      setEditing(false);
      onAttemptSubmitted?.();
    } catch {
      setError(t("networkError"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!myAttempt) return;
    setDeleting(true);
    setError("");
    try {
      const res = await fetch(
        `/api/tasks/${task.id}/attempts/${myAttempt.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || t("failedToDelete"));
        return;
      }
      onAttemptSubmitted?.();
    } catch {
      setError(t("networkError"));
    } finally {
      setDeleting(false);
    }
  };

  const handleAppeal = async () => {
    if (appealReason.trim().length < 20) {
      setAppealError(t("appealMinChars"));
      return;
    }
    setAppealSubmitting(true);
    setAppealError("");
    try {
      const res = await fetch("/api/appeals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attemptId: myAttempt?.id,
          reason: appealReason.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAppealError(data.error || t("failedToFileAppeal"));
        return;
      }
      setAppealFiled(true);
      setShowAppealForm(false);
      setAppealReason("");
    } catch {
      setAppealError(t("networkError"));
    } finally {
      setAppealSubmitting(false);
    }
  };

  const handleReviewClick = () => {
    router.push(`/review?task=${task.id}`);
  };

  return (
    <div ref={cardRef} className="mx-2 my-2 rounded-lg border border-discord-accent/30 bg-discord-accent/5 overflow-hidden">
      {/* Task header row 1: badges + title */}
      <div className="px-4 pt-3 pb-1 flex items-center gap-2">
        <span className="text-xs font-bold px-1.5 py-0.5 bg-discord-accent/20 text-discord-accent rounded uppercase">
          {t("task")}
        </span>
        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${statusStyle.bg} ${statusStyle.text}`}>
          {statusStyle.label}
        </span>
        {task.source === "backend" && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-semibold">
            {t("synced")}
          </span>
        )}
        {task.bonusBountyUsd && parseFloat(task.bonusBountyUsd) > 0 && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-semibold">
            {t("tiered")}
          </span>
        )}
        {task.myAttempt?.appealStatus === "granted" && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 font-semibold">
            {t("appealUpheld")}
          </span>
        )}
        <h4 className="font-semibold text-sm text-discord-text flex-1 truncate ml-1">
          {localized(locale, task.title, task.titleCn)}
        </h4>
      </div>

      {/* Task header row 2: creator + metadata */}
      <div className="px-4 pb-2 flex items-center gap-4 text-xs text-discord-text-muted">
        <span className="flex items-center gap-1">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          {t("postedBy")} <span className="text-discord-text-secondary font-medium">{creatorName}</span>
        </span>
        {task.createdAt && (
          <span className="flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {formatRelativeDate(task.createdAt)}
          </span>
        )}
        {deadlineStr && (
          <span className={`flex items-center gap-1 ${deadlineStr === "Expired" ? "text-red-400" : deadlineStr === "Due today" ? "text-amber-400" : ""}`}>
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {deadlineStr}
          </span>
        )}
      </div>

      {/* Description (collapsed only — hidden when expanded) */}
      {!expanded && (
        <div className="px-4 pb-2">
          <p className="text-xs text-discord-text-secondary line-clamp-2">
            {localized(locale, task.description, task.descriptionCn)}
          </p>
        </div>
      )}

      {/* Compact attachments indicator */}
      {task.attachments && task.attachments.length > 0 && (
        <div className="px-4 pb-2">
          <div className="flex items-center gap-1.5 text-[11px] text-discord-text-muted">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
            <span>
              {t("referenceFiles", { count: task.attachments.length })}
              <span className="ml-1 text-discord-text-muted/70">
                ({task.attachments.map((a) => {
                  const ext = a.name.split(".").pop()?.toUpperCase();
                  return ext;
                }).filter((v, i, arr) => arr.indexOf(v) === i).join(", ")})
              </span>
            </span>
          </div>
        </div>
      )}

      {/* Locked state banner */}
      {task.status === "locked" && (
        <div className="px-4 py-2 bg-amber-500/10 border-t border-amber-500/20">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            {isLockedForMe ? (
              <span className="text-xs text-amber-300 font-medium">
                {t("lockedForYou")} {lockTimeLeft && <span className="text-amber-400/70">({lockTimeLeft})</span>}
              </span>
            ) : (
              <span className="text-xs text-amber-300/70">
                {t("lockedExclusive")} {lockTimeLeft && <span>({lockTimeLeft})</span>}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Footer: bounty, attempts, actions */}
      <div className="px-4 py-2 bg-discord-bg-dark/30 flex items-center gap-3 border-t border-discord-border/50">
        {/* Bounty display */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-green-400">
            ${task.bountyUsd || "0"}
          </span>
          {task.bountyRmb && (
            <span className="text-xs text-discord-text-muted">
              / ¥{task.bountyRmb}
            </span>
          )}
        </div>

        {task.bonusBountyUsd && parseFloat(task.bonusBountyUsd) > 0 && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-semibold">
            {t("bonus", { amount: task.bonusBountyUsd })}
          </span>
        )}

        <span className="text-xs text-discord-text-muted">
          {t("attempts", { used: task.myAttemptCount ?? task.attemptCount, max: task.maxAttempts })}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {/* Pending Review badge when user has submitted */}
          {hasSubmittedAttempt && (
            <span className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded border border-amber-500/30 bg-amber-500/10 text-amber-400">
              ⏳ {t("pendingReview")}
            </span>
          )}
          {/* View Task button — always available for active/locked tasks */}
          {(task.status === "active" || task.status === "locked") && (
            <button
              onClick={() => setExpanded(!expanded)}
              className={`text-xs px-3 py-1.5 ${
                isLockedForMe ? "bg-amber-600 hover:bg-amber-700" :
                hasSubmittedAttempt ? "bg-discord-accent hover:bg-discord-accent/80" :
                "bg-green-600 hover:bg-green-700"
              } text-white rounded font-semibold transition cursor-pointer`}
            >
              {expanded ? t("close") : isLockedForMe ? t("submitRevision") : t("viewTask")}
            </button>
          )}
          {submittedCount > 0 && (
            <span className="text-xs text-discord-text-muted">
              {t("submitted", { count: submittedCount })}
            </span>
          )}
          {reviewClaimedBy && (
            <span className="flex items-center gap-1 text-xs text-amber-400">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              {t("beingReviewedBy", { name: reviewClaimedBy })}
            </span>
          )}
          {isReviewer && submittedCount > 0 && (
            <button
              onClick={handleReviewClick}
              disabled={!!reviewClaimedBy}
              className="text-xs px-3 py-1 bg-discord-accent hover:bg-discord-accent/80 text-white rounded font-semibold transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              {t("review")}
            </button>
          )}
        </div>
      </div>

      {/* ═══════ EXPANDED TASK DETAIL VIEW ═══════ */}
      {expanded && (
        <div className="border-t border-discord-border/50 bg-discord-bg-dark/40">
          {/* ── Task Description ── */}
          <div className="px-4 py-3 border-b border-discord-border/30">
            <p className="text-sm text-discord-text-secondary whitespace-pre-wrap leading-relaxed">{localized(locale, task.description, task.descriptionCn)}</p>
          </div>

          {/* ── Meta Stats Row ── */}
          <div className="px-4 py-2.5 flex flex-wrap gap-4 text-xs text-discord-text-muted border-b border-discord-border/30">
            {deadlineStr && <span className="flex items-center gap-1">🕐 {deadlineStr}</span>}
            <span className="flex items-center gap-1">👥 {t("othersSubmitted", { count: task.submittedCount || 0 })}</span>
            <span className={`flex items-center gap-1 font-medium ${(task.maxAttempts - (task.myAttemptCount || 0)) <= 1 ? "text-red-400" : ""}`}>
              🔄 {t("attemptsRemaining", { count: task.maxAttempts - (task.myAttemptCount || 0) })}
            </span>
            <span className="flex items-center gap-1"># {task.channelSlug}</span>
          </div>

          {/* ── Requirements / Checklist ── */}
          {task.checklist && task.checklist.length > 0 && (
            <div className="px-4 py-3 border-b border-discord-border/30">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">📋</span>
                <h4 className="text-base font-semibold text-discord-text">{t("requirements")}</h4>
              </div>
              <div className="space-y-0.5">
                {task.checklist.map((item, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-sm text-discord-text-secondary">
                    <span className="text-green-400 text-xs">✓</span> {item.label}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Self-Checklist (creator guidance) ── */}
          {task.selfChecklist && task.selfChecklist.length > 0 && (
            <div className="px-4 py-3 border-b border-discord-border/30">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">📝</span>
                <h4 className="text-base font-semibold text-discord-text">{t("selfChecklist")}</h4>
                <span className="text-xs text-discord-text-muted">{t("selfChecklistGuidance")}</span>
              </div>
              <p className="text-xs text-discord-text-muted mb-2 pl-7">{t("selfChecklistHint")}</p>
              <div className="space-y-1 pl-7">
                {task.selfChecklist.map((item, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-discord-text-secondary">
                    <span className="text-sky-400">•</span> {item.label}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Attachments (pill-style) ── */}
          {task.attachments && task.attachments.length > 0 && (
            <div className="px-4 py-3 border-b border-discord-border/30">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">📎</span>
                <h4 className="text-base font-semibold text-discord-text">{t("attachments")}</h4>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {task.attachments.map((f, i) => (
                  <AttachmentPill key={i} file={f} />
                ))}
              </div>
            </div>
          )}

          {/* ── Others Currently Attempting ── */}
          <div className="px-4 py-3 border-b border-discord-border/30">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">👥</span>
              <h4 className="text-base font-semibold text-discord-text">{t("othersAttempting")}</h4>
              <span className="px-2 py-0.5 bg-discord-bg-hover rounded-full text-[10px] font-bold text-discord-text-muted">{task.othersAttempting?.length || 0}</span>
            </div>
            <p className="text-xs text-discord-text-muted mb-2.5 pl-7">
              {t("othersAttemptingHint")}
            </p>
            {(!task.othersAttempting || task.othersAttempting.length === 0) ? (
              <div className="flex flex-col items-center py-4 text-discord-text-muted">
                <span className="text-lg mb-1">📭</span>
                <span className="text-xs">{t("noOthersAttempting")}</span>
              </div>
            ) : (
              <div className="space-y-1.5">
                {task.othersAttempting.map((other, i) => {
                  const name = other.displayName || other.username;
                  const initials = name.split(/[\s_]+/).map((w) => w[0]?.toUpperCase()).join("").slice(0, 2);
                  const colors = ["bg-blue-600", "bg-amber-600", "bg-purple-600", "bg-emerald-600", "bg-pink-600", "bg-cyan-600"];
                  const bgColor = colors[i % colors.length];
                  return (
                    <div key={`${other.username}-${i}`} className="flex items-center gap-3 p-2.5 rounded-lg border border-discord-border bg-discord-bg-dark hover:bg-discord-bg-hover/50 transition">
                      {other.avatarUrl ? (
                        <img src={other.avatarUrl} alt={name} className="w-9 h-9 rounded-full object-cover shrink-0" />
                      ) : (
                        <div className={`w-9 h-9 rounded-full ${bgColor} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                          {initials}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-discord-text">{name}</div>
                        <div className="text-xs text-discord-text-muted">
                          {t("submittedTime", { time: formatRelativeDate(other.createdAt) })}
                        </div>
                      </div>
                      <span className="shrink-0 flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded border border-amber-500/30 bg-amber-500/10 text-amber-400">
                        ⏳ {t("pendingReview")}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Your Previous Attempts ── */}
          <div className="px-4 py-3 border-b border-discord-border/30">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">🕘</span>
              <h4 className="text-base font-semibold text-discord-text">{t("yourPreviousAttempts")}</h4>
              <span className="px-2 py-0.5 bg-discord-bg-hover rounded-full text-[10px] font-bold text-discord-text-muted">{task.myAllAttempts?.length || 0}</span>
            </div>
            {(!task.myAllAttempts || task.myAllAttempts.length === 0) ? (
              <div className="flex flex-col items-center py-4 text-discord-text-muted">
                <span className="text-lg mb-1">📭</span>
                <span className="text-xs">{t("noAttempts")}</span>
              </div>
            ) : (
              <div className="space-y-2.5">
                {task.myAllAttempts.map((attempt, i) => {
                  const statusConfig: Record<string, { cardBg: string; border: string; leftBorder: string; label: string; icon: string; tagClass: string }> = {
                    submitted: { cardBg: "bg-discord-bg-dark", border: "border-discord-border", leftBorder: "border-l-amber-500", label: t("pendingReview"), icon: "⏳", tagClass: "border-amber-500/30 bg-amber-500/10 text-amber-400" },
                    approved: { cardBg: "bg-discord-bg-dark", border: "border-discord-border", leftBorder: "border-l-green-500", label: tTasks("approved"), icon: "✅", tagClass: "border-green-500/30 bg-green-500/10 text-green-400" },
                    rejected: { cardBg: "bg-red-500/5", border: "border-red-500/20", leftBorder: "border-l-red-500", label: tTasks("rejected"), icon: "❌", tagClass: "border-red-500/30 bg-red-500/10 text-red-400" },
                    blocked: { cardBg: "bg-discord-bg-dark", border: "border-discord-border", leftBorder: "border-l-gray-500", label: tTasks("blocked"), icon: "🚫", tagClass: "border-gray-500/30 bg-gray-500/10 text-gray-400" },
                    paid: { cardBg: "bg-discord-bg-dark", border: "border-discord-border", leftBorder: "border-l-blue-500", label: tTasks("paid"), icon: "💰", tagClass: "border-blue-500/30 bg-blue-500/10 text-blue-400" },
                  };
                  const sc = statusConfig[attempt.status] || { cardBg: "bg-discord-bg-dark", border: "border-discord-border", leftBorder: "border-l-gray-500", label: attempt.status, icon: "❓", tagClass: "border-gray-500/30 bg-gray-500/10 text-gray-400" };

                  // Extract file names from deliverables
                  const files: { name: string; url: string; type: string }[] = [];
                  if (attempt.deliverables?.files) {
                    files.push(...attempt.deliverables.files);
                  }
                  if (attempt.deliverables?.slots) {
                    for (const slot of attempt.deliverables.slots) {
                      if (slot.files) files.push(...slot.files);
                    }
                  }
                  const creatorNote = attempt.deliverables?.text || "";

                  // Full date format
                  const d = new Date(attempt.createdAt);
                  const fullDate = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) + " at " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

                  return (
                    <div key={attempt.id} className={`rounded-lg border ${sc.border} ${sc.cardBg} border-l-3 ${sc.leftBorder} overflow-hidden`}>
                      {/* Header row */}
                      <div className="flex items-center justify-between px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <span className="text-sm font-bold text-discord-text">#{i + 1}</span>
                          <span className="text-xs text-discord-text-muted">{fullDate}</span>
                        </div>
                        <span className={`flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded border ${sc.tagClass}`}>
                          {sc.icon} {sc.label}
                        </span>
                      </div>

                      {/* File names (clickable) */}
                      {files.length > 0 && (
                        <div className="px-4 pb-2 flex flex-wrap gap-1.5">
                          {files.map((f, fi) => {
                            const ext = f.name.split(".").pop()?.toLowerCase() || "";
                            const icons: Record<string, string> = { mp3: "🎵", wav: "🎵", m4a: "🎵", mp4: "🎬", mov: "🎬", png: "🖼️", jpg: "🖼️", jpeg: "🖼️", md: "📄", txt: "📄", srt: "🔤", tsv: "📊" };
                            return (
                              <AttachmentPill key={fi} file={{ name: f.name, url: f.url, type: f.type, size: 0 }} />
                            );
                          })}
                        </div>
                      )}

                      {/* Creator note */}
                      {creatorNote && (
                        <div className="mx-4 mb-2.5 px-3 py-2 rounded-lg bg-discord-sidebar/60 border border-discord-border/50">
                          <div className="text-xs text-discord-text-secondary">
                            <span className="font-semibold text-discord-text-muted">📝 {t("yourNote")}</span>{" "}
                            {creatorNote}
                          </div>
                        </div>
                      )}

                      {/* Rejection reason */}
                      {attempt.status === "rejected" && attempt.rejectionReason && (
                        <div className="mx-4 mb-2.5 px-3 py-2.5 rounded-lg bg-red-500/8 border border-red-500/20">
                          <div className="text-[10px] font-bold text-red-400 uppercase mb-1">❌ {t("rejectionReasonLabel")}</div>
                          <div className="text-sm text-discord-text">{attempt.rejectionReason}</div>
                          {/* Mod note inside rejection block */}
                          {attempt.reviewNote && (
                            <div className="mt-2 text-xs text-discord-text-muted">
                              <span className="font-semibold">🛡 {t("modNote")}</span> {attempt.reviewNote}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Mod note (non-rejection) */}
                      {attempt.status !== "rejected" && attempt.reviewNote && (
                        <div className="mx-4 mb-2.5 px-3 py-2 rounded-lg bg-discord-sidebar/60 border border-discord-border/50">
                          <div className="text-xs text-discord-text-muted">
                            <span className="font-semibold">🛡 {t("modNote")}</span> {attempt.reviewNote}
                          </div>
                        </div>
                      )}

                      {/* Pending notice */}
                      {attempt.status === "submitted" && (
                        <div className="mx-4 mb-2.5 px-3 py-2 rounded-lg bg-amber-500/8 border border-amber-500/15">
                          <div className="text-xs text-amber-400/80">⏳ {t("pendingReviewNotice")}</div>
                        </div>
                      )}
                    </div>
                  );
                })}
                <p className="text-xs text-discord-text-muted mt-1 pl-1">🔒 {t("privacyNote")}</p>
              </div>
            )}
          </div>

          {/* ── Current Submission (edit/delete) ── */}
          {hasSubmittedAttempt && !editing && (
            <div className="px-4 py-2.5 border-b border-discord-border/30 space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">📤</span>
                <h4 className="text-base font-semibold text-discord-text">{t("currentSubmission")}</h4>
              </div>
              {myAttempt?.deliverables?.text && (
                <div className="text-xs text-discord-text-secondary bg-discord-bg-dark p-2 rounded border border-discord-border whitespace-pre-wrap">{myAttempt.deliverables.text}</div>
              )}
              {myAttempt?.deliverables?.files && myAttempt.deliverables.files.length > 0 && (
                <FilePreviewList files={myAttempt.deliverables.files} label="Uploaded Files" />
              )}
              {(task.status !== "locked" || isLockedForMe) && (
                <div className="flex justify-end gap-2">
                  <button onClick={() => {
                    setDeliverableText(myAttempt?.deliverables?.text || "");
                    setDeliverableFiles(myAttempt?.deliverables?.files || []);
                    // Restore slot-based state
                    if (myAttempt?.deliverables?.slots) {
                      const texts: Record<string, string> = {};
                      const files: Record<string, UploadedFile[]> = {};
                      const sels: Record<string, string[]> = {};
                      const rats: Record<string, number> = {};
                      for (const sd of myAttempt.deliverables.slots) {
                        if (sd.text) texts[sd.slotId] = sd.text;
                        if (sd.files) files[sd.slotId] = sd.files;
                        if (sd.selections) sels[sd.slotId] = sd.selections;
                        if (sd.rating !== undefined) rats[sd.slotId] = sd.rating;
                      }
                      setSlotTexts(texts);
                      setSlotFiles(files);
                      setSlotSelections(sels);
                      setSlotRatings(rats);
                    }
                    setEditing(true);
                    setError("");
                  }}
                    className="text-xs px-3 py-1 bg-discord-accent hover:bg-discord-accent/80 text-white rounded font-semibold transition cursor-pointer">{t("edit")}</button>
                  <button onClick={handleDelete} disabled={deleting}
                    className="text-xs px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded font-semibold transition cursor-pointer disabled:opacity-50 flex items-center gap-1">
                    <ButtonSpinner loading={deleting}>{t("delete")}</ButtonSpinner>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Edit form ── */}
          {hasSubmittedAttempt && editing && (
            <div className="px-4 py-3 border-b border-discord-border/30 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">✏️</span>
                <h4 className="text-base font-semibold text-discord-text">{t("editSubmission")}</h4>
              </div>
              {hasSlots ? (
                <div className="space-y-2">
                  {task.deliverableSlots!.map((slot, idx) => (
                    <SlotSubmissionField key={slot.id} slot={slot} index={idx}
                      files={slotFiles[slot.id] || []} onFilesChange={(f) => setSlotFiles((prev) => ({ ...prev, [slot.id]: f }))}
                      text={slotTexts[slot.id] || ""} onTextChange={(t) => setSlotTexts((prev) => ({ ...prev, [slot.id]: t }))}
                      selections={slotSelections[slot.id] || []} onSelectionsChange={(s) => setSlotSelections((prev) => ({ ...prev, [slot.id]: s }))}
                      rating={slotRatings[slot.id]} onRatingChange={(r) => setSlotRatings((prev) => ({ ...prev, [slot.id]: r }))} />
                  ))}
                </div>
              ) : (
                <FileUpload files={deliverableFiles} onFilesChange={setDeliverableFiles} context="attempt-deliverable" maxFiles={10} maxSizeMb={100} label={t("uploadFiles")} compact />
              )}
              <textarea value={deliverableText} onChange={(e) => setDeliverableText(e.target.value)} placeholder={t("notesForReviewer")} className="w-full p-2 bg-discord-bg-dark border border-discord-border rounded text-sm text-discord-text placeholder-discord-text-muted focus:outline-none focus:border-discord-accent resize-none" rows={2} />
              {error && <p className="text-xs text-discord-red mt-1">{error}</p>}
              <div className="flex gap-2">
                <button onClick={() => { setEditing(false); setError(""); }} className="flex-1 py-2 text-xs bg-discord-bg-hover text-discord-text-muted rounded-lg font-semibold hover:bg-discord-border transition cursor-pointer">{t("cancel")}</button>
                <button onClick={handleEdit} disabled={submitting} className="flex-1 py-2 text-xs bg-discord-accent hover:bg-discord-accent/80 text-white rounded-lg font-semibold transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1">
                  <ButtonSpinner loading={submitting}>{t("saveChanges")}</ButtonSpinner>
                </button>
              </div>
            </div>
          )}

          {/* ── Submit New Attempt ── */}
          {canSubmit && !hasSubmittedAttempt && (
            <div className="px-4 py-3 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">⬆</span>
                <h4 className="text-base font-semibold text-discord-text">{t("submitNewAttempt")}</h4>
              </div>
              {/* Attempts gauge */}
              {(() => {
                const used = task.myAttemptCount || 0;
                const max = task.maxAttempts;
                const remaining = max - used;
                const pct = Math.min((used / max) * 100, 100);
                return (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-discord-text-muted shrink-0 font-medium">{t("attemptsGauge", { used, max })}</span>
                    <div className="flex-1 h-2 bg-discord-border rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${remaining <= 1 ? "bg-red-500" : remaining <= 2 ? "bg-amber-500" : "bg-green-500"}`} style={{ width: `${pct}%` }} />
                    </div>
                    {remaining <= 1 && remaining > 0 && <span className="text-red-400 font-bold">{t("lastAttempt")}</span>}
                  </div>
                );
              })()}

              {hasSlots ? (
                <div className="space-y-2">
                  {task.deliverableSlots!.map((slot, idx) => (
                    <SlotSubmissionField key={slot.id} slot={slot} index={idx}
                      files={slotFiles[slot.id] || []} onFilesChange={(f) => setSlotFiles((prev) => ({ ...prev, [slot.id]: f }))}
                      text={slotTexts[slot.id] || ""} onTextChange={(t) => setSlotTexts((prev) => ({ ...prev, [slot.id]: t }))}
                      selections={slotSelections[slot.id] || []} onSelectionsChange={(s) => setSlotSelections((prev) => ({ ...prev, [slot.id]: s }))}
                      rating={slotRatings[slot.id]} onRatingChange={(r) => setSlotRatings((prev) => ({ ...prev, [slot.id]: r }))} />
                  ))}
                </div>
              ) : (
                <FileUpload files={deliverableFiles} onFilesChange={setDeliverableFiles} context="attempt-deliverable" maxFiles={10} maxSizeMb={100} label={t("uploadDeliverables")} compact />
              )}
              <textarea value={deliverableText} onChange={(e) => setDeliverableText(e.target.value)} placeholder={t("notesForReviewer")}
                className="w-full p-2 bg-discord-bg-dark border border-discord-border rounded text-sm text-discord-text placeholder-discord-text-muted focus:outline-none focus:border-discord-accent resize-none" rows={2} />
              {error && <p className="text-xs text-discord-red mt-1">{error}</p>}
              <div className="flex gap-2">
                <button onClick={() => { setExpanded(false); setDeliverableFiles([]); setSlotTexts({}); setSlotFiles({}); setSlotSelections({}); setSlotRatings({}); setError(""); }}
                  className="flex-1 py-2 text-xs bg-discord-bg-hover text-discord-text-muted rounded-lg font-semibold hover:bg-discord-border transition cursor-pointer">{t("cancel")}</button>
                <button onClick={handleSubmit} disabled={submitting || (task.maxAttempts - (task.myAttemptCount || 0)) <= 0}
                  className="flex-1 py-2 text-xs bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1">
                  <ButtonSpinner loading={submitting}>{isLockedForMe ? t("submitRevision") : t("submitAttempt")}</ButtonSpinner>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Rejected attempt info — user can submit again or appeal */}
      {hasRejectedAttempt && task.status === "active" && (
        <div className="px-4 py-2 bg-red-500/5 border-t border-discord-border/50">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">
              {t("rejected")}
            </span>
            <span className="text-xs text-discord-text-muted flex-1">
              {t("rejectedSubmitAgain")}
            </span>
            {!appealFiled && !appealDenied && !showAppealForm && (
              <button
                onClick={() => setShowAppealForm(true)}
                className="text-xs px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded font-semibold transition"
              >
                {t("appeal")}
              </button>
            )}
            {appealFiled && (
              <span className="text-xs px-2.5 py-1 bg-amber-500/10 text-amber-400/70 rounded font-semibold">
                {t("appealSubmitted")}
              </span>
            )}
            {appealDenied && (
              <span className="text-xs px-2.5 py-1 bg-red-500/10 text-red-400/70 rounded font-semibold">
                {t("appealDenied")}
              </span>
            )}
          </div>
          {appealFiled && (
            <p className="text-xs text-green-400 mt-1">{t("appealFiled")}</p>
          )}
          {appealDenied && (
            <p className="text-xs text-red-400/70 mt-1">{t("appealDeniedByMod")}</p>
          )}

          {/* Appeal form */}
          {showAppealForm && (
            <div className="mt-2 p-3 bg-discord-bg-dark rounded-lg border border-discord-border/50">
              <p className="text-xs text-discord-text-muted mb-2">
                {t("appealExplain")}
              </p>
              <textarea
                value={appealReason}
                onChange={(e) => setAppealReason(e.target.value)}
                placeholder={t("appealPlaceholder")}
                className="w-full p-2 bg-discord-bg-hover rounded text-sm text-discord-text placeholder-discord-text-muted focus:outline-none resize-none"
                rows={3}
              />
              {appealError && (
                <p className="text-xs text-red-400 mt-1">{appealError}</p>
              )}
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-discord-text-muted">
                  {appealReason.length}/20 min
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setShowAppealForm(false);
                      setAppealReason("");
                      setAppealError("");
                    }}
                    className="text-xs px-3 py-1 bg-discord-bg-hover text-discord-text-muted rounded hover:text-discord-text transition"
                  >
                    {t("cancel")}
                  </button>
                  <button
                    onClick={handleAppeal}
                    disabled={appealSubmitting || appealReason.trim().length < 20}
                    className="text-xs px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded font-semibold transition disabled:opacity-50 flex items-center gap-1"
                  >
                    <ButtonSpinner loading={appealSubmitting}>{t("fileAppeal")}</ButtonSpinner>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Attachment pill with signed URL ──────────────────────────────────────── */

function AttachmentPill({ file }: { file: { name: string; url: string; type: string; size: number } }) {
  const t = useTranslations("taskCard");
  const [loading, setLoading] = useState(false);

  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  const iconMap: Record<string, string> = {
    md: "📄", txt: "📄", mp3: "🎵", wav: "🎵", m4a: "🎵",
    mp4: "🎬", mov: "🎬", png: "🖼️", jpg: "🖼️", jpeg: "🖼️",
    gif: "🖼️", pdf: "📕", srt: "🔤", tsv: "📊", csv: "📊",
  };

  const handleClick = async () => {
    // Local files open directly
    if (file.url.startsWith("/")) {
      window.open(file.url, "_blank");
      return;
    }
    // Open window immediately (synchronous with click) so Safari doesn't block it
    const win = window.open("about:blank", "_blank");
    setLoading(true);
    try {
      const res = await fetch(`/api/upload/signed-url?url=${encodeURIComponent(file.url)}`);
      const data = await res.json();
      if (data.signedUrl && win) {
        win.location.href = data.signedUrl;
      } else {
        win?.close();
      }
    } catch {
      win?.close();
    }
    setLoading(false);
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="flex items-center gap-1.5 px-3 py-2 bg-discord-bg-dark rounded-lg border border-discord-border hover:border-discord-accent/50 transition text-sm text-discord-text-secondary cursor-pointer disabled:opacity-60"
    >
      <span>{iconMap[ext] || "📁"}</span>
      <span>{file.name}</span>
      {loading && <span className="text-[10px] text-discord-text-muted animate-pulse">{t("opening")}</span>}
    </button>
  );
}

/* ── Slot-based submission field ─────────────────────────────────────────── */

function SlotSubmissionField({
  slot,
  index,
  files,
  onFilesChange,
  text,
  onTextChange,
  selections,
  onSelectionsChange,
  rating,
  onRatingChange,
}: {
  slot: DeliverableSlot;
  index: number;
  files: UploadedFile[];
  onFilesChange: (f: UploadedFile[]) => void;
  text: string;
  onTextChange: (t: string) => void;
  selections: string[];
  onSelectionsChange: (s: string[]) => void;
  rating?: number;
  onRatingChange: (r: number) => void;
}) {
  const t = useTranslations("taskCard");

  const acceptMap: Record<string, string> = {
    "upload-audio": "audio/*",
    "upload-video": "video/*",
    "upload-image": "image/*",
    "upload-text": ".txt,.md,.markdown",
    "upload-tsv": ".tsv,.csv,.txt",
    "upload-srt": ".srt,.vtt",
  };

  const options = slot.selectionOptions
    ? slot.selectionOptions.split("\n").filter((o) => o.trim())
    : [];

  return (
    <div className="p-2.5 bg-discord-bg-dark rounded-lg border border-discord-border">
      {/* Slot header */}
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-base">{slotTypeIcon(slot.type)}</span>
        <span className="text-[10px] font-bold text-discord-text-muted">
          {t("slot", { index: index + 1 })}
        </span>
        <span
          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
            SLOT_TYPE_BADGE[slot.type] || "bg-gray-500/20 text-gray-300"
          }`}
        >
          {slotTypeLabel(slot.type)}
        </span>
        <span className="text-xs font-medium text-discord-text ml-1">
          {slot.title || t("untitled")}
        </span>
      </div>

      {/* Slot description */}
      {slot.description && (
        <p className="text-[11px] text-discord-text-muted mb-2 whitespace-pre-wrap">
          {slot.description}
        </p>
      )}

      {/* Checks info */}
      {slot.checks.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {slot.checks.map((c, ci) => (
            <span
              key={ci}
              className="text-[9px] px-1.5 py-0.5 rounded bg-discord-bg-hover text-discord-text-muted border border-discord-border"
            >
              {c.label}
            </span>
          ))}
        </div>
      )}

      {/* Upload types: file upload */}
      {isUploadType(slot.type) && (
        <FileUpload
          files={files}
          onFilesChange={onFilesChange}
          context="attempt-deliverable"
          maxFiles={slot.type === "upload-video" ? 1 : 5}
          maxSizeMb={slot.maxFileSize ? Number(slot.maxFileSize) * (slot.maxFileSizeUnit === "GB" ? 1024 : slot.maxFileSizeUnit === "KB" ? 0.001 : 1) : 100}
          accept={slot.type === "upload-other" ? slot.fileExtensions?.split(",").map((e) => e.trim()).join(",") : acceptMap[slot.type]}
          label={t("uploadSlotLabel", { type: slotTypeLabel(slot.type).toLowerCase() })}
          compact
        />
      )}

      {/* upload-text also allows inline text */}
      {slot.type === "upload-text" && (
        <textarea
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          placeholder={t("pasteTextHere")}
          className="w-full mt-1.5 p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text placeholder-discord-text-muted focus:outline-none focus:border-discord-accent resize-none"
          rows={3}
        />
      )}

      {/* Textbox: free text input */}
      {slot.type === "textbox" && (
        <textarea
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          placeholder={t("enterYourResponse")}
          className="w-full p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text placeholder-discord-text-muted focus:outline-none focus:border-discord-accent resize-none"
          rows={4}
        />
      )}

      {/* Multiple selection */}
      {slot.type === "multiple-selection" && options.length > 0 && (
        <div className="space-y-1">
          {options.map((opt) => (
            <label
              key={opt}
              className="flex items-center gap-2 text-xs text-discord-text-secondary cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selections.includes(opt)}
                onChange={(e) => {
                  if (e.target.checked) {
                    if (!slot.maxSelections || selections.length < slot.maxSelections) {
                      onSelectionsChange([...selections, opt]);
                    }
                  } else {
                    onSelectionsChange(selections.filter((s) => s !== opt));
                  }
                }}
                className="rounded border-discord-border accent-discord-accent"
              />
              <span>{opt}</span>
            </label>
          ))}
          {(slot.minSelections || slot.maxSelections) && (
            <p className="text-[10px] text-discord-text-muted mt-1">
              {slot.minSelections ? t("min", { min: slot.minSelections }) : ""}
              {slot.minSelections && slot.maxSelections ? " · " : ""}
              {slot.maxSelections ? t("max", { max: slot.maxSelections }) : ""}
              {" · "}{t("selected", { count: selections.length })}
            </p>
          )}
        </div>
      )}

      {/* Rating */}
      {slot.type === "rating" && (
        <div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={slot.ratingMin ?? 1}
              max={slot.ratingMax ?? 5}
              step={slot.ratingStep ?? 1}
              value={rating ?? slot.ratingMin ?? 1}
              onChange={(e) => onRatingChange(parseFloat(e.target.value))}
              className="flex-1 accent-discord-accent"
            />
            <span className="text-sm font-bold text-discord-text min-w-8 text-center">
              {rating ?? "—"}
            </span>
          </div>
          <p className="text-[10px] text-discord-text-muted mt-0.5">
            {slot.ratingMin ?? 1} – {slot.ratingMax ?? 5}
            {slot.ratingStep && slot.ratingStep !== 1 ? ` (step: ${slot.ratingStep})` : ""}
          </p>
        </div>
      )}
    </div>
  );
}
