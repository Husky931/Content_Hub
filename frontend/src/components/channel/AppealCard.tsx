"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { ButtonSpinner } from "@/components/ui/Spinner";
import { FilePreviewList, type UploadedFile } from "@/components/ui/FileUpload";
import { useTranslations, useLocale } from "next-intl";
import { localized } from "@/lib/localize";

interface AppealData {
  id: string;
  attemptId: string;
  userId: string;
  reason: string;
  status: "pending" | "granted" | "denied";
  arbitratorId: string | null;
  arbitratorNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
  user: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    role: string;
  } | null;
  attempt: {
    id: string;
    status: string;
    deliverables: { text?: string; files?: UploadedFile[] } | null;
    rejectionReason: string | null;
  } | null;
  task: {
    id: string;
    title: string;
    titleCn?: string | null;
  } | null;
  channelSlug: string | null;
  channelName: string | null;
  reviewer: {
    id: string;
    username: string;
    displayName: string | null;
  } | null;
}

interface AppealCardProps {
  appeal: AppealData;
  onResolved?: () => void;
}

export function AppealCard({ appeal, onResolved }: AppealCardProps) {
  const { user } = useAuth();
  const t = useTranslations("appeals");
  const locale = useLocale();
  const [expanded, setExpanded] = useState(appeal.status === "pending");
  const [arbitratorNote, setArbitratorNote] = useState("");
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState("");

  const isMod = ["mod", "supermod", "admin"].includes(user?.role ?? "");
  const isOwner = user?.id === appeal.userId;
  const isPending = appeal.status === "pending";

  const creatorName =
    appeal.user?.displayName || appeal.user?.username || "Unknown";
  const reviewerName =
    appeal.reviewer?.displayName || appeal.reviewer?.username || "Unknown";

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${dd}/${mm} ${hh}:${min}`;
  };

  const handleResolve = async (status: "granted" | "denied") => {
    setResolving(true);
    setError("");
    try {
      const res = await fetch(`/api/appeals/${appeal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          arbitratorNote: arbitratorNote.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t("failedToResolve"));
        return;
      }
      onResolved?.();
    } catch {
      setError(t("failedToResolve"));
    } finally {
      setResolving(false);
    }
  };

  const statusBadge = {
    pending: {
      bg: "bg-amber-500/20",
      text: "text-amber-300",
      label: t("pending"),
    },
    granted: {
      bg: "bg-green-500/20",
      text: "text-green-400",
      label: t("upheld"),
    },
    denied: { bg: "bg-red-500/20", text: "text-red-400", label: t("denied") },
  }[appeal.status];

  return (
    <div
      className={`mx-2 my-2 rounded-lg border overflow-hidden ${isPending
          ? "border-amber-500/30 bg-amber-500/5"
          : appeal.status === "granted"
            ? "border-green-500/20 bg-green-500/5"
            : "border-red-500/20 bg-red-500/5 opacity-70"
        }`}
    >
      {/* Header */}
      <div
        className="px-4 py-3 flex items-center gap-2 cursor-pointer hover:bg-white/5 transition"
        onClick={() => setExpanded(!expanded)}
      >
        <span
          className={`text-xs font-semibold px-1.5 py-0.5 rounded ${statusBadge.bg} ${statusBadge.text}`}
        >
          {statusBadge.label}
        </span>
        <span className="text-sm font-medium text-discord-text truncate">
          {appeal.task ? localized(locale, appeal.task.title, appeal.task.titleCn) : t("unknownTask")}
        </span>
        {appeal.channelName && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-discord-bg-hover text-discord-text-muted font-medium">
            #{appeal.channelName}
          </span>
        )}
        <span className="text-xs text-discord-text-muted ml-auto shrink-0">
          {t("by", { name: creatorName, date: formatDate(appeal.createdAt) })}
        </span>
        <svg
          className={`w-4 h-4 text-discord-text-muted transition-transform shrink-0 ${expanded ? "rotate-180" : ""
            }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-discord-border/30">
          {/* Rejection reason */}
          {appeal.attempt?.rejectionReason && (
            <div className="mt-3 p-3 bg-red-500/10 rounded-lg">
              <div className="text-xs font-semibold text-red-400 mb-1">
                {t("rejectionReason")}
              </div>
              <p className="text-sm text-red-300">
                {appeal.attempt.rejectionReason}
              </p>
              {appeal.reviewer && (
                <p className="text-xs text-red-400/60 mt-1">
                  {t("rejectedBy", { name: reviewerName })}
                </p>
              )}
            </div>
          )}

          {/* Creator's appeal reason */}
          <div className="mt-3 p-3 bg-blue-500/10 rounded-lg">
            <div className="text-xs font-semibold text-blue-400 mb-1">
              {t("creatorsAppeal")}
            </div>
            <p className="text-sm text-blue-300">{appeal.reason}</p>
          </div>

          {/* Submission/deliverables */}
          {appeal.attempt?.deliverables && (
            <div className="mt-3 p-3 bg-discord-bg-dark rounded-lg">
              <div className="text-xs font-semibold text-discord-text-muted mb-2">
                {t("submission")}
              </div>
              {appeal.attempt.deliverables.text && (
                <p className="text-sm text-discord-text-secondary mb-2">
                  {appeal.attempt.deliverables.text}
                </p>
              )}
              {appeal.attempt.deliverables.files &&
                appeal.attempt.deliverables.files.length > 0 && (
                  <FilePreviewList
                    files={appeal.attempt.deliverables.files}
                  />
                )}
            </div>
          )}

          {/* Arbitrator note (if resolved) */}
          {appeal.arbitratorNote && !isPending && (
            <div className="mt-3 p-3 bg-discord-bg-dark rounded-lg">
              <div className="text-xs font-semibold text-discord-text-muted mb-1">
                {t("arbitratorNote")}
              </div>
              <p className="text-sm text-discord-text-secondary">
                {appeal.arbitratorNote}
              </p>
            </div>
          )}

          {/* Mod review actions (only for pending appeals, only for mods) */}
          {isPending && isMod && (
            <div className="mt-3">
              <textarea
                value={arbitratorNote}
                onChange={(e) => setArbitratorNote(e.target.value)}
                placeholder={t("arbitrationNotesPlaceholder")}
                className="w-full p-2 bg-discord-bg-hover rounded text-sm text-discord-text placeholder-discord-text-muted focus:outline-none resize-none mb-2"
                rows={2}
              />
              {error && (
                <p className="text-xs text-red-400 mb-2">{error}</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => handleResolve("granted")}
                  disabled={resolving}
                  className="flex-1 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-50 flex items-center justify-center gap-1"
                >
                  <ButtonSpinner loading={resolving}>{t("upholdAppeal")}</ButtonSpinner>
                </button>
                <button
                  onClick={() => handleResolve("denied")}
                  disabled={resolving}
                  className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-50 flex items-center justify-center gap-1"
                >
                  <ButtonSpinner loading={resolving}>{t("denyAppeal")}</ButtonSpinner>
                </button>
              </div>
            </div>
          )}

          {/* Creator view — read-only status */}
          {isOwner && !isMod && isPending && (
            <div className="mt-3 p-3 bg-amber-500/10 rounded-lg text-center">
              <p className="text-sm text-amber-300">
                {t("appealUnderReview")}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
