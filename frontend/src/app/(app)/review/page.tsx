"use client";

import { Suspense, useEffect, useRef, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter, useSearchParams } from "next/navigation";
import { ButtonSpinner } from "@/components/ui/Spinner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { getSocket, onSocketReady, WS_EVENTS } from "@/lib/realtime";
import { FilePreviewList, type UploadedFile } from "@/components/ui/FileUpload";
import { SignedMedia } from "@/components/ui/SignedMedia";
import type { DeliverableSlot } from "@/types/deliverable-slot";
import { slotTypeLabel, slotTypeIcon, SLOT_TYPE_BADGE } from "@/types/deliverable-slot";

interface ChecklistItem {
  label: string;
}

interface SlotDeliverable {
  slotId: string;
  text?: string;
  files?: UploadedFile[];
  selections?: string[];
  rating?: number;
}

interface TaskWithAttempts {
  id: string;
  title: string;
  titleCn?: string | null;
  channelName: string;
  channelSlug: string;
  createdById: string;
  checklist?: ChecklistItem[] | null;
  attachments?: { name: string; url: string; type: string; size: number }[] | null;
  deliverableSlots?: DeliverableSlot[] | null;
  status: string;
  lockedById?: string | null;
  lockExpiresAt?: string | null;
  attempts: AttemptItem[];
}

interface AttemptItem {
  id: string;
  taskId: string;
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: string;
  deliverables: any;
  createdAt: string;
}

export default function ReviewPage() {
  const tc = useTranslations("common");
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full bg-discord-bg text-discord-text-muted">{tc("loading")}</div>}>
      <ReviewContent />
    </Suspense>
  );
}

function ReviewContent() {
  const t = useTranslations("review");
  const tc = useTranslations("common");
  const tt = useTranslations("tasks");
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const taskFilter = searchParams.get("task");

  const [tasksWithAttempts, setTasksWithAttempts] = useState<TaskWithAttempts[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<TaskWithAttempts | null>(null);
  const [selectedAttempt, setSelectedAttempt] = useState<AttemptItem | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState("");
  // Checklist state: tracks which items pass (true = pass, false = fail)
  const [checklistState, setChecklistState] = useState<Record<number, boolean>>({});
  // Lock for revision
  const [lockConfirmOpen, setLockConfirmOpen] = useState(false);
  const [locking, setLocking] = useState(false);
  // Unlock
  const [unlockConfirmOpen, setUnlockConfirmOpen] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  // Track whether we've auto-selected the task from the notification link
  const autoSelectedRef = useRef(false);

  const fetchReviewItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/tasks?includeSubmittedAttempts=true");
      if (!res.ok) throw new Error("Failed to fetch tasks");
      const data = await res.json();

      const allTasks = data.tasks || [];
      const submittedAttempts = data.submittedAttempts || [];

      // Group attempts by task
      const taskMap = new Map<string, TaskWithAttempts>();
      for (const task of allTasks) {
        taskMap.set(task.id, {
          id: task.id,
          title: task.title,
          titleCn: task.titleCn,
          channelName: task.channelName,
          channelSlug: task.channelSlug,
          createdById: task.createdById,
          checklist: task.checklist || null,
          attachments: task.attachments || null,
          deliverableSlots: task.deliverableSlots || null,
          status: task.status,
          lockedById: task.lockedById || null,
          lockExpiresAt: task.lockExpiresAt || null,
          attempts: [],
        });
      }

      for (const attempt of submittedAttempts) {
        const task = taskMap.get(attempt.taskId);
        if (!task) continue;
        task.attempts.push({
          id: attempt.id,
          taskId: attempt.taskId,
          userId: attempt.userId,
          username: attempt.username,
          displayName: attempt.displayName,
          avatarUrl: attempt.avatarUrl,
          status: attempt.status,
          deliverables: attempt.deliverables,
          createdAt: attempt.createdAt,
        });
      }

      // Show tasks with submitted attempts OR locked tasks (so mods can unlock them)
      const result = Array.from(taskMap.values()).filter((t) => t.attempts.length > 0 || t.status === "locked");
      // If coming from a notification, pin that task to the top
      if (taskFilter) {
        result.sort((a, b) => (a.id === taskFilter ? -1 : b.id === taskFilter ? 1 : 0));
      }
      setTasksWithAttempts(result);
    } catch (err) {
      console.error("Failed to fetch review items:", err);
      setTasksWithAttempts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!["admin", "supermod", "mod"].includes(user?.role ?? "")) {
      router.push("/channels");
      return;
    }
    fetchReviewItems();
  }, [user, fetchReviewItems]);

  // Real-time: auto-refresh review queue when new submissions arrive
  useEffect(() => {
    const handleUpdate = () => fetchReviewItems();
    const unsub = onSocketReady((socket) => {
      socket.on(WS_EVENTS.NOTIFICATION_NEW, handleUpdate);
    });
    return () => {
      unsub();
      getSocket()?.off(WS_EVENTS.NOTIFICATION_NEW, handleUpdate);
    };
  }, [fetchReviewItems]);

  const handleSelectTask = (task: TaskWithAttempts) => {
    setReviewNote("");
    setRejectionReason("");
    setReviewError("");
    setSelectedAttempt(null);
    // Initialize checklist: all items checked (pass) by default
    if (task.checklist && task.checklist.length > 0) {
      const initial: Record<number, boolean> = {};
      task.checklist.forEach((_, i) => { initial[i] = true; });
      setChecklistState(initial);
    } else {
      setChecklistState({});
    }

    setSelectedTask(task);
    if (task.attempts.length > 0) setSelectedAttempt(task.attempts[0]);
  };

  // Auto-select the task from notification link (only once, on first load)
  useEffect(() => {
    if (!taskFilter || loading || autoSelectedRef.current || tasksWithAttempts.length === 0) return;
    const target = tasksWithAttempts.find((t) => t.id === taskFilter);
    if (target) {
      autoSelectedRef.current = true;
      handleSelectTask(target);
    }
  }, [taskFilter, loading, tasksWithAttempts]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDeselectTask = () => {
    setSelectedTask(null);
    setSelectedAttempt(null);
    setReviewNote("");
    setRejectionReason("");
    setReviewError("");
  };

  const handleReview = async (status: "approved" | "rejected") => {
    if (!selectedTask || !selectedAttempt) return;
    setSubmitting(true);
    setReviewError("");

    try {
      const res = await fetch(
        `/api/tasks/${selectedTask.id}/attempts/${selectedAttempt.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status,
            reviewNote,
            rejectionReason: status === "rejected" ? rejectionReason : undefined,
            checklistResults: status === "approved" && selectedTask.checklist?.length
              ? selectedTask.checklist.map((_, i) => checklistState[i] !== false)
              : undefined,
          }),
        }
      );

      if (res.ok) {
        // Remove this attempt from the list
        const remainingAttempts = selectedTask.attempts.filter(
          (a) => a.id !== selectedAttempt.id
        );

        if (remainingAttempts.length > 0 && status === "rejected") {
          // More attempts to review — select the next one
          const updatedTask = { ...selectedTask, attempts: remainingAttempts };
          setSelectedTask(updatedTask);
          setSelectedAttempt(remainingAttempts[0]);
          setTasksWithAttempts((prev) =>
            prev.map((t) => (t.id === updatedTask.id ? updatedTask : t))
          );
        } else {
          // Task approved or no more attempts — go back to queue
          setSelectedTask(null);
          setSelectedAttempt(null);
          fetchReviewItems();
        }
        setReviewNote("");
        setRejectionReason("");
        setReviewError("");
      } else {
        const data = await res.json();
        setReviewError(data.error || "Failed to submit review");
      }
    } catch {
      setReviewError("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnlock = async () => {
    if (!selectedTask) return;
    setUnlocking(true);
    setReviewError("");
    try {
      const res = await fetch(`/api/tasks/${selectedTask.id}/unlock`, {
        method: "POST",
      });
      if (res.ok) {
        setUnlockConfirmOpen(false);
        setSelectedTask(null);
        setSelectedAttempt(null);
        fetchReviewItems();
      } else {
        const data = await res.json();
        setReviewError(data.error || "Failed to unlock task");
        setUnlockConfirmOpen(false);
      }
    } catch {
      setReviewError("Network error");
      setUnlockConfirmOpen(false);
    } finally {
      setUnlocking(false);
    }
  };

  const handleLockForRevision = async () => {
    if (!selectedTask || !selectedAttempt) return;
    setLocking(true);
    setReviewError("");
    try {
      const res = await fetch(`/api/tasks/${selectedTask.id}/lock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creatorId: selectedAttempt.userId }),
      });
      if (res.ok) {
        setLockConfirmOpen(false);
        setSelectedTask(null);
        setSelectedAttempt(null);
        fetchReviewItems();
      } else {
        const data = await res.json();
        setReviewError(data.error || "Failed to lock task");
        setLockConfirmOpen(false);
      }
    } catch {
      setReviewError("Network error");
      setLockConfirmOpen(false);
    } finally {
      setLocking(false);
    }
  };

  const canReview = selectedTask && selectedAttempt && selectedAttempt.userId !== user?.id;
  const hasFailedChecklist = Object.values(checklistState).some((v) => !v);
  const canApprove = canReview && !hasFailedChecklist;

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours < 1) return "Just now";
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-discord-bg">
      <div className="flex-1 overflow-hidden flex">
        {/* Task Queue */}
        <div className="w-96 border-r border-discord-border overflow-y-auto p-4">
          <h3 className="text-sm font-semibold text-discord-text-muted mb-3 uppercase tracking-wide">
            {t("reviewQueue")}
          </h3>
          {loading ? (
            <p className="text-sm text-discord-text-muted">{tc("loading")}</p>
          ) : tasksWithAttempts.length === 0 ? (
            <div className="text-center text-discord-text-muted py-8">
              <svg className="w-8 h-8 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm">{t("noTasksToReview")}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {tasksWithAttempts.map((task) => {
                return (
                  <button
                    key={task.id}
                    onClick={() => handleSelectTask(task)}
                    className={`w-full text-left p-3 rounded-lg border transition ${
                      selectedTask?.id === task.id
                        ? "bg-discord-accent/10 border-discord-accent"
                        : "bg-discord-sidebar border-discord-border hover:bg-discord-bg-hover/50"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-discord-text truncate">
                        {task.title}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {task.status === "locked" && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 font-semibold">
                            {tt("locked").toUpperCase()}
                          </span>
                        )}
                        <span className="text-xs px-1.5 py-0.5 rounded bg-discord-accent/20 text-discord-accent">
                          {task.channelName}
                        </span>
                      </div>
                    </div>
                    {/* Submission count */}
                    <div className="text-xs text-discord-text-muted">
                      {task.status === "locked" && task.attempts.length === 0
                        ? t("lockForRevision")
                        : task.attempts.length !== 1
                          ? t("submissionsPlural", { count: task.attempts.length })
                          : t("submissions", { count: task.attempts.length })}
                    </div>
                    {/* Submitters + time */}
                    {task.attempts.length > 0 && (
                      <div className="mt-1.5 space-y-0.5 border-t border-discord-border/30 pt-1.5">
                        {task.attempts.slice(0, 3).map((a) => (
                          <div key={a.id} className="flex items-center justify-between text-[11px]">
                            <span className="text-discord-text-secondary truncate">
                              👤 {a.displayName || a.username}
                            </span>
                            <span className="text-discord-text-muted shrink-0 ml-2">
                              {formatTime(a.createdAt)}
                            </span>
                          </div>
                        ))}
                        {task.attempts.length > 3 && (
                          <span className="text-[10px] text-discord-text-muted">+{task.attempts.length - 3} more</span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Review Detail */}
        <div className="flex-1 overflow-y-auto p-6">
          {!selectedTask ? (
            <div className="flex flex-col items-center justify-center h-full text-discord-text-muted">
              <svg className="w-12 h-12 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              <p>{t("selectTask")}</p>
            </div>
          ) : (
            <div className="max-w-2xl">
              {/* Back / Release button */}
              <button
                onClick={handleDeselectTask}
                className="mb-4 text-xs text-discord-text-muted hover:text-discord-text transition flex items-center gap-1 cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                {tc("back")}
              </button>

              {/* Task info */}
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-lg font-semibold text-discord-text">
                    {selectedTask.title}
                  </h3>
                  <span className="text-xs px-2 py-0.5 rounded bg-discord-accent/20 text-discord-accent">
                    {selectedTask.channelName}
                  </span>
                </div>
                <p className="text-sm text-discord-text-muted">
                  {selectedTask.attempts.length !== 1
                    ? t("submissionsPlural", { count: selectedTask.attempts.length })
                    : t("submissions", { count: selectedTask.attempts.length })}
                </p>
              </div>

              {/* Locked task info — no attempts to review, show unlock option */}
              {selectedTask.status === "locked" && selectedTask.attempts.length === 0 && (
                <div className="mb-4 p-4 bg-orange-500/10 border border-orange-500/30 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <svg className="w-5 h-5 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    <span className="text-sm font-semibold text-orange-300">Task is locked for exclusive revision</span>
                  </div>
                  {selectedTask.lockExpiresAt && (
                    <p className="text-xs text-orange-300/80 mb-3">
                      Lock expires: {new Date(selectedTask.lockExpiresAt).toLocaleString()}
                    </p>
                  )}
                  <p className="text-sm text-discord-text-secondary mb-4">
                    The creator has been asked to revise their submission. No new submissions can be reviewed until the lock expires or is manually released.
                  </p>

                  {reviewError && (
                    <div className="mb-3 p-2 bg-red-500/10 border border-red-500/30 rounded">
                      <p className="text-xs text-red-400">{reviewError}</p>
                    </div>
                  )}

                  <button
                    onClick={() => setUnlockConfirmOpen(true)}
                    className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-semibold transition disabled:opacity-50 flex items-center gap-2 cursor-pointer"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                    </svg>
                    {t("unlock")}
                  </button>
                </div>
              )}

              {/* === LOCKED TASK: Split view — locked user's revision vs other attempts === */}
              {selectedTask.status === "locked" && selectedTask.attempts.length > 0 && (() => {
                const lockedAttempts = selectedTask.attempts.filter((a) => a.userId === selectedTask.lockedById);
                const otherAttempts = selectedTask.attempts.filter((a) => a.userId !== selectedTask.lockedById);
                const lockedAttempt = lockedAttempts.length > 0 ? lockedAttempts[lockedAttempts.length - 1] : null;
                const isViewingLocked = selectedAttempt && selectedAttempt.userId === selectedTask.lockedById;

                return (
                  <>
                    {/* Locked user's revision section */}
                    <div className="mb-6">
                      <div className="flex items-center gap-2 mb-3">
                        <svg className="w-4 h-4 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                        <h4 className="text-sm font-semibold text-orange-300">
                          Locked: {lockedAttempt?.displayName || lockedAttempt?.username || "Awaiting revision"}
                        </h4>
                      </div>

                      {lockedAttempt ? (
                        <button
                          onClick={() => {
                            setSelectedAttempt(lockedAttempt);
                            setReviewNote("");
                            setRejectionReason("");
                            setReviewError("");
                          }}
                          className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition cursor-pointer border ${
                            isViewingLocked
                              ? "bg-orange-500/15 border-orange-500/40 text-orange-200"
                              : "bg-discord-sidebar border-discord-border text-discord-text-muted hover:text-discord-text"
                          }`}
                        >
                          {lockedAttempt.displayName || lockedAttempt.username} — revision submitted {formatTime(lockedAttempt.createdAt)}
                        </button>
                      ) : (
                        <div className="px-3 py-2 rounded-lg bg-discord-sidebar border border-discord-border">
                          <p className="text-xs text-discord-text-muted italic">No revision submitted yet</p>
                        </div>
                      )}
                    </div>

                    {/* Other attempts section (read-only) */}
                    {otherAttempts.length > 0 && (
                      <div className="mb-6">
                        <h4 className="text-sm font-semibold text-discord-text-muted mb-3">
                          Other submissions
                        </h4>
                        <div className="flex gap-1 overflow-x-auto">
                          {otherAttempts.map((a) => (
                            <button
                              key={a.id}
                              onClick={() => {
                                setSelectedAttempt(a);
                                setReviewNote("");
                                setRejectionReason("");
                                setReviewError("");
                              }}
                              className={`px-3 py-1.5 text-xs rounded font-medium transition whitespace-nowrap cursor-pointer ${
                                selectedAttempt?.id === a.id
                                  ? "bg-discord-accent text-white"
                                  : "bg-discord-sidebar text-discord-text-muted hover:text-discord-text"
                              }`}
                            >
                              {a.displayName || a.username}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Attempt detail — shown for whichever attempt is selected */}
                    {selectedAttempt && (
                      <>
                        <div className="mb-4">
                          <p className="text-sm text-discord-text-muted">
                            {t("submittedBy", { name: selectedAttempt.displayName || selectedAttempt.username })}
                            {" — "}{formatTime(selectedAttempt.createdAt)}
                            {!isViewingLocked && (
                              <span className="ml-2 text-xs text-discord-text-muted italic">({tt("locked")})</span>
                            )}
                          </p>
                        </div>

                        {/* Task attachments (by task creator) */}
                        {selectedTask.attachments && selectedTask.attachments.length > 0 && (
                          <div className="mb-4 p-3 bg-discord-bg-dark rounded-lg border border-discord-border">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-base">📎</span>
                              <h4 className="text-sm font-semibold text-discord-text">{t("taskAttachments")}</h4>
                              <span className="text-[10px] text-discord-text-muted">(added by task creator)</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {selectedTask.attachments.map((f, fi) => {
                                const ext = f.name.split(".").pop()?.toLowerCase() || "";
                                const icons: Record<string, string> = { md: "📄", txt: "📄", mp3: "🎵", wav: "🎵", m4a: "🎵", mp4: "🎬", mov: "🎬", png: "🖼️", jpg: "🖼️", jpeg: "🖼️", pdf: "📕", srt: "🔤", tsv: "📊" };
                                return (
                                  <button key={fi} onClick={async () => {
                                    if (f.url.startsWith("/")) { window.open(f.url, "_blank"); return; }
                                    const win = window.open("about:blank", "_blank");
                                    try {
                                      const res = await fetch(`/api/upload/signed-url?url=${encodeURIComponent(f.url)}`);
                                      const data = await res.json();
                                      if (data.signedUrl && win) win.location.href = data.signedUrl; else win?.close();
                                    } catch { win?.close(); }
                                  }} className="flex items-center gap-1.5 px-3 py-2 bg-discord-sidebar rounded-lg border border-discord-border hover:border-discord-accent/50 transition text-sm text-discord-text-secondary cursor-pointer">
                                    <span>{icons[ext] || "📁"}</span><span>{f.name}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Deliverables */}
                        <DeliverableDisplay deliverables={selectedAttempt.deliverables} slots={selectedTask.deliverableSlots} />

                        {/* Review controls — ONLY for locked user's revision */}
                        {isViewingLocked && (
                          <>
                            {/* Review Checklist */}
                            {selectedTask.checklist && selectedTask.checklist.length > 0 && (
                              <div className="mb-6 p-4 bg-discord-bg-dark rounded-lg border border-discord-border">
                                <h4 className="text-xs font-semibold text-discord-text-muted mb-1 uppercase">
                                  {t("checklist")}
                                </h4>
                                <p className="text-[10px] text-discord-text-muted mb-3">
                                  All items start checked. Uncheck any item that fails — unchecked items block approval.
                                </p>
                                <div className="space-y-2">
                                  {selectedTask.checklist.map((item, i) => {
                                    const checked = checklistState[i] !== false;
                                    return (
                                      <label key={i} className="flex items-center gap-2 cursor-pointer group">
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={(e) => {
                                            setChecklistState((prev) => ({ ...prev, [i]: e.target.checked }));
                                          }}
                                          className="rounded"
                                        />
                                        <span className={`text-sm transition ${checked ? "text-discord-text" : "text-red-400 line-through"}`}>
                                          {item.label}
                                        </span>
                                      </label>
                                    );
                                  })}
                                </div>
                                {Object.values(checklistState).some((v) => !v) && (
                                  <div className="mt-3 p-2 bg-red-500/10 border border-red-500/20 rounded-lg">
                                    <p className="text-xs font-semibold text-red-400 mb-1">FAILED ITEMS:</p>
                                    <ul className="text-xs text-red-300 space-y-0.5">
                                      {selectedTask.checklist.map((item, i) =>
                                        checklistState[i] === false ? <li key={i}>• {item.label}</li> : null
                                      )}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Self-review warning */}
                            {selectedAttempt.userId === user?.id && (
                              <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                                <p className="text-sm text-amber-400">
                                  You submitted this attempt — you cannot review your own submission.
                                </p>
                              </div>
                            )}

                            {/* Feedback */}
                            {canReview && (
                              <>
                                <div className="mb-4">
                                  <label className="block text-sm font-medium text-discord-text-secondary mb-1">
                                    {t("reviewNote")}
                                  </label>
                                  <textarea
                                    value={reviewNote}
                                    onChange={(e) => setReviewNote(e.target.value)}
                                    placeholder={t("reviewNotePlaceholder")}
                                    className="w-full p-3 bg-discord-bg-dark border border-discord-border rounded-lg text-sm text-discord-text placeholder-discord-text-muted focus:outline-none focus:border-discord-accent resize-none"
                                    rows={3}
                                  />
                                </div>

                                <div className="mb-6">
                                  <label className="block text-sm font-medium text-discord-text-secondary mb-1">
                                    {t("rejectionReason")}
                                  </label>
                                  <textarea
                                    value={rejectionReason}
                                    onChange={(e) => setRejectionReason(e.target.value)}
                                    placeholder={t("rejectionReasonPlaceholder")}
                                    className="w-full p-3 bg-discord-bg-dark border border-discord-border rounded-lg text-sm text-discord-text placeholder-discord-text-muted focus:outline-none focus:border-red-500/50 resize-none"
                                    rows={2}
                                  />
                                </div>
                              </>
                            )}

                            {/* Error message */}
                            {reviewError && (
                              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                                <p className="text-sm text-red-400">{reviewError}</p>
                              </div>
                            )}

                            {/* Action buttons — Approve / Reject only (no Lock button since already locked) */}
                            {canReview && (
                              <div className="flex gap-3">
                                <button
                                  onClick={() => handleReview("approved")}
                                  disabled={submitting || !canApprove}
                                  title={hasFailedChecklist ? "Cannot approve — checklist items are unchecked" : undefined}
                                  className="flex-1 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                                >
                                  <ButtonSpinner loading={submitting}>
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                  </ButtonSpinner>
                                  {t("approve")}
                                </button>
                                <button
                                  onClick={() => handleReview("rejected")}
                                  disabled={submitting || !rejectionReason.trim()}
                                  className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                                >
                                  <ButtonSpinner loading={submitting}>
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </ButtonSpinner>
                                  {t("reject")}
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </>
                );
              })()}

              {/* === NORMAL (non-locked) TASK: Standard attempt selector + review === */}
              {selectedTask.status !== "locked" && (
                <>
                  {/* Attempt selector tabs */}
                  {selectedTask.attempts.length > 1 && (
                    <div className="flex gap-1 mb-4 overflow-x-auto">
                      {selectedTask.attempts.map((a) => (
                        <button
                          key={a.id}
                          onClick={() => {
                            setSelectedAttempt(a);
                            setReviewNote("");
                            setRejectionReason("");
                            setReviewError("");
                          }}
                          className={`px-3 py-1.5 text-xs rounded font-medium transition whitespace-nowrap cursor-pointer ${
                            selectedAttempt?.id === a.id
                              ? "bg-discord-accent text-white"
                              : "bg-discord-sidebar text-discord-text-muted hover:text-discord-text"
                          }`}
                        >
                          {a.displayName || a.username}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Selected attempt detail */}
                  {selectedAttempt && (
                    <>
                      <div className="mb-4">
                        <p className="text-sm text-discord-text-muted">
                          {t("submittedBy", { name: selectedAttempt.displayName || selectedAttempt.username })}
                          {" — "}{formatTime(selectedAttempt.createdAt)}
                        </p>
                      </div>

                      {/* Task reference attachments */}
                      {selectedTask.attachments && selectedTask.attachments.length > 0 && (
                        <div className="mb-4 p-3 bg-discord-bg-dark rounded-lg border border-discord-border">
                          <FilePreviewList files={selectedTask.attachments} label="Task Reference Files" />
                        </div>
                      )}

                      {/* Deliverables */}
                      <DeliverableDisplay deliverables={selectedAttempt.deliverables} slots={selectedTask.deliverableSlots} />

                      {/* Review Checklist */}
                      {selectedTask.checklist && selectedTask.checklist.length > 0 && (
                        <div className="mb-6 p-4 bg-discord-bg-dark rounded-lg border border-discord-border">
                          <h4 className="text-xs font-semibold text-discord-text-muted mb-1 uppercase">
                            Review Checklist
                          </h4>
                          <p className="text-[10px] text-discord-text-muted mb-3">
                            All items start checked. Uncheck any item that fails — unchecked items block approval.
                          </p>
                          <div className="space-y-2">
                            {selectedTask.checklist.map((item, i) => {
                              const checked = checklistState[i] !== false;
                              return (
                                <label key={i} className="flex items-center gap-2 cursor-pointer group">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      setChecklistState((prev) => ({ ...prev, [i]: e.target.checked }));
                                    }}
                                    className="rounded"
                                  />
                                  <span className={`text-sm transition ${checked ? "text-discord-text" : "text-red-400 line-through"}`}>
                                    {item.label}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                          {Object.values(checklistState).some((v) => !v) && (
                            <div className="mt-3 p-2 bg-red-500/10 border border-red-500/20 rounded-lg">
                              <p className="text-xs font-semibold text-red-400 mb-1">FAILED ITEMS:</p>
                              <ul className="text-xs text-red-300 space-y-0.5">
                                {selectedTask.checklist.map((item, i) =>
                                  checklistState[i] === false ? <li key={i}>• {item.label}</li> : null
                                )}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Self-review warning */}
                      {selectedAttempt.userId === user?.id && (
                        <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                          <p className="text-sm text-amber-400">
                            You submitted this attempt — you cannot review your own submission.
                          </p>
                        </div>
                      )}

                      {/* Feedback — only show if can review */}
                      {canReview && (
                        <>
                          <div className="mb-4">
                            <label className="block text-sm font-medium text-discord-text-secondary mb-1">
                              Review Note (optional)
                            </label>
                            <textarea
                              value={reviewNote}
                              onChange={(e) => setReviewNote(e.target.value)}
                              placeholder="Provide feedback to the creator..."
                              className="w-full p-3 bg-discord-bg-dark border border-discord-border rounded-lg text-sm text-discord-text placeholder-discord-text-muted focus:outline-none focus:border-discord-accent resize-none"
                              rows={3}
                            />
                          </div>

                          <div className="mb-6">
                            <label className="block text-sm font-medium text-discord-text-secondary mb-1">
                              Rejection Reason (required if rejecting)
                            </label>
                            <textarea
                              value={rejectionReason}
                              onChange={(e) => setRejectionReason(e.target.value)}
                              placeholder="Why is this submission being rejected..."
                              className="w-full p-3 bg-discord-bg-dark border border-discord-border rounded-lg text-sm text-discord-text placeholder-discord-text-muted focus:outline-none focus:border-red-500/50 resize-none"
                              rows={2}
                            />
                          </div>
                        </>
                      )}

                      {/* Error message */}
                      {reviewError && (
                        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                          <p className="text-sm text-red-400">{reviewError}</p>
                        </div>
                      )}

                      {/* Actions — only show if can review */}
                      {canReview && (
                        <div className="flex gap-3">
                          <button
                            onClick={() => handleReview("approved")}
                            disabled={submitting || !canApprove}
                            title={hasFailedChecklist ? "Cannot approve — checklist items are unchecked" : undefined}
                            className="flex-1 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                          >
                            <ButtonSpinner loading={submitting}>
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            </ButtonSpinner>
                            {t("approve")}
                          </button>
                          {selectedTask.status === "active" && (
                            <button
                              onClick={() => setLockConfirmOpen(true)}
                              disabled={submitting}
                              className="flex-1 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                              </svg>
                              {t("lockForRevision")}
                            </button>
                          )}
                          <button
                            onClick={() => handleReview("rejected")}
                            disabled={submitting || !rejectionReason.trim()}
                            className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                          >
                            <ButtonSpinner loading={submitting}>
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </ButtonSpinner>
                            Reject
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Lock for Revision confirmation */}
      <ConfirmDialog
        open={lockConfirmOpen}
        onClose={() => setLockConfirmOpen(false)}
        onConfirm={handleLockForRevision}
        title={t("lockForRevision")}
        confirmText={t("lockForRevision")}
        variant="warning"
        loading={locking}
      >
        {t("lockConfirm")}
      </ConfirmDialog>

      {/* Unlock confirmation */}
      <ConfirmDialog
        open={unlockConfirmOpen}
        onClose={() => setUnlockConfirmOpen(false)}
        onConfirm={handleUnlock}
        title={t("unlock")}
        confirmText={t("unlock")}
        variant="warning"
        loading={unlocking}
      >
        {t("unlockConfirm")}
      </ConfirmDialog>
    </div>
  );
}

/* ── Deliverable display for review (supports both legacy and slot-based) ── */

function DeliverableDisplay({
  deliverables,
  slots,
}: {
  deliverables: any;
  slots?: DeliverableSlot[] | null;
}) {
  const t = useTranslations("review");
  if (!deliverables) {
    return (
      <div className="mb-6 p-4 bg-discord-bg-dark rounded-lg border border-discord-border">
        <h4 className="text-xs font-semibold text-discord-text-muted mb-3 uppercase">{t("deliverables")}</h4>
        <p className="text-sm text-discord-text-muted italic">{t("noDeliverables")}</p>
      </div>
    );
  }

  // Slot-based deliverables
  if (deliverables.slots && Array.isArray(deliverables.slots)) {
    const slotMap = new Map(slots?.map((s) => [s.id, s]) || []);
    return (
      <div className="mb-6 p-4 bg-discord-bg-dark rounded-lg border border-discord-border space-y-3">
        <h4 className="text-xs font-semibold text-discord-text-muted mb-1 uppercase">
          {t("deliverables")} ({deliverables.slots.length})
        </h4>
        {deliverables.slots.map((sd: SlotDeliverable, i: number) => {
          const slotDef = slotMap.get(sd.slotId);
          return (
            <div key={sd.slotId} className="p-3 bg-discord-sidebar rounded-lg border border-discord-border">
              {/* Slot header */}
              <div className="flex items-center gap-2 mb-2">
                <span className="text-base">{slotDef ? slotTypeIcon(slotDef.type) : "📦"}</span>
                <span className="text-xs font-bold text-discord-text-muted">SLOT {i + 1}</span>
                {slotDef && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${SLOT_TYPE_BADGE[slotDef.type] || "bg-gray-500/20 text-gray-300"}`}>
                    {slotTypeLabel(slotDef.type)}
                  </span>
                )}
                <span className="text-sm font-medium text-discord-text">
                  {slotDef?.title || "Untitled"}
                </span>
              </div>

              {/* Files */}
              {sd.files && sd.files.length > 0 && (
                <div className="space-y-2">
                  {sd.files.map((f, fi) => (
                    <div key={fi}>
                      <SignedMedia url={f.url} type={f.type} name={f.name} />
                    </div>
                  ))}
                </div>
              )}

              {/* Text */}
              {sd.text && (
                <div className="text-sm text-discord-text whitespace-pre-wrap bg-discord-bg-dark p-3 rounded mt-2">
                  {sd.text}
                </div>
              )}

              {/* Selections */}
              {sd.selections && sd.selections.length > 0 && (
                <div className="mt-2">
                  <span className="text-xs text-discord-text-muted font-semibold">Selected:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {sd.selections.map((s, si) => (
                      <span key={si} className="text-xs px-2 py-0.5 rounded bg-discord-accent/20 text-discord-accent">{s}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Rating */}
              {sd.rating !== undefined && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-discord-text-muted font-semibold">Rating:</span>
                  <div className="flex items-center gap-0.5">
                    {Array.from({ length: slotDef?.ratingMax ?? 5 }, (_, si) => (
                      <span key={si} className={`text-sm ${si < (sd.rating ?? 0) ? "text-yellow-400" : "text-discord-border"}`}>★</span>
                    ))}
                  </div>
                  <span className="text-sm font-bold text-discord-text">{sd.rating}/{slotDef?.ratingMax ?? 5}</span>
                </div>
              )}

              {/* Automated checks */}
              {slotDef?.checks && slotDef.checks.length > 0 && (
                <div className="mt-2 pt-2 border-t border-discord-border/30">
                  <span className="text-[10px] font-bold text-discord-text-muted uppercase">Automated Checks</span>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {slotDef.checks.map((c, ci) => (
                      <span key={ci} className="text-[10px] px-2 py-0.5 rounded bg-green-500/10 text-green-300 border border-green-500/20">
                        ✓ {c.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // Legacy format: { text?, files? }
  return (
    <div className="mb-6 p-4 bg-discord-bg-dark rounded-lg border border-discord-border">
      <h4 className="text-xs font-semibold text-discord-text-muted mb-3 uppercase">{t("deliverables")}</h4>
      {deliverables.text && (
        <div className="text-sm text-discord-text whitespace-pre-wrap bg-discord-sidebar p-3 rounded mb-3">
          {deliverables.text}
        </div>
      )}
      {deliverables.files && deliverables.files.length > 0 && (
        <div className="space-y-2">
          {deliverables.files.map((f: UploadedFile, i: number) => (
            <SignedMedia key={i} url={f.url} type={f.type} name={f.name} />
          ))}
        </div>
      )}
      {!deliverables.text && (!deliverables.files || deliverables.files.length === 0) && (
        <p className="text-sm text-discord-text-muted italic">{t("noDeliverables")}</p>
      )}
    </div>
  );
}
