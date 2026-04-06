"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations, useLocale } from "next-intl";
import { localized } from "@/lib/localize";
import { useAuth } from "@/contexts/AuthContext";
import { useSettingsModal } from "@/contexts/SettingsModalContext";
import { Spinner, ButtonSpinner } from "@/components/ui/Spinner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { FileUpload } from "@/components/ui/FileUpload";
import { DeliverableSlotEditor } from "@/components/ui/DeliverableSlotEditor";
import { TranslateButton } from "@/components/ui/TranslateButton";
import type { DeliverableSlot } from "@/types/deliverable-slot";
import { AdminTrainingSection } from "@/components/admin/AdminTrainingSection";
import { LessonEditor } from "@/components/admin/LessonEditor";
import { AdminUploadReviewSection } from "@/components/admin/AdminUploadReviewSection";


type Section =
  | "my-account"
  | "profile"
  | "account-settings"
  | "admin-overview"
  | "admin-users"
  | "admin-invites"
  | "admin-tags"
  | "admin-tasks"
  | "admin-channels"
  | "admin-audit"
  | "admin-training"
  | "admin-training-editor"
  | "admin-upload-reviews";

// ─── Shared helpers ────────────────────────────────────────────────────────────

const ROLE_BADGE: Record<string, string> = {
  creator: "bg-blue-500/20 text-blue-300",
  supercreator: "bg-purple-500/20 text-purple-300",
  mod: "bg-green-500/20 text-green-300",
  supermod: "bg-indigo-500/20 text-indigo-300",
  admin: "bg-red-500/20 text-red-300",
};

function RoleBadge({ role }: { role: string }) {
  const t = useTranslations("roles");
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${ROLE_BADGE[role] ?? "bg-gray-500/20 text-gray-300"}`}>
      {t(role as "creator" | "mod" | "supermod" | "admin")}
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-2xl font-bold text-discord-text mb-6">{children}</h2>;
}

// ─── My Account ────────────────────────────────────────────────────────────────

function MyAccountSection() {
  const { user } = useAuth();
  const t = useTranslations("settings");
  if (!user) return null;

  const initials = (user.displayName || user.username).slice(0, 2).toUpperCase();
  const currencyLabel =
    user.currency === "usd" ? t("currencyUsd")
      : user.currency === "rmb" ? t("currencyRmb")
        : t("currencyNotSet");

  return (
    <div className="max-w-2xl">
      <SectionTitle>{t("myAccount")}</SectionTitle>

      <div className="bg-discord-bg-dark rounded-xl overflow-hidden shadow-lg">
        {/* Banner */}
        <div className="h-24 bg-linear-to-r from-discord-accent/50 to-indigo-600/40" />
        {/* Avatar row */}
        <div className="px-6 pb-6">
          <div className="-mt-10 mb-4 flex items-end justify-between">
            <div className="relative">
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="w-20 h-20 rounded-full border-[5px] border-discord-bg-dark shadow-xl" />
              ) : (
                <div className="w-20 h-20 rounded-full bg-discord-accent border-[5px] border-discord-bg-dark flex items-center justify-center text-white font-bold text-2xl shadow-xl">
                  {initials}
                </div>
              )}
              <div className="absolute bottom-1 right-1 w-4 h-4 bg-discord-green rounded-full border-2 border-discord-bg-dark" />
            </div>
          </div>
          <div className="flex items-center gap-3 mb-1">
            <span className="text-xl font-bold text-discord-text">{user.displayName || user.username}</span>
            <RoleBadge role={user.role} />
          </div>
          <div className="text-sm text-discord-text-muted">@{user.username}</div>
        </div>

        {/* Info rows */}
        <div className="border-t border-discord-bg-darker/60 divide-y divide-discord-bg-darker/40">
          {[
            { label: t("displayName"), value: user.displayName || "—" },
            { label: t("username"), value: user.username },
            { label: t("emailLabel"), value: user.email },
            { label: t("currency"), value: currencyLabel },
          ].map(({ label, value }) => (
            <div key={label} className="px-6 py-4">
              <div className="text-xs font-semibold uppercase tracking-widest text-discord-text-muted mb-1">{label}</div>
              <div className="text-sm text-discord-text font-medium">{value}</div>
            </div>
          ))}
          {/* Tags row */}
          <div className="px-6 py-4">
            <div className="text-xs font-semibold uppercase tracking-widest text-discord-text-muted mb-2">{t("tags")}</div>
            {user.tags && user.tags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {user.tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-semibold"
                    style={{ backgroundColor: `${tag.color}25`, color: tag.color, border: `1px solid ${tag.color}40` }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                    {tag.name}
                    {tag.nameCn && <span className="opacity-70">· {tag.nameCn}</span>}
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-sm text-discord-text-muted">{t("noTags")}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Account Settings ─────────────────────────────────────────────────────────

function AccountSettingsSection() {
  const { user } = useAuth();
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  if (!user) return null;

  // Mask email: j***e@example.com
  const maskEmail = (email: string) => {
    const [local, domain] = email.split("@");
    if (local.length <= 2) return `${local[0]}***@${domain}`;
    return `${local[0]}***${local[local.length - 1]}@${domain}`;
  };

  // Mask phone: +1 •••• •••• 4567
  const maskPhone = (phone: string) => {
    if (phone.length < 4) return phone;
    const last4 = phone.slice(-4);
    return `${phone.slice(0, 3)} ${"•".repeat(4)} ${"•".repeat(4)} ${last4}`;
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: t("passwordsDoNotMatch") });
      return;
    }
    if (newPassword.length < 8) {
      setMessage({ type: "error", text: t("passwordRequirements") });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/settings/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error || "Failed" });
      } else {
        setMessage({ type: "success", text: t("passwordUpdated") });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      }
    } catch {
      setMessage({ type: "error", text: tc("somethingWentWrong") });
    } finally {
      setSaving(false);
    }
  };

  const EyeButton = ({ show, onClick }: { show: boolean; onClick: () => void }) => (
    <button type="button" onClick={onClick} className="absolute right-3 top-1/2 -translate-y-1/2 text-discord-text-muted hover:text-discord-text transition">
      {show ? (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L6.59 6.59m7.532 7.532l3.29 3.29M3 3l18 18" /></svg>
      ) : (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
      )}
    </button>
  );

  const inputCls = "w-full p-3 bg-discord-bg-dark border border-discord-border rounded-lg text-discord-text text-sm focus:outline-none focus:border-discord-accent";

  return (
    <div className="max-w-4xl">
      <SectionTitle>{t("accountSettings")}</SectionTitle>
      <p className="text-sm text-discord-text-muted mb-8">{t("accountSettingsDesc")}</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* ── Change Password ── */}
        <div>
          <h3 className="text-sm font-bold text-discord-text flex items-center gap-2 mb-4">
            <svg className="w-4 h-4 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
            {t("changePassword")}
          </h3>
          <form onSubmit={handleChangePassword} className="bg-discord-bg-dark rounded-xl border border-discord-border p-5 space-y-4">
            {message && (
              <div className={`p-3 rounded-lg text-sm ${message.type === "success" ? "bg-discord-green/10 border border-discord-green/30 text-discord-green" : "bg-discord-red/10 border border-discord-red/30 text-discord-red"}`}>
                {message.text}
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-discord-text-muted mb-1.5">{t("currentPassword")}</label>
              <div className="relative">
                <input
                  type={showCurrent ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder={t("currentPassword")}
                  className={inputCls + " pr-10"}
                  required
                />
                <EyeButton show={showCurrent} onClick={() => setShowCurrent(!showCurrent)} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-discord-text-muted mb-1.5">{t("newPassword")}</label>
              <div className="relative">
                <input
                  type={showNew ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t("newPassword")}
                  className={inputCls + " pr-10"}
                  minLength={8}
                  required
                />
                <EyeButton show={showNew} onClick={() => setShowNew(!showNew)} />
              </div>
              <p className="text-xs text-discord-text-muted mt-1.5 flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${newPassword.length >= 8 ? "bg-discord-green" : "bg-discord-text-muted/40"}`} />
                {t("passwordRequirements")}
              </p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-discord-text-muted mb-1.5">{t("confirmNewPassword")}</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t("confirmNewPassword")}
                className={inputCls}
                minLength={8}
                required
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <ButtonSpinner loading={saving}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
                {t("updatePassword")}
              </ButtonSpinner>
            </button>
          </form>
        </div>

        {/* ── Email Address ── */}
        <div>
          <h3 className="text-sm font-bold text-discord-text flex items-center gap-2 mb-4">
            <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
            {t("emailAddress")}
          </h3>
          <div className="bg-discord-bg-dark rounded-xl border border-discord-border p-5 space-y-4">
            <div className="flex items-center justify-between bg-discord-bg rounded-lg px-4 py-3 border border-discord-border">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-discord-text-muted uppercase">{t("currentEmail")}</span>
                <span className="text-sm text-discord-text font-medium">{maskEmail(user.email)}</span>
              </div>
              {user.status === "verified" && (
                <span className="text-xs font-semibold bg-discord-green/20 text-discord-green px-2.5 py-0.5 rounded-full flex items-center gap-1">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                  {t("verified")}
                </span>
              )}
            </div>
          </div>

          {/* ── Phone Number ── */}
          <h3 className="text-sm font-bold text-discord-text flex items-center gap-2 mb-4 mt-8">
            <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
            {t("phoneNumber")}
          </h3>
          <div className="bg-discord-bg-dark rounded-xl border border-discord-border p-5">
            <div className="flex items-center justify-between bg-discord-bg rounded-lg px-4 py-3 border border-discord-border">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-discord-text-muted uppercase">{t("currentPhone")}</span>
                <span className="text-sm text-discord-text font-medium">
                  {user.email.endsWith("@phone.local")
                    ? maskPhone(user.email.replace("@phone.local", ""))
                    : t("noPhoneSet")}
                </span>
              </div>
              {user.email.endsWith("@phone.local") && (
                <span className="text-xs font-semibold bg-discord-green/20 text-discord-green px-2.5 py-0.5 rounded-full flex items-center gap-1">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                  {t("verified")}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Profile ───────────────────────────────────────────────────────────────────

function ProfileSection() {
  const { user, refreshUser } = useAuth();
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [bio, setBio] = useState(user?.bio || "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDisplayName(user?.displayName || "");
    setBio(user?.bio || "");
  }, [user?.displayName, user?.bio]);

  if (!user) return null;

  const initials = (user.displayName || user.username).slice(0, 2).toUpperCase();

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, bio }),
      });
      const data = await res.json();
      if (!res.ok) { setMessage({ type: "error", text: data.error }); return; }
      await refreshUser();
      setMessage({ type: "success", text: t("profileSaved") });
    } catch {
      setMessage({ type: "error", text: tc("somethingWentWrong") });
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setMessage(null);
    const formData = new FormData();
    formData.append("avatar", file);
    try {
      const res = await fetch("/api/settings/avatar", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) { setMessage({ type: "error", text: data.error }); return; }
      await refreshUser();
      setMessage({ type: "success", text: t("avatarUpdated") });
    } catch {
      setMessage({ type: "error", text: t("uploadFailed") });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemoveAvatar = async () => {
    try {
      const res = await fetch("/api/settings/avatar", { method: "DELETE" });
      if (res.ok) await refreshUser();
    } catch { }
  };

  return (
    <div>
      <SectionTitle>{t("profile")}</SectionTitle>
      <p className="text-sm text-discord-text-muted mb-8 -mt-2">
        {t("customizeProfile")}
      </p>

      <div className="flex gap-8">
        {/* Live preview */}
        <div className="w-52 shrink-0">
          <div className="text-xs font-bold uppercase tracking-widest text-discord-text-muted mb-3">{t("preview")}</div>
          <div className="bg-discord-bg-dark rounded-xl overflow-hidden shadow-lg border border-discord-bg-darker/40">
            <div className="h-14 bg-linear-to-r from-discord-accent/50 to-indigo-600/40" />
            <div className="px-4 pb-5">
              <div className="-mt-7 mb-3">
                {user.avatarUrl ? (
                  <img src={user.avatarUrl} alt="" className="w-16 h-16 rounded-full border-4 border-discord-bg-dark" />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-discord-accent border-4 border-discord-bg-dark flex items-center justify-center text-white font-bold text-lg">
                    {initials}
                  </div>
                )}
              </div>
              <div className="text-base font-bold text-discord-text leading-tight mb-1.5">
                {displayName || user.username}
              </div>
              <RoleBadge role={user.role} />
              {bio && (
                <p className="text-xs text-discord-text-muted mt-2.5 leading-relaxed line-clamp-4">{bio}</p>
              )}
            </div>
          </div>
        </div>

        {/* Edit form */}
        <form onSubmit={handleSave} className="flex-1 min-w-0 space-y-6">
          {/* Avatar */}
          <div>
            <label className="block text-sm font-semibold text-discord-text mb-3">{t("avatar")}</label>
            <div className="flex items-center gap-5">
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="w-16 h-16 rounded-full shrink-0 ring-2 ring-discord-accent/30" />
              ) : (
                <div className="w-16 h-16 rounded-full bg-discord-accent flex items-center justify-center text-white text-xl font-bold shrink-0">
                  {initials}
                </div>
              )}
              <div>
                <div className="flex gap-2 mb-2">
                  <input ref={fileInputRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleAvatarUpload} />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="px-4 py-2 bg-discord-accent hover:bg-discord-accent-hover text-white text-sm font-semibold rounded-md transition-colors disabled:opacity-50 flex items-center gap-1"
                  >
                    <ButtonSpinner loading={uploading}>{tc("uploadNew")}</ButtonSpinner>
                  </button>
                  {user.avatarUrl && (
                    <button
                      type="button"
                      onClick={handleRemoveAvatar}
                      className="px-4 py-2 bg-discord-bg-hover hover:bg-discord-bg text-discord-text-secondary text-sm font-semibold rounded-md transition-colors border border-discord-border"
                    >
                      {tc("remove")}
                    </button>
                  )}
                </div>
                <p className="text-xs text-discord-text-muted">{t("avatarHint")}</p>
              </div>
            </div>
          </div>

          {/* Display Name */}
          <div>
            <label className="block text-sm font-semibold text-discord-text mb-2">{t("displayName")}</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={user.username}
              maxLength={20}
              className="w-full px-4 py-2.5 bg-discord-bg-dark rounded-md text-sm text-discord-text placeholder-discord-text-muted focus:outline-none focus:ring-2 focus:ring-discord-accent border border-discord-bg-darker/60 focus:border-discord-accent"
            />
            <p className="mt-1.5 text-xs text-discord-text-muted">{t("displayNameHint")}</p>
          </div>

          {/* Bio */}
          <div>
            <label className="block text-sm font-semibold text-discord-text mb-2">{t("bio")}</label>
            <div className="relative">
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={4}
                maxLength={300}
                placeholder={t("bioPlaceholder")}
                className="w-full px-4 py-2.5 bg-discord-bg-dark rounded-md text-sm text-discord-text placeholder-discord-text-muted focus:outline-none focus:ring-2 focus:ring-discord-accent resize-none border border-discord-bg-darker/60 focus:border-discord-accent"
              />
              <span className="absolute bottom-3 right-3 text-xs text-discord-text-muted select-none">{bio.length}/300</span>
            </div>
            <div className="mt-3 p-4 bg-discord-bg-dark rounded-md border border-discord-bg-darker/60">
              <div className="text-xs font-semibold text-discord-accent mb-2">{t("bioRulesTitle")}</div>
              <div className="text-xs text-discord-text-muted space-y-1.5">
                <div className="text-discord-text-secondary">{t("bioRulesIntro")}</div>
                <div className="text-discord-red">✗ {t("bioRuleAds")}</div>
                <div className="text-discord-red">✗ {t("bioRuleNsfw")}</div>
                <div className="text-discord-red">✗ {t("bioRuleSpam")}</div>
                <div className="text-discord-red">✗ {t("bioRuleHate")}</div>
                <div className="text-discord-green">✓ {t("bioRuleSocial")}</div>
              </div>
            </div>
          </div>

          {/* Save */}
          <div className="flex items-center gap-4 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2.5 bg-discord-accent hover:bg-discord-accent-hover text-white font-semibold text-sm rounded-md transition-colors disabled:opacity-50 shadow-sm flex items-center gap-1"
            >
              <ButtonSpinner loading={saving}>{tc("save")}</ButtonSpinner>
            </button>
            {message && (
              <span className={`text-sm font-medium ${message.type === "success" ? "text-discord-green" : "text-discord-red"}`}>
                {message.text}
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Admin: Overview ───────────────────────────────────────────────────────────

function AdminOverviewSection() {
  const ta = useTranslations("admin");
  const tc = useTranslations("common");
  const [stats, setStats] = useState<{ totalUsers: number; activeInvites: number; totalTags: number; totalChannels: number } | null>(null);

  useEffect(() => {
    fetch("/api/admin/stats").then((r) => r.json()).then(setStats).catch(() => { });
  }, []);

  const cards = stats
    ? [
      { label: ta("totalUsers"), value: stats.totalUsers, color: "text-blue-400", bg: "from-blue-500/10 to-blue-500/5", border: "border-blue-500/20" },
      { label: ta("activeInvites"), value: stats.activeInvites, color: "text-discord-green", bg: "from-green-500/10 to-green-500/5", border: "border-green-500/20" },
      { label: ta("tagsLabel"), value: stats.totalTags, color: "text-indigo-400", bg: "from-indigo-500/10 to-indigo-500/5", border: "border-indigo-500/20" },
      { label: ta("channels"), value: stats.totalChannels, color: "text-yellow-400", bg: "from-yellow-500/10 to-yellow-500/5", border: "border-yellow-500/20" },
    ]
    : [];

  return (
    <div className="max-w-2xl">
      <SectionTitle>{ta("overview")}</SectionTitle>
      {!stats ? (
        <div className="text-discord-text-muted text-sm">{tc("loadingStats")}</div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {cards.map((c) => (
            <div key={c.label} className={`bg-linear-to-br ${c.bg} border ${c.border} rounded-xl p-6`}>
              <div className="text-sm text-discord-text-muted mb-3 font-medium">{c.label}</div>
              <div className={`text-5xl font-bold ${c.color}`}>{c.value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Admin: Users ──────────────────────────────────────────────────────────────

interface AdminUser {
  id: string; email: string; username: string; displayName: string | null;
  role: string; status: string; currency: string | null; onboardingCompleted: boolean;
  createdAt: string; tags: { id: string; name: string; color: string }[];
}
interface Tag { id: string; name: string; color: string; nameCn?: string | null; description?: string | null; }


function AdminUsersSection() {
  const ta = useTranslations("admin");
  const tc = useTranslations("common");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [banTarget, setBanTarget] = useState<string | null>(null);
  const [banReason, setBanReason] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null); // userId of in-flight action
  const [search, setSearch] = useState("");

  const fetchData = async () => {
    const [ur, tr] = await Promise.all([fetch("/api/admin/users"), fetch("/api/admin/tags")]);
    const ud = await ur.json(); const td = await tr.json();
    setUsers(ud.users || []); setAllTags(td.tags || []);
    setLoading(false);
  };
  useEffect(() => {
    let active = true;
    Promise.all([fetch("/api/admin/users"), fetch("/api/admin/tags")])
      .then(async ([ur, tr]) => {
        const ud = await ur.json(); const td = await tr.json();
        if (active) { setUsers(ud.users || []); setAllTags(td.tags || []); setLoading(false); }
      });
    return () => { active = false; };
  }, []);

  const patch = async (userId: string, body: object) => {
    setActionLoading(userId);
    await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    await fetchData();
    setActionLoading(null);
  };

  const handleTagAction = async (userId: string, method: "POST" | "DELETE", tagId: string) => {
    setActionLoading(userId);
    await fetch("/api/admin/users/tags", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, tagId }) });
    await fetchData();
    setActionLoading(null);
  };

  const handleBanConfirm = async () => {
    if (!banTarget) return;
    await patch(banTarget, { userId: banTarget, action: "ban", banReason });
    setBanTarget(null); setBanReason("");
  };

  const filteredUsers = users.filter((u) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      u.email.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      (u.displayName?.toLowerCase().includes(q) ?? false) ||
      u.id.toLowerCase().includes(q)
    );
  });

  if (loading) return <div className="text-discord-text-muted text-sm">{tc("loadingUsers")}</div>;

  return (
    <div>
      <SectionTitle>
        {ta("userManagement")}{" "}
        <span className="text-discord-text-muted text-xl font-normal">({filteredUsers.length}/{users.length})</span>
      </SectionTitle>

      {/* Search */}
      <div className="relative mb-5">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-discord-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={ta("searchPlaceholder")}
          className="w-full pl-9 pr-4 py-2.5 bg-discord-bg-dark rounded-lg text-sm text-discord-text placeholder-discord-text-muted focus:outline-none focus:ring-2 focus:ring-discord-accent border border-discord-bg-darker/60 focus:border-discord-accent"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-discord-text-muted hover:text-discord-text"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Ban reason dialog */}
      {banTarget && (
        <div className="fixed inset-0 z-60 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.7)" }}>
          <div className="bg-discord-bg-dark rounded-xl p-6 w-96 shadow-2xl border border-discord-bg-darker">
            <h3 className="text-lg font-bold text-discord-text mb-1">{ta("banUser")}</h3>
            <p className="text-sm text-discord-text-muted mb-4">{ta("banReasonDesc")}</p>
            <textarea
              value={banReason}
              onChange={(e) => setBanReason(e.target.value)}
              rows={3}
              placeholder={ta("banReason")}
              className="w-full px-3 py-2.5 bg-discord-bg rounded-md text-sm text-discord-text placeholder-discord-text-muted focus:outline-none focus:ring-2 focus:ring-discord-accent resize-none border border-discord-bg-darker mb-4"
            />
            <div className="flex gap-3 justify-end">
              <button onClick={() => { setBanTarget(null); setBanReason(""); }} className="px-4 py-2 text-sm font-medium text-discord-text-muted hover:text-discord-text transition-colors">
                {tc("cancel")}
              </button>
              <button
                onClick={handleBanConfirm}
                disabled={!!actionLoading}
                className="flex items-center gap-2 px-4 py-2 bg-discord-red hover:bg-red-600 text-white text-sm font-semibold rounded-md transition-colors disabled:opacity-60"
              >
                {actionLoading ? <Spinner /> : null}
                {ta("banUser")}
              </button>
            </div>
          </div>
        </div>
      )}

      {filteredUsers.length === 0 && (
        <p className="text-sm text-discord-text-muted text-center py-8">{ta("noUsersMatch")}</p>
      )}

      <div className="space-y-2">
        {filteredUsers.map((u) => {
          const userTagIds = new Set(u.tags.map((t) => t.id));
          const available = allTags.filter((t) => !userTagIds.has(t.id));
          const isOpen = expandedId === u.id;
          const isLoading = actionLoading === u.id;
          const initials = (u.displayName || u.username).slice(0, 2).toUpperCase();

          const ROLE_AVATAR: Record<string, string> = {
            admin: "bg-red-500",
            supermod: "bg-indigo-500",
            mod: "bg-green-500",
            supercreator: "bg-purple-500",
            creator: "bg-discord-accent",
          };

          return (
            <div
              key={u.id}
              className={`bg-discord-bg-dark rounded-xl border transition-all ${isOpen ? "border-discord-accent/40" : "border-discord-bg-darker/40 hover:border-discord-bg-darker"}`}
            >
              <div className="flex items-center gap-4 px-5 py-4">
                {/* Avatar */}
                <div className={`w-11 h-11 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0 ${ROLE_AVATAR[u.role] ?? "bg-discord-accent"}`}>
                  {isLoading ? <Spinner /> : initials}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <span className="font-semibold text-discord-text">{u.displayName || u.username}</span>
                    <span className="text-sm text-discord-text-muted">@{u.username}</span>
                    <RoleBadge role={u.role} />
                    {u.status === "banned" && <span className="text-xs px-2 py-0.5 rounded font-medium bg-red-500/50 text-red-300">{ta("banned")}</span>}
                    {u.status === "pending_verification" && <span className="text-xs px-2 py-0.5 rounded font-medium bg-yellow-500/50 text-yellow-300">{ta("pending")}</span>}
                  </div>
                  <div className="text-xs text-discord-text-muted flex items-center gap-3 flex-wrap">
                    <span>{u.email}</span>
                    {u.currency && <span>{ta("currencyLabel", { currency: u.currency.toUpperCase() })}</span>}
                    <span>{ta("joined", { date: new Date(u.createdAt).toLocaleDateString() })}</span>
                  </div>
                  {u.tags.length > 0 && (
                    <div className="flex gap-1.5 mt-2 flex-wrap">
                      {u.tags.map((tag) => (
                        <span
                          key={tag.id}
                          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ backgroundColor: `${tag.color}80`, color: tag.color }}
                        >
                          {tag.name}
                          {isOpen && (
                            <button
                              onClick={() => handleTagAction(u.id, "DELETE", tag.id)}
                              disabled={isLoading}
                              className="ml-0.5 opacity-60 hover:opacity-100 leading-none font-bold disabled:cursor-not-allowed"
                              title={ta("removeTag")}
                            >×</button>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Toggle */}
                <button
                  onClick={() => setExpandedId(isOpen ? null : u.id)}
                  disabled={isLoading}
                  className={`text-sm px-4 py-1.5 rounded-md font-semibold transition-all shrink-0 ${isOpen ? "bg-discord-accent text-white shadow hover:bg-indigo-500" : "bg-discord-bg-hover text-discord-text-muted hover:text-discord-text border border-discord-border hover:border-discord-text-muted"} disabled:opacity-50`}
                >
                  {isOpen ? ta("done") : ta("actions")}
                </button>
              </div>

              {/* Expanded actions */}
              {isOpen && (
                <div className="px-5 pb-5 border-t border-discord-bg-darker/60 pt-4 space-y-4">
                  <div className="flex flex-wrap items-end gap-4">
                    {/* Role */}
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-discord-text-muted mb-2">{ta("changeRole")}</label>
                      <div className="flex gap-2 flex-wrap">
                        {(["creator", "supercreator", "mod", "supermod", "admin"] as const).map((role) => (
                          <button
                            key={role}
                            onClick={() => patch(u.id, { userId: u.id, action: "changeRole", role })}
                            disabled={isLoading || u.role === role}
                            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed ${u.role === role
                              ? role === "admin" ? "bg-red-500/50 text-red-200"
                                : role === "supermod" ? "bg-indigo-500/50 text-indigo-200"
                                  : role === "mod" ? "bg-green-500/50 text-green-200"
                                    : role === "supercreator" ? "bg-purple-500/50 text-purple-200"
                                    : "bg-blue-500/50 text-blue-200"
                              : "bg-discord-bg hover:bg-discord-bg-hover text-discord-text-muted hover:text-discord-text border border-discord-border"
                              }`}
                          >
                            {isLoading && u.role !== role ? <span className="flex items-center gap-1"><Spinner />{role}</span> : role}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Add Tag */}
                    {available.length > 0 && (
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider text-discord-text-muted mb-2">{ta("addTag")}</label>
                        <select
                          defaultValue=""
                          disabled={isLoading}
                          onChange={(e) => {
                            if (!e.target.value) return;
                            handleTagAction(u.id, "POST", e.target.value);
                            e.target.value = "";
                          }}
                          className="text-sm px-3 py-2 bg-discord-bg rounded-md border border-discord-border text-discord-text focus:outline-none focus:ring-2 focus:ring-discord-accent disabled:opacity-50"
                        >
                          <option value="" disabled>{ta("selectTagToAdd")}</option>
                          {available.map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Ban / Unban */}
                  <div className="flex items-center justify-between pt-1 border-t border-discord-bg-darker/40">
                    <div className="text-xs text-discord-text-muted">
                      ID: <code className="font-mono text-discord-text-secondary">{u.id.slice(0, 12)}…</code>
                    </div>
                    {u.status === "banned" ? (
                      <button
                        onClick={() => patch(u.id, { userId: u.id, action: "unban" })}
                        disabled={isLoading}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md bg-discord-green text-white hover:bg-green-500 shadow transition-all disabled:opacity-60"
                      >
                        {isLoading && <Spinner />}
                        {ta("unban")}
                      </button>
                    ) : (
                      <button
                        onClick={() => setBanTarget(u.id)}
                        disabled={isLoading}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md bg-discord-red text-white hover:bg-red-600 shadow transition-all disabled:opacity-60"
                      >
                        {isLoading && <Spinner />}
                        {ta("banUser")}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Admin: Invite Codes ───────────────────────────────────────────────────────

interface InviteCode {
  id: string; code: string; status: string; maxUses: number; useCount: number;
  expiresAt: string | null; createdAt: string; createdByUsername: string;
}

function AdminInvitesSection() {
  const ta = useTranslations("admin");
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [maxUses, setMaxUses] = useState(1);
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [creating, setCreating] = useState(false);

  const fetchCodes = async () => {
    const res = await fetch("/api/admin/invite-codes");
    const data = await res.json();
    setCodes(data.codes || []);
    setLoading(false);
  };
  useEffect(() => {
    let active = true;
    fetch("/api/admin/invite-codes")
      .then(r => r.json())
      .then(data => { if (active) { setCodes(data.codes || []); setLoading(false); } });
    return () => { active = false; };
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    await fetch("/api/admin/invite-codes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ maxUses, expiresInDays }) });
    await fetchCodes();
    setCreating(false);
  };

  const handleRevoke = async (codeId: string) => {
    await fetch("/api/admin/invite-codes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ codeId, action: "revoke" }) });
    fetchCodes();
  };

  if (loading) return <div className="text-discord-text-muted text-sm">{ta("loadingInviteCodes")}</div>;

  return (
    <div className="max-w-2xl">
      <SectionTitle>{ta("inviteCodes")}</SectionTitle>

      {/* Create form */}
      <div className="bg-discord-bg-dark rounded-xl p-5 mb-6 border border-discord-bg-darker/60">
        <h3 className="text-sm font-semibold text-discord-text mb-4">{ta("generateNewCode")}</h3>
        <div className="flex items-end gap-4 flex-wrap">
          <div>
            <label className="block text-xs font-medium text-discord-text-muted mb-1.5">{ta("maxUses")}</label>
            <input
              type="number" min={1} max={100} value={maxUses}
              onChange={(e) => setMaxUses(parseInt(e.target.value) || 1)}
              className="w-28 px-3 py-2 bg-discord-bg rounded-md text-sm text-discord-text focus:outline-none focus:ring-2 focus:ring-discord-accent border border-discord-bg-darker"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-discord-text-muted mb-1.5">{ta("expiresInDays")}</label>
            <input
              type="number" min={1} max={365} value={expiresInDays}
              onChange={(e) => setExpiresInDays(parseInt(e.target.value) || 30)}
              className="w-28 px-3 py-2 bg-discord-bg rounded-md text-sm text-discord-text focus:outline-none focus:ring-2 focus:ring-discord-accent border border-discord-bg-darker"
            />
          </div>
          <button
            onClick={handleCreate} disabled={creating}
            className="px-5 py-2 bg-discord-accent hover:bg-discord-accent-hover text-white text-sm font-semibold rounded-md transition-colors disabled:opacity-50 flex items-center gap-1"
          >
            <ButtonSpinner loading={creating}>{ta("generate")}</ButtonSpinner>
          </button>
        </div>
      </div>

      {/* Code list */}
      <div className="space-y-2">
        {codes.length === 0 && <p className="text-sm text-discord-text-muted">{ta("noInviteCodesYet")}</p>}
        {codes.map((c) => (
          <div key={c.id} className={`bg-discord-bg-dark rounded-xl px-5 py-4 flex items-center gap-4 border border-discord-bg-darker/40 ${c.status !== "active" ? "opacity-50" : ""}`}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1.5">
                <code className="text-base font-mono font-bold text-discord-accent tracking-widest">{c.code}</code>
                <button
                  onClick={() => navigator.clipboard?.writeText(c.code)}
                  className="text-discord-text-muted hover:text-discord-text transition-colors"
                  title={ta("copyCode")}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${c.status === "active" ? "bg-green-500/20 text-green-400" : c.status === "revoked" ? "bg-red-500/20 text-red-400" : "bg-gray-500/20 text-gray-400"}`}>
                  {c.status}
                </span>
              </div>
              <div className="text-xs text-discord-text-muted flex items-center gap-3">
                <span>{ta("uses", { used: c.useCount, max: c.maxUses })}</span>
                <span>·</span>
                <span>{ta("by", { name: c.createdByUsername })}</span>
                <span>·</span>
                <span>{c.expiresAt ? ta("expires", { date: new Date(c.expiresAt).toLocaleDateString() }) : ta("noExpiry")}</span>
              </div>
            </div>
            {c.status === "active" && (
              <button
                onClick={() => handleRevoke(c.id)}
                className="text-sm px-4 py-1.5 rounded-md font-medium bg-discord-red/20 text-discord-red hover:bg-discord-red/30 transition-colors shrink-0"
              >
                {ta("revoke")}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Admin: Tags ───────────────────────────────────────────────────────────────

function AdminTagsSection() {
  const ta = useTranslations("admin");
  const tc = useTranslations("common");
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [nameCn, setNameCn] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#5865f2");
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const fetchTags = async () => {
    const res = await fetch("/api/admin/tags");
    const data = await res.json();
    setTags(data.tags || []);
    setLoading(false);
  };
  useEffect(() => {
    let active = true;
    fetch("/api/admin/tags")
      .then(r => r.json())
      .then(data => { if (active) { setTags(data.tags || []); setLoading(false); } });
    return () => { active = false; };
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError("");
    const res = await fetch("/api/admin/tags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, nameCn, description, color }) });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || ta("failedCreateTag"));
      setCreating(false);
      return;
    }
    setName(""); setNameCn(""); setDescription(""); setColor("#5865f2");
    await fetchTags();
    setCreating(false);
  };

  const handleDelete = async (tag: Tag) => {
    if (!confirm(ta("deleteTagConfirm", { name: tag.name }))) return;
    setDeletingId(tag.id);
    setError("");
    const res = await fetch("/api/admin/tags", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: tag.id }) });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || ta("failedDeleteTag"));
      setDeletingId(null);
      return;
    }
    await fetchTags();
    setDeletingId(null);
  };

  if (loading) return <div className="text-discord-text-muted text-sm">{ta("loadingTags")}</div>;

  return (
    <div className="max-w-2xl">
      <SectionTitle>
        {ta("tagManagement")}{" "}
        <span className="text-discord-text-muted text-xl font-normal">({tags.length})</span>
      </SectionTitle>

      {/* Create form */}
      <form onSubmit={handleCreate} className="bg-discord-bg-dark rounded-xl p-5 mb-6 border border-discord-bg-darker/60">
        <h3 className="text-sm font-semibold text-discord-text mb-4">{ta("createNewTag")}</h3>
        {error && <div className="text-red-400 text-sm mb-3">{error}</div>}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <label className="text-xs font-medium text-discord-text-muted">{ta("nameEn")}</label>
              <TranslateButton sourceText={nameCn} from="zh" onTranslated={setName} context="tag name — keep it short" />
            </div>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required className="w-full px-3 py-2 bg-discord-bg rounded-md text-sm text-discord-text focus:outline-none focus:ring-2 focus:ring-discord-accent border border-discord-bg-darker" />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <label className="text-xs font-medium text-discord-text-muted">{ta("nameCn")}</label>
              <TranslateButton sourceText={name} from="en" onTranslated={setNameCn} context="tag name — keep it short" />
            </div>
            <input type="text" value={nameCn} onChange={(e) => setNameCn(e.target.value)} className="w-full px-3 py-2 bg-discord-bg rounded-md text-sm text-discord-text focus:outline-none focus:ring-2 focus:ring-discord-accent border border-discord-bg-darker" />
          </div>
        </div>
        <div className="flex gap-3 mb-4">
          <div className="flex-1">
            <label className="block text-xs font-medium text-discord-text-muted mb-1.5">{ta("description")}</label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} className="w-full px-3 py-2 bg-discord-bg rounded-md text-sm text-discord-text focus:outline-none focus:ring-2 focus:ring-discord-accent border border-discord-bg-darker" />
          </div>
          <div>
            <label className="block text-xs font-medium text-discord-text-muted mb-1.5">{ta("color")}</label>
            <div className="flex items-center gap-2">
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-10 h-9 rounded cursor-pointer border-0 bg-transparent p-0" />
              <code className="text-xs font-mono text-discord-text-muted">{color}</code>
            </div>
          </div>
        </div>
        <button
          type="submit"
          disabled={creating || !name.trim()}
          className="px-5 py-2 bg-discord-accent hover:bg-discord-accent-hover text-white text-sm font-semibold rounded-md transition-colors disabled:opacity-50 flex items-center gap-1"
        >
          <ButtonSpinner loading={creating}>{ta("createTag")}</ButtonSpinner>
        </button>
      </form>

      {/* Tag list */}
      <div className="space-y-2">
        {tags.length === 0 && <p className="text-sm text-discord-text-muted">{ta("noTagsYet")}</p>}
        {tags.map((tag) => (
          <div key={tag.id} className="bg-discord-bg-dark rounded-xl px-5 py-4 flex items-center gap-4 border border-discord-bg-darker/40">
            <div className="w-5 h-5 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: tag.color }} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-semibold text-discord-text">{tag.name}</span>
                {tag.nameCn && <span className="text-sm text-discord-text-muted">({tag.nameCn})</span>}
                <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: `${tag.color}25`, color: tag.color }}>{tag.name}</span>
              </div>
              {tag.description && <p className="text-xs text-discord-text-muted">{tag.description}</p>}
            </div>
            <code className="text-xs text-discord-text-muted font-mono shrink-0">{tag.id.slice(0, 8)}…</code>
            <button
              onClick={() => handleDelete(tag)}
              disabled={deletingId === tag.id}
              className="ml-2 px-2.5 py-1 text-xs font-medium text-red-400 hover:text-white hover:bg-red-500/80 rounded-md transition-colors disabled:opacity-50 flex items-center gap-1 shrink-0"
            >
              {deletingId === tag.id ? <Spinner /> : tc("delete")}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Admin: Tasks ─────────────────────────────────────────────────────────────

interface TaskChannel {
  id: string;
  name: string;
  slug: string;
  type: string;
}

interface AdminTask {
  id: string;
  title: string;
  titleCn: string | null;
  status: string;
  bountyUsd: string | null;
  bountyRmb: string | null;
  maxAttempts: number;
  deadline: string | null;
  channelName: string;
  channelSlug: string;
  createdByUsername: string;
  attemptCount: number;
  createdAt: string;
}

interface TaskTemplate {
  id: string;
  name: string;
  nameCn: string | null;
  category: string;
  description: string | null;
  descriptionCn: string | null;
  bountyUsd: string | null;
  bountyRmb: string | null;
  bonusBountyUsd: string | null;
  bonusBountyRmb: string | null;
  maxAttempts: number;
  checklist: { label: string }[] | null;
  selfChecklist: { label: string }[] | null;
  deliverableSlots: DeliverableSlot[] | null;
  attachments: { name: string; url: string; type: string; size: number }[] | null;
  createdByUsername: string;
  createdAt: string;
}

// Module-level variable to pass template data between sibling sections without sessionStorage timing issues
let pendingApplyTemplate: {
  name: string; nameCn: string | null;
  description: string | null; descriptionCn: string | null;
  bountyUsd: string | null; bountyRmb: string | null;
  bonusBountyUsd: string | null; bonusBountyRmb: string | null;
  maxAttempts: number; checklist: { label: string }[] | null;
  selfChecklist: { label: string }[] | null; deliverableSlots: DeliverableSlot[] | null;
  attachments: { name: string; url: string; type: string; size: number }[] | null;
} | null = null;

const TEMPLATE_ICONS: Record<string, { icon: string; color: string; bg: string }> = {
  audio: { icon: "🎙️", color: "text-blue-400", bg: "from-blue-500/10 to-blue-500/20" },
  video: { icon: "🎬", color: "text-purple-400", bg: "from-purple-500/10 to-purple-500/20" },
  image: { icon: "📷", color: "text-green-400", bg: "from-green-500/10 to-green-500/20" },
  translation: { icon: "🌐", color: "text-amber-400", bg: "from-amber-500/10 to-amber-500/20" },
  text: { icon: "📄", color: "text-sky-400", bg: "from-sky-500/10 to-sky-500/20" },
  other: { icon: "📦", color: "text-gray-400", bg: "from-gray-500/10 to-gray-500/20" },
};

const TASK_STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-500/20 text-gray-400",
  active: "bg-green-500/20 text-green-400",
  locked: "bg-amber-500/20 text-amber-300",
  approved: "bg-blue-500/20 text-blue-400",
  paid: "bg-discord-text-muted/20 text-discord-text-muted",
  archived: "bg-gray-500/20 text-gray-500",
};

function AdminTasksSection() {
  const ta = useTranslations("admin");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { user } = useAuth();
  const [channels, setChannels] = useState<TaskChannel[]>([]);
  const [tasks, setTasks] = useState<AdminTask[]>([]);
  const [loading, setLoading] = useState(true);

  // Create-task picker state: "closed" | "picker" (showing blank+templates) | "form" (task form open)
  const [createMode, setCreateMode] = useState<"closed" | "picker" | "form">("closed");
  // Form state
  const [channelId, setChannelId] = useState("");
  const [title, setTitle] = useState("");
  const [titleCn, setTitleCn] = useState("");
  const [description, setDescription] = useState("");
  const [descriptionCn, setDescriptionCn] = useState("");
  const [bountyUsd, setBountyUsd] = useState("");
  const [bountyRmb, setBountyRmb] = useState("");
  const [bonusBountyUsd, setBonusBountyUsd] = useState("");
  const [bonusBountyRmb, setBonusBountyRmb] = useState("");
  const [maxAttempts, setMaxAttempts] = useState("5");
  const [deadline, setDeadline] = useState("");
  const [publishNow, setPublishNow] = useState(false);
  const [formError, setFormError] = useState("");
  const [creating, setCreating] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskStatus, setEditingTaskStatus] = useState<string | null>(null);
  const [editLoading, setEditLoading] = useState<string | null>(null);
  // Checklist state (review — mod-facing)
  const [checklistItems, setChecklistItems] = useState<string[]>([]);
  const [newChecklistItem, setNewChecklistItem] = useState("");
  // Self-checklist state (creator guidance)
  const [selfChecklistItems, setSelfChecklistItems] = useState<string[]>([]);
  const [newSelfChecklistItem, setNewSelfChecklistItem] = useState("");
  // Attachments state
  const [taskAttachments, setTaskAttachments] = useState<import("@/components/ui/FileUpload").UploadedFile[]>([]);
  // Deliverable slots state
  const [deliverableSlots, setDeliverableSlots] = useState<DeliverableSlot[]>([]);
  // Markdown preview toggle
  const [previewDescEn, setPreviewDescEn] = useState(false);
  const [previewDescCn, setPreviewDescCn] = useState(false);
  // Save-as-template state
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateNameCn, setTemplateNameCn] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateSaveMsg, setTemplateSaveMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // ─── Template management state ───────────────────────────────────────────────
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  const [cloningTemplateId, setCloningTemplateId] = useState<string | null>(null);
  const [confirmDeleteTemplateId, setConfirmDeleteTemplateId] = useState<string | null>(null);

  const emptyTemplateForm = {
    name: "", nameCn: "", description: "", descriptionCn: "",
    bountyUsd: "", bountyRmb: "", bonusBountyUsd: "", bonusBountyRmb: "",
    maxAttempts: "5", checklistItems: [] as string[], newChecklistItem: "",
    selfChecklistItems: [] as string[], newSelfChecklistItem: "",
    deliverableSlots: [] as DeliverableSlot[],
    attachments: [] as import("@/components/ui/FileUpload").UploadedFile[],
  };
  const [templateForm, setTemplateForm] = useState(emptyTemplateForm);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateFormError, setTemplateFormError] = useState("");

  // Auto-detect category from deliverable slot types
  const detectCategoryFromSlots = (slots: DeliverableSlot[]): string => {
    const types = slots.map((s) => s.type);
    if (types.some((t) => t === "upload-audio")) return "audio";
    if (types.some((t) => t === "upload-video")) return "video";
    if (types.some((t) => t === "upload-image")) return "image";
    if (types.some((t) => t === "upload-text" || t === "upload-tsv" || t === "upload-srt" || t === "textbox")) return "text";
    return "other";
  };

  const fetchTemplates = async () => {
    setTemplatesLoading(true);
    try {
      const res = await fetch("/api/templates");
      const data = await res.json();
      let finalTemplates = data.templates || [];
      if (finalTemplates.length === 0) {
        const seedRes = await fetch("/api/templates/seed", { method: "POST" });
        if (seedRes.ok) {
          const seedData = await seedRes.json();
          if (seedData.seeded) {
            const res2 = await fetch("/api/templates");
            const data2 = await res2.json();
            finalTemplates = data2.templates || [];
          }
        }
      }
      setTemplates(finalTemplates);
    } catch { /* ignore */ }
    setTemplatesLoading(false);
  };

  const fetchData = () => {
    Promise.all([
      fetch("/api/channels").then((r) => r.json()),
      fetch("/api/admin/tasks").then((r) => r.json()),
    ])
      .then(([chData, taskData]) => {
        const taskChannels = (chData.channels || []).filter((c: TaskChannel) => c.type === "task");
        if (taskData.modChannelIds) {
          const assignedChannelIds = new Set(taskData.modChannelIds);
          setChannels(taskChannels.filter((c: TaskChannel) => assignedChannelIds.has(c.id)));
        } else {
          setChannels(taskChannels);
        }
        setTasks(taskData.tasks || []);
      })
      .catch(() => { })
      .finally(() => setLoading(false));
  };

  const resetTaskForm = () => {
    setChannelId(""); setTitle(""); setTitleCn(""); setDescription(""); setDescriptionCn("");
    setBountyUsd(""); setBountyRmb(""); setBonusBountyUsd(""); setBonusBountyRmb("");
    setMaxAttempts("5"); setDeadline(""); setPublishNow(false); setFormError("");
    setChecklistItems([]); setNewChecklistItem(""); setSelfChecklistItems([]); setNewSelfChecklistItem("");
    setTaskAttachments([]); setDeliverableSlots([]); setEditingTaskId(null); setEditingTaskStatus(null);
    setPreviewDescEn(false); setPreviewDescCn(false);
    setShowSaveTemplate(false); setTemplateName(""); setTemplateNameCn("");
  };

  const handleEdit = async (taskId: string) => {
    setEditLoading(taskId);
    try {
      const res = await fetch(`/api/tasks/${taskId}`);
      if (!res.ok) return;
      const { task } = await res.json();
      setEditingTaskId(taskId);
      setEditingTaskStatus(task.status || "draft");
      setChannelId(task.channelId || "");
      setTitle(task.title || "");
      setTitleCn(task.titleCn || "");
      setDescription(task.description || "");
      setDescriptionCn(task.descriptionCn || "");
      setBountyUsd(task.bountyUsd || "");
      setBountyRmb(task.bountyRmb || "");
      setBonusBountyUsd(task.bonusBountyUsd || "");
      setBonusBountyRmb(task.bonusBountyRmb || "");
      setMaxAttempts(String(task.maxAttempts || 5));
      setDeadline(task.deadline ? new Date(task.deadline).toISOString().slice(0, 16) : "");
      setPublishNow(false);
      setChecklistItems((task.checklist || []).map((c: { label: string }) => c.label));
      setSelfChecklistItems((task.selfChecklist || []).map((c: { label: string }) => c.label));
      setTaskAttachments(task.attachments || []);
      setDeliverableSlots(task.deliverableSlots || []);
      setCreateMode("form");
    } catch { /* ignore */ }
    setEditLoading(null);
  };

  const applyTemplate = (t: TaskTemplate) => {
    resetTaskForm();
    setTitle(t.name || "");
    setTitleCn(t.nameCn || "");
    setDescription(t.description || "");
    setDescriptionCn(t.descriptionCn || "");
    setBountyUsd(t.bountyUsd || "");
    setBountyRmb(t.bountyRmb || "");
    setBonusBountyUsd(t.bonusBountyUsd || "");
    setBonusBountyRmb(t.bonusBountyRmb || "");
    setMaxAttempts(String(t.maxAttempts || 5));
    setChecklistItems((t.checklist || []).map((c: { label: string }) => c.label));
    setSelfChecklistItems((t.selfChecklist || []).map((c: { label: string }) => c.label));
    setDeliverableSlots(t.deliverableSlots || []);
    setTaskAttachments((t.attachments || []).map(a => ({ name: a.name, url: a.url, type: a.type, size: a.size })));
    setCreateMode("form");
  };

  // ─── Template CRUD ───────────────────────────────────────────────────────────
  const startEditTemplate = (t: TaskTemplate) => {
    setEditingTemplateId(t.id);
    setShowTemplateForm(true);
    setTemplateForm({
      name: t.name, nameCn: t.nameCn || "",
      description: t.description || "", descriptionCn: t.descriptionCn || "",
      bountyUsd: t.bountyUsd || "", bountyRmb: t.bountyRmb || "",
      bonusBountyUsd: t.bonusBountyUsd || "", bonusBountyRmb: t.bonusBountyRmb || "",
      maxAttempts: String(t.maxAttempts), checklistItems: (t.checklist || []).map(c => c.label),
      newChecklistItem: "",
      selfChecklistItems: (t.selfChecklist || []).map((c: { label: string }) => c.label),
      newSelfChecklistItem: "",
      deliverableSlots: t.deliverableSlots || [],
      attachments: (t.attachments || []).map(a => ({ name: a.name, url: a.url, type: a.type, size: a.size })),
    });
    setTemplateFormError("");
  };

  const startCreateTemplate = () => {
    setShowTemplateForm(true);
    setEditingTemplateId(null);
    setTemplateForm(emptyTemplateForm);
    setTemplateFormError("");
  };

  const saveTemplate = async () => {
    const isCreate = !editingTemplateId;
    if (isCreate && !templateForm.name) {
      setTemplateFormError(ta("nameRequired"));
      return;
    }
    setTemplateSaving(true);
    setTemplateFormError("");

    const payload = {
      name: templateForm.name, nameCn: templateForm.nameCn || null,
      category: detectCategoryFromSlots(templateForm.deliverableSlots),
      description: templateForm.description || null,
      descriptionCn: templateForm.descriptionCn || null,
      bountyUsd: templateForm.bountyUsd || null,
      bountyRmb: templateForm.bountyRmb || null,
      bonusBountyUsd: templateForm.bonusBountyUsd || null,
      bonusBountyRmb: templateForm.bonusBountyRmb || null,
      maxAttempts: parseInt(templateForm.maxAttempts) || 5,
      checklist: templateForm.checklistItems.length > 0 ? templateForm.checklistItems.map(l => ({ label: l })) : null,
      selfChecklist: templateForm.selfChecklistItems.length > 0 ? templateForm.selfChecklistItems.map(l => ({ label: l })) : null,
      deliverableSlots: templateForm.deliverableSlots.length > 0 ? templateForm.deliverableSlots : null,
      attachments: templateForm.attachments.length > 0 ? templateForm.attachments.map(f => ({ name: f.name, url: f.url, type: f.type, size: f.size })) : null,
    };

    const url = isCreate ? "/api/templates" : `/api/templates/${editingTemplateId}`;
    const method = isCreate ? "POST" : "PATCH";

    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });

      if (res.ok) {
        setEditingTemplateId(null);
        setShowTemplateForm(false);
        setTemplateForm(emptyTemplateForm);
        fetchTemplates();
      } else {
        const data = await res.json().catch(() => ({}));
        const msg = data.error || ta("failedToSave");
        const errorId = data.errorId ? ` [${data.errorId}]` : "";
        setTemplateFormError(`${msg}${errorId}`);
      }
    } catch (err) {
      setTemplateFormError(`Network error: ${err instanceof Error ? err.message : "Failed to reach server"}`);
    }
    setTemplateSaving(false);
  };

  const deleteTemplate = async (id: string) => {
    setDeletingTemplateId(id);
    await fetch(`/api/templates/${id}`, { method: "DELETE" });
    if (editingTemplateId === id) { setEditingTemplateId(null); setShowTemplateForm(false); }
    fetchTemplates();
    setDeletingTemplateId(null);
    setConfirmDeleteTemplateId(null);
  };

  const cloneTemplate = async (t: TaskTemplate) => {
    setCloningTemplateId(t.id);
    const res = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `${t.name} (copy)`,
        nameCn: t.nameCn ? `${t.nameCn} (copy)` : null,
        category: detectCategoryFromSlots(t.deliverableSlots || []),
        description: t.description, descriptionCn: t.descriptionCn,
        bountyUsd: t.bountyUsd, bountyRmb: t.bountyRmb,
        bonusBountyUsd: t.bonusBountyUsd, bonusBountyRmb: t.bonusBountyRmb,
        maxAttempts: t.maxAttempts, checklist: t.checklist,
        selfChecklist: t.selfChecklist, deliverableSlots: t.deliverableSlots,
        attachments: t.attachments,
      }),
    });
    if (res.ok) fetchTemplates();
    setCloningTemplateId(null);
  };

  useEffect(() => {
    let active = true;
    // Fetch channels, tasks, and templates in parallel
    Promise.all([
      fetch("/api/channels").then((r) => r.json()),
      fetch("/api/admin/tasks").then((r) => r.json()),
    ])
      .then(([chData, taskData]) => {
        if (!active) return;
        const taskChannels = (chData.channels || []).filter((c: TaskChannel) => c.type === "task");
        if (taskData.modChannelIds) {
          const assignedChannelIds = new Set(taskData.modChannelIds);
          setChannels(taskChannels.filter((c: TaskChannel) => assignedChannelIds.has(c.id)));
        } else {
          setChannels(taskChannels);
        }
        setTasks(taskData.tasks || []);
      })
      .catch(() => { })
      .finally(() => { if (active) setLoading(false); });

    // Fetch templates
    (async () => {
      try {
        const res = await fetch("/api/templates");
        const data = await res.json();
        if (!active) return;
        let finalTemplates = data.templates || [];
        if (finalTemplates.length === 0) {
          const seedRes = await fetch("/api/templates/seed", { method: "POST" });
          if (seedRes.ok) {
            const seedData = await seedRes.json();
            if (seedData.seeded) {
              const res2 = await fetch("/api/templates");
              const data2 = await res2.json();
              finalTemplates = data2.templates || [];
            }
          }
        }
        if (active) { setTemplates(finalTemplates); setTemplatesLoading(false); }
      } catch {
        if (active) setTemplatesLoading(false);
      }
    })();

    // Check if we need to edit a draft task (from tasks list page)
    const editId = sessionStorage.getItem("editDraftTask");
    if (editId) {
      sessionStorage.removeItem("editDraftTask");
      Promise.resolve().then(() => { if (active) handleEdit(editId); });
    }
    // Check if a template was selected via pendingApplyTemplate
    if (pendingApplyTemplate) {
      const t = pendingApplyTemplate;
      pendingApplyTemplate = null;
      setTitle(t.name || "");
      setTitleCn(t.nameCn || "");
      setDescription(t.description || "");
      setDescriptionCn(t.descriptionCn || "");
      setBountyUsd(t.bountyUsd || "");
      setBountyRmb(t.bountyRmb || "");
      setBonusBountyUsd(t.bonusBountyUsd || "");
      setBonusBountyRmb(t.bonusBountyRmb || "");
      setMaxAttempts(String(t.maxAttempts || 5));
      setChecklistItems((t.checklist || []).map((c: { label: string }) => c.label));
      setSelfChecklistItems((t.selfChecklist || []).map((c: { label: string }) => c.label));
      setDeliverableSlots(t.deliverableSlots || []);
      setTaskAttachments((t.attachments || []).map(a => ({ name: a.name, url: a.url, type: a.type, size: a.size })));
      setCreateMode("form");
    }
    return () => { active = false; };
  }, []);

  const handleCreate = async (publish?: boolean) => {
    const shouldPublish = publish ?? publishNow;
    if (!channelId || !title || !description) {
      setFormError("Channel, title, and description are required");
      return;
    }
    setCreating(true);
    setFormError("");

    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channelId,
        title,
        titleCn: titleCn || undefined,
        description,
        descriptionCn: descriptionCn || undefined,
        bountyUsd: bountyUsd || undefined,
        bountyRmb: bountyRmb || undefined,
        bonusBountyUsd: bonusBountyUsd || undefined,
        bonusBountyRmb: bonusBountyRmb || undefined,
        maxAttempts: parseInt(maxAttempts) || 5,
        deadline: deadline || undefined,
        status: shouldPublish ? "active" : "draft",
        checklist: checklistItems.length > 0 ? checklistItems.map((label) => ({ label })) : undefined,
        selfChecklist: selfChecklistItems.length > 0 ? selfChecklistItems.map((label) => ({ label })) : undefined,
        attachments: taskAttachments.length > 0 ? taskAttachments.map((f) => ({ name: f.name, url: f.url, type: f.type, size: f.size })) : undefined,
        deliverableSlots: deliverableSlots.length > 0 ? deliverableSlots : undefined,
      }),
    });

    if (res.ok) {
      resetTaskForm();
      setCreateMode("closed");
      fetchData();
      window.dispatchEvent(new Event("tasks-updated"));
    } else {
      const data = await res.json();
      setFormError(data.error || ta("failedCreateTask"));
    }
    setCreating(false);
  };

  const handleStatusChange = async (taskId: string, newStatus: string) => {
    setActionLoadingId(taskId);
    await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    fetchData();
    window.dispatchEvent(new Event("tasks-updated"));
    setActionLoadingId(null);
  };

  const handleUpdate = async (publish?: boolean) => {
    const shouldPublish = publish ?? publishNow;
    if (!editingTaskId || !channelId || !title || !description) {
      setFormError("Channel, title, and description are required");
      return;
    }
    setCreating(true);
    setFormError("");

    const body: Record<string, any> = {
      channelId,
      title,
      titleCn: titleCn || undefined,
      description,
      descriptionCn: descriptionCn || undefined,
      bountyUsd: bountyUsd || undefined,
      bountyRmb: bountyRmb || undefined,
      bonusBountyUsd: bonusBountyUsd || undefined,
      bonusBountyRmb: bonusBountyRmb || undefined,
      maxAttempts: parseInt(maxAttempts) || 5,
      deadline: deadline || undefined,
      checklist: checklistItems.length > 0 ? checklistItems.map((label) => ({ label })) : undefined,
      selfChecklist: selfChecklistItems.length > 0 ? selfChecklistItems.map((label) => ({ label })) : undefined,
      attachments: taskAttachments.length > 0 ? taskAttachments.map((f) => ({ name: f.name, url: f.url, type: f.type, size: f.size })) : undefined,
      deliverableSlots: deliverableSlots.length > 0 ? deliverableSlots : undefined,
    };
    if (shouldPublish) body.status = "active";

    const res = await fetch(`/api/tasks/${editingTaskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      resetTaskForm();
      setCreateMode("closed");
      fetchData();
      window.dispatchEvent(new Event("tasks-updated"));
    } else {
      const data = await res.json();
      setFormError(data.error || ta("failedUpdateTask"));
    }
    setCreating(false);
  };

  const detectCategory = (slots: DeliverableSlot[]): string => {
    const types = slots.map((s) => s.type);
    if (types.some((t) => t === "upload-audio")) return "audio";
    if (types.some((t) => t === "upload-video")) return "video";
    if (types.some((t) => t === "upload-image")) return "image";
    if (types.some((t) => t === "upload-text" || t === "upload-tsv" || t === "upload-srt" || t === "textbox")) return "text";
    if (types.some((t) => t === "multiple-selection" || t === "rating")) return "other";
    return "other";
  };

  const handleSaveAsTemplate = async () => {
    if (!templateName.trim()) return;
    setSavingTemplate(true);
    setTemplateSaveMsg(null);
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: templateName.trim(),
          nameCn: templateNameCn.trim() || null,
          category: detectCategory(deliverableSlots),
          description: description || null,
          descriptionCn: descriptionCn || null,
          bountyUsd: bountyUsd || null,
          bountyRmb: bountyRmb || null,
          bonusBountyUsd: bonusBountyUsd || null,
          bonusBountyRmb: bonusBountyRmb || null,
          maxAttempts: parseInt(maxAttempts) || 5,
          checklist: checklistItems.length > 0 ? checklistItems.map((label) => ({ label })) : null,
          selfChecklist: selfChecklistItems.length > 0 ? selfChecklistItems.map((label) => ({ label })) : null,
          deliverableSlots: deliverableSlots.length > 0 ? deliverableSlots : null,
          attachments: taskAttachments.length > 0 ? taskAttachments.map((f) => ({ name: f.name, url: f.url, type: f.type, size: f.size })) : null,
        }),
      });
      if (res.ok) {
        setTemplateSaveMsg({ type: "ok", text: ta("templateSaved") });
        setShowSaveTemplate(false);
        setTemplateName("");
        setTemplateNameCn("");
        fetchTemplates();
        setTimeout(() => setTemplateSaveMsg(null), 3000);
      } else {
        const data = await res.json();
        setTemplateSaveMsg({ type: "err", text: data.error || ta("failedSaveTemplate") });
      }
    } catch {
      setTemplateSaveMsg({ type: "err", text: ta("networkError") });
    }
    setSavingTemplate(false);
  };

  // ─── Template form renderer ──────────────────────────────────────────────────
  const renderTemplateForm = () => (
    <div className="mb-6 p-4 bg-discord-bg-dark rounded-xl border border-discord-bg-darker/60">
      <h3 className="text-sm font-semibold text-discord-text mb-3 uppercase">
        {editingTemplateId ? ta("editTemplate") : ta("newTemplate")}
      </h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <label className="text-xs text-discord-text-muted">{ta("templateName")}</label>
            <TranslateButton sourceText={templateForm.nameCn} from="zh" onTranslated={(v) => setTemplateForm({ ...templateForm, name: v })} context="task template name — keep it short" />
          </div>
          <input value={templateForm.name} onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })} className="w-full p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none" placeholder="e.g. Voiceover Recording" />
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <label className="text-xs text-discord-text-muted">{ta("nameCn")}</label>
            <TranslateButton sourceText={templateForm.name} from="en" onTranslated={(v) => setTemplateForm({ ...templateForm, nameCn: v })} context="task template name — keep it short" />
          </div>
          <input value={templateForm.nameCn} onChange={(e) => setTemplateForm({ ...templateForm, nameCn: e.target.value })} className="w-full p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none" placeholder="中文模板名称" />
        </div>
        <div>
          {(() => {
            const cat = detectCategoryFromSlots(templateForm.deliverableSlots);
            const style = TEMPLATE_ICONS[cat] || TEMPLATE_ICONS.other;
            return (
              <>
                <label className="block text-xs text-discord-text-muted mb-1">{ta("categoryAutoDetected")}</label>
                <div className="w-full p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text flex items-center gap-2">
                  <span>{style.icon}</span>
                  <span className="capitalize">{cat}</span>
                  <span className="text-[10px] text-discord-text-muted ml-auto">{ta("basedOnDeliverables")}</span>
                </div>
              </>
            );
          })()}
        </div>
        <div>
          <label className="block text-xs text-discord-text-muted mb-1">{ta("maxAttempts")}</label>
          <input type="number" min="1" value={templateForm.maxAttempts} onChange={(e) => setTemplateForm({ ...templateForm, maxAttempts: e.target.value })} className="w-full p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none" />
        </div>
        <div className="col-span-2">
          <div className="flex items-center gap-2 mb-1">
            <label className="text-xs text-discord-text-muted">{ta("descriptionEnLabel")}</label>
            <TranslateButton sourceText={templateForm.descriptionCn} from="zh" onTranslated={(v) => setTemplateForm({ ...templateForm, description: v })} context="task template description — may contain Markdown" />
          </div>
          <textarea value={templateForm.description} onChange={(e) => setTemplateForm({ ...templateForm, description: e.target.value })} rows={3} className="w-full p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none resize-none" placeholder="Task requirements and instructions (Markdown)..." />
        </div>
        <div className="col-span-2">
          <div className="flex items-center gap-2 mb-1">
            <label className="text-xs text-discord-text-muted">{ta("descriptionCnLabel")}</label>
            <TranslateButton sourceText={templateForm.description} from="en" onTranslated={(v) => setTemplateForm({ ...templateForm, descriptionCn: v })} context="task template description — may contain Markdown" />
          </div>
          <textarea value={templateForm.descriptionCn} onChange={(e) => setTemplateForm({ ...templateForm, descriptionCn: e.target.value })} rows={3} className="w-full p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none resize-none" placeholder="中文任务说明 (支持 Markdown)..." />
        </div>
        <div>
          <label className="block text-xs text-discord-text-muted mb-1">{ta("bountyUsd")}</label>
          <input value={templateForm.bountyUsd} onChange={(e) => setTemplateForm({ ...templateForm, bountyUsd: e.target.value })} onKeyDown={(e) => { if (e.key.length === 1 && !/[\d.,]/.test(e.key)) e.preventDefault(); }} placeholder="25.00" className="w-full p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none" />
        </div>
        <div>
          <label className="block text-xs text-discord-text-muted mb-1">{ta("bountyRmb")}</label>
          <input value={templateForm.bountyRmb} onChange={(e) => setTemplateForm({ ...templateForm, bountyRmb: e.target.value })} onKeyDown={(e) => { if (e.key.length === 1 && !/[\d.,]/.test(e.key)) e.preventDefault(); }} placeholder="178.00" className="w-full p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none" />
        </div>
        <div>
          <label className="block text-xs text-discord-text-muted mb-1">{ta("bonusUsd")}</label>
          <input value={templateForm.bonusBountyUsd} onChange={(e) => setTemplateForm({ ...templateForm, bonusBountyUsd: e.target.value })} onKeyDown={(e) => { if (e.key.length === 1 && !/[\d.,]/.test(e.key)) e.preventDefault(); }} placeholder="35.00" className="w-full p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none" />
        </div>
        <div>
          <label className="block text-xs text-discord-text-muted mb-1">{ta("bonusRmb")}</label>
          <input value={templateForm.bonusBountyRmb} onChange={(e) => setTemplateForm({ ...templateForm, bonusBountyRmb: e.target.value })} onKeyDown={(e) => { if (e.key.length === 1 && !/[\d.,]/.test(e.key)) e.preventDefault(); }} className="w-full p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none" />
        </div>
        {/* Attachments */}
        <div className="col-span-2">
          <FileUpload
            files={templateForm.attachments}
            onFilesChange={(files) => setTemplateForm({ ...templateForm, attachments: files })}
            context="task-attachment"
            maxFiles={10}
            maxSizeMb={100}
            label={ta("attachmentsLabel")}
            compact
          />
        </div>
        {/* Deliverable Slots */}
        <div className="col-span-2">
          <DeliverableSlotEditor
            slots={templateForm.deliverableSlots}
            onChange={(slots) => setTemplateForm({ ...templateForm, deliverableSlots: slots })}
            allowEmpty
          />
        </div>
        {/* Review Checklist */}
        <div className="col-span-2">
          <label className="block text-xs text-discord-text-muted mb-1">{ta("reviewChecklistLabel")}</label>
          {templateForm.checklistItems.length > 0 && (
            <div className="space-y-1 mb-2">
              {templateForm.checklistItems.map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-green-400">✓</span>
                  <span className="flex-1 text-sm text-discord-text">{item}</span>
                  <button type="button" onClick={() => setTemplateForm({ ...templateForm, checklistItems: templateForm.checklistItems.filter((_, idx) => idx !== i) })} className="text-red-400 hover:text-red-300 text-xs">✕</button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              value={templateForm.newChecklistItem}
              onChange={(e) => setTemplateForm({ ...templateForm, newChecklistItem: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && templateForm.newChecklistItem.trim()) {
                  e.preventDefault();
                  setTemplateForm({ ...templateForm, checklistItems: [...templateForm.checklistItems, templateForm.newChecklistItem.trim()], newChecklistItem: "" });
                }
              }}
              placeholder="e.g. Audio quality meets requirements"
              className="flex-1 p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none"
            />
            <button
              type="button"
              onClick={() => {
                if (templateForm.newChecklistItem.trim()) {
                  setTemplateForm({ ...templateForm, checklistItems: [...templateForm.checklistItems, templateForm.newChecklistItem.trim()], newChecklistItem: "" });
                }
              }}
              className="px-3 py-1.5 text-xs bg-discord-accent/20 text-discord-accent rounded hover:bg-discord-accent/30 transition"
            >
              {ta("addItem")}
            </button>
          </div>
        </div>
        {/* Self-Checklist (creator guidance) */}
        <div className="col-span-2">
          <label className="block text-xs text-discord-text-muted mb-1">{ta("selfChecklistLabel")}</label>
          <p className="text-[10px] text-discord-text-muted mb-1.5">{ta("selfChecklistTemplateDesc")}</p>
          {templateForm.selfChecklistItems.length > 0 && (
            <div className="space-y-1 mb-2">
              {templateForm.selfChecklistItems.map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-sky-400">•</span>
                  <span className="flex-1 text-sm text-discord-text">{item}</span>
                  <button type="button" onClick={() => setTemplateForm({ ...templateForm, selfChecklistItems: templateForm.selfChecklistItems.filter((_, idx) => idx !== i) })} className="text-red-400 hover:text-red-300 text-xs">✕</button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              value={templateForm.newSelfChecklistItem}
              onChange={(e) => setTemplateForm({ ...templateForm, newSelfChecklistItem: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && templateForm.newSelfChecklistItem.trim()) {
                  e.preventDefault();
                  setTemplateForm({ ...templateForm, selfChecklistItems: [...templateForm.selfChecklistItems, templateForm.newSelfChecklistItem.trim()], newSelfChecklistItem: "" });
                }
              }}
              placeholder="e.g. No background noise, clear pronunciation"
              className="flex-1 p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none"
            />
            <button
              type="button"
              onClick={() => {
                if (templateForm.newSelfChecklistItem.trim()) {
                  setTemplateForm({ ...templateForm, selfChecklistItems: [...templateForm.selfChecklistItems, templateForm.newSelfChecklistItem.trim()], newSelfChecklistItem: "" });
                }
              }}
              className="px-3 py-1.5 text-xs bg-sky-500/20 text-sky-400 rounded hover:bg-sky-500/30 transition"
            >
              {ta("addItem")}
            </button>
          </div>
        </div>
      </div>
      {templateFormError && <p className="text-xs text-discord-red mt-2">{templateFormError}</p>}
      <div className="flex gap-2 mt-3">
        <button onClick={saveTemplate} disabled={templateSaving} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-semibold transition disabled:opacity-50 flex items-center gap-1">
          <ButtonSpinner loading={templateSaving}>{editingTemplateId ? ta("saveChanges") : ta("createTemplate")}</ButtonSpinner>
        </button>
        <button onClick={() => { setShowTemplateForm(false); setEditingTemplateId(null); setTemplateForm(emptyTemplateForm); }} className="px-4 py-2 bg-discord-bg-hover text-discord-text-muted rounded text-sm transition hover:text-discord-text">
          {ta("cancel")}
        </button>
      </div>
    </div>
  );

  if (loading) return <div className="text-discord-text-muted text-sm">{ta("loadingTasks")}</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <SectionTitle>{ta("taskManagement")}</SectionTitle>
        {createMode === "closed" ? (
          <button
            onClick={() => setCreateMode("picker")}
            className="px-4 py-2 bg-discord-accent hover:bg-discord-accent/80 text-white rounded-lg text-sm font-semibold transition"
          >
            + {ta("createTaskBtn")}
          </button>
        ) : (
          <button
            onClick={() => { setCreateMode("closed"); resetTaskForm(); setShowTemplateForm(false); setEditingTemplateId(null); }}
            className="px-4 py-2 bg-discord-bg-hover hover:bg-discord-border text-discord-text-muted rounded-lg text-sm font-semibold transition"
          >
            {ta("cancel")}
          </button>
        )}
      </div>

      {/* ── Create Task Picker ── */}
      {createMode === "picker" && (
        <div className="mb-6 p-5 bg-discord-bg-dark rounded-xl border border-discord-bg-darker/60">
          <h3 className="text-base font-bold text-discord-text mb-4">{ta("howToStart")}</h3>

          {/* Create Blank Task option */}
          <button
            onClick={() => { resetTaskForm(); setCreateMode("form"); }}
            className="w-full p-4 rounded-lg border-2 border-discord-accent/50 hover:border-discord-accent bg-discord-bg hover:bg-discord-bg-hover/30 transition flex items-center gap-3 mb-5"
          >
            <span className="text-2xl text-discord-accent">📄</span>
            <div className="text-left">
              <div className="font-semibold text-discord-text">{ta("createBlankTask")}</div>
              <div className="text-xs text-discord-text-muted">{ta("createBlankTaskDesc")}</div>
            </div>
          </button>

          {/* Or start from a template */}
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-bold uppercase tracking-widest text-discord-text-muted">{ta("orStartFromTemplate")}</div>
            {["admin", "supermod"].includes(user?.role || "") && (
              <button
                onClick={startCreateTemplate}
                className="px-3 py-1.5 bg-discord-accent hover:bg-discord-accent/80 text-white rounded text-xs font-semibold transition"
              >
                + {ta("createTemplateBtn")}
              </button>
            )}
          </div>

          {/* Template create/edit form */}
          {showTemplateForm && renderTemplateForm()}

          {/* Template list */}
          {templatesLoading ? (
            <div className="text-discord-text-muted text-sm py-4 text-center">{ta("loadingTemplates")}</div>
          ) : templates.length === 0 ? (
            <p className="text-sm text-discord-text-muted text-center py-4">{ta("noTemplatesYet")}</p>
          ) : (
            <div className="space-y-2">
              {templates.map((t) => {
                const style = TEMPLATE_ICONS[t.category] || { icon: "📋", color: "text-gray-400", bg: "from-gray-500/10 to-gray-500/20" };
                const isEditing = editingTemplateId === t.id;

                return (
                  <div
                    key={t.id}
                    className={`rounded-lg border border-discord-border bg-discord-bg hover:bg-discord-bg-hover/30 transition cursor-pointer ${isEditing ? "ring-2 ring-discord-accent" : ""}`}
                  >
                    <div className="flex items-center gap-3 p-3" onClick={() => { if (!isEditing) applyTemplate(t); }}>
                      <span className="text-xl shrink-0">{style.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-discord-text text-sm">{localized(locale, t.name, t.nameCn)}</div>
                        <div className="text-xs text-discord-text-muted truncate">
                          {[
                            t.deliverableSlots?.length ? `${t.deliverableSlots.length} slot${t.deliverableSlots.length > 1 ? "s" : ""}` : null,
                            t.checklist?.length ? `${t.checklist.length} check${t.checklist.length > 1 ? "s" : ""}` : null,
                            t.bountyUsd ? `$${t.bountyUsd}` : null,
                            t.attachments?.length ? `${t.attachments.length} file${t.attachments.length > 1 ? "s" : ""}` : null,
                          ].filter(Boolean).join(", ") || localized(locale, t.description || "", t.descriptionCn)?.slice(0, 60) || ta("noDescription")}
                        </div>
                      </div>
                      {/* Action tags on the right */}
                      {["admin", "supermod"].includes(user?.role || "") && (
                        <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => isEditing ? (setEditingTemplateId(null), setShowTemplateForm(false)) : startEditTemplate(t)}
                            className="px-2 py-1 bg-discord-accent/20 text-discord-accent text-[11px] rounded hover:bg-discord-accent/30 font-medium transition"
                          >
                            {isEditing ? ta("cancelEdit") : ta("edit")}
                          </button>
                          <button
                            onClick={() => cloneTemplate(t)}
                            disabled={cloningTemplateId === t.id}
                            className="px-2 py-1 bg-sky-500/20 text-sky-400 text-[11px] rounded hover:bg-sky-500/30 transition disabled:opacity-50 flex items-center gap-0.5 font-medium"
                          >
                            <ButtonSpinner loading={cloningTemplateId === t.id}>{ta("clone")}</ButtonSpinner>
                          </button>
                          <button
                            onClick={() => setConfirmDeleteTemplateId(t.id)}
                            disabled={deletingTemplateId === t.id}
                            className="px-2 py-1 bg-red-500/20 text-red-400 text-[11px] rounded hover:bg-red-500/30 transition disabled:opacity-50 flex items-center gap-0.5 font-medium"
                          >
                            <ButtonSpinner loading={deletingTemplateId === t.id}>{ta("delete")}</ButtonSpinner>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Reset to defaults */}
          {["admin"].includes(user?.role || "") && (
            <div className="mt-4 flex justify-end">
              <button
                onClick={async () => {
                  if (!confirm(ta("resetConfirm"))) return;
                  setTemplatesLoading(true);
                  await fetch("/api/templates/seed", { method: "DELETE" });
                  fetchTemplates();
                }}
                className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded text-xs font-semibold transition"
              >
                {ta("resetToDefaults")}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Task Creation / Edit Form ── */}
      {createMode === "form" && (
        <div className="mb-6 p-4 bg-discord-bg-dark rounded-xl border border-discord-bg-darker/60">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-discord-text uppercase">{editingTaskId ? ta("editTask") : ta("newTask")}</h3>
            <button
              onClick={() => { setCreateMode("picker"); resetTaskForm(); }}
              className="text-xs text-discord-text-muted hover:text-discord-text transition"
            >
              ← {ta("backToTemplates")}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-discord-text-muted mb-1">{ta("channel")}</label>
              <select value={channelId} onChange={(e) => setChannelId(e.target.value)} className="w-full p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none focus:ring-2 focus:ring-discord-accent">
                <option value="">{ta("selectChannel")}</option>
                {channels.map((ch) => (<option key={ch.id} value={ch.id}>#{ch.name}</option>))}
              </select>
            </div>
            <div className="col-span-2">
              <div className="flex items-center gap-2 mb-1">
                <label className="text-xs text-discord-text-muted">{ta("titleEn")}</label>
                <TranslateButton sourceText={titleCn} from="zh" onTranslated={setTitle} context="task title — keep it concise" />
              </div>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none" placeholder="e.g. Voice Recording #42 — English Narration" />
            </div>
            <div className="col-span-2">
              <div className="flex items-center gap-2 mb-1">
                <label className="text-xs text-discord-text-muted">{ta("titleCn")}</label>
                <TranslateButton sourceText={title} from="en" onTranslated={setTitleCn} context="task title — keep it concise" />
              </div>
              <input value={titleCn} onChange={(e) => setTitleCn(e.target.value)} className="w-full p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none" />
            </div>
            <div className="col-span-2">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-discord-text-muted">{ta("descriptionEn")}</label>
                  <TranslateButton sourceText={descriptionCn} from="zh" onTranslated={setDescription} context="task description — may contain Markdown" />
                </div>
                <button type="button" onClick={() => setPreviewDescEn(!previewDescEn)} className="text-[10px] px-2 py-0.5 rounded bg-discord-bg-hover text-discord-text-muted hover:text-discord-text transition">
                  {previewDescEn ? ta("edit") : ta("preview")}
                </button>
              </div>
              {previewDescEn ? (
                <div className="w-full p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text-secondary min-h-[72px] whitespace-pre-wrap">{description || ta("nothingToPreview")}</div>
              ) : (
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none resize-none" placeholder="Task requirements and instructions (Markdown)..." />
              )}
            </div>
            <div className="col-span-2">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-discord-text-muted">{ta("descriptionCn")}</label>
                  <TranslateButton sourceText={description} from="en" onTranslated={setDescriptionCn} context="task description — may contain Markdown" />
                </div>
                <button type="button" onClick={() => setPreviewDescCn(!previewDescCn)} className="text-[10px] px-2 py-0.5 rounded bg-discord-bg-hover text-discord-text-muted hover:text-discord-text transition">
                  {previewDescCn ? ta("edit") : ta("preview")}
                </button>
              </div>
              {previewDescCn ? (
                <div className="w-full p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text-secondary min-h-[72px] whitespace-pre-wrap">{descriptionCn || ta("nothingToPreview")}</div>
              ) : (
                <textarea value={descriptionCn} onChange={(e) => setDescriptionCn(e.target.value)} rows={3} className="w-full p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none resize-none" placeholder="中文任务说明 (支持 Markdown)..." />
              )}
            </div>
            <div>
              <label className="block text-xs text-discord-text-muted mb-1">{ta("bountyUsd")}</label>
              <input value={bountyUsd} onChange={(e) => setBountyUsd(e.target.value)} onKeyDown={(e) => { if (e.key.length === 1 && !/[\d.,]/.test(e.key)) e.preventDefault(); }} placeholder="25.00" className="w-full p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs text-discord-text-muted mb-1">{ta("bountyRmb")}</label>
              <input value={bountyRmb} onChange={(e) => setBountyRmb(e.target.value)} onKeyDown={(e) => { if (e.key.length === 1 && !/[\d.,]/.test(e.key)) e.preventDefault(); }} placeholder="178.00" className="w-full p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs text-discord-text-muted mb-1">{ta("bonusUsd")}</label>
              <input value={bonusBountyUsd} onChange={(e) => setBonusBountyUsd(e.target.value)} onKeyDown={(e) => { if (e.key.length === 1 && !/[\d.,]/.test(e.key)) e.preventDefault(); }} placeholder="35.00" className="w-full p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs text-discord-text-muted mb-1">{ta("bonusRmb")}</label>
              <input value={bonusBountyRmb} onChange={(e) => setBonusBountyRmb(e.target.value)} onKeyDown={(e) => { if (e.key.length === 1 && !/[\d.,]/.test(e.key)) e.preventDefault(); }} placeholder="72.00" className="w-full p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none" />
            </div>
            {/* Attachments */}
            <div className="col-span-2">
              <FileUpload
                files={taskAttachments}
                onFilesChange={setTaskAttachments}
                context="task-attachment"
                maxFiles={10}
                maxSizeMb={100}
                label={ta("attachmentsLabel")}
                compact
              />
            </div>

            {/* Deliverable Slots Editor */}
            <div className="col-span-2">
              <DeliverableSlotEditor
                slots={deliverableSlots}
                onChange={setDeliverableSlots}
              />
            </div>

            {/* Self-Checklist Builder (creator guidance) */}
            <div className="col-span-2">
              <label className="block text-xs text-discord-text-muted mb-1">{ta("selfChecklist")}</label>
              <p className="text-[10px] text-discord-text-muted mb-1.5">{ta("selfChecklistDesc")}</p>
              {selfChecklistItems.length > 0 && (
                <div className="space-y-1 mb-2">
                  {selfChecklistItems.map((item, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-xs text-sky-400">•</span>
                      <span className="flex-1 text-sm text-discord-text">{item}</span>
                      <button type="button" onClick={() => setSelfChecklistItems(selfChecklistItems.filter((_, idx) => idx !== i))} className="text-red-400 hover:text-red-300 text-xs">✕</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  value={newSelfChecklistItem}
                  onChange={(e) => setNewSelfChecklistItem(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newSelfChecklistItem.trim()) {
                      e.preventDefault();
                      setSelfChecklistItems([...selfChecklistItems, newSelfChecklistItem.trim()]);
                      setNewSelfChecklistItem("");
                    }
                  }}
                  placeholder="e.g. No background noise, clear pronunciation"
                  className="flex-1 p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (newSelfChecklistItem.trim()) {
                      setSelfChecklistItems([...selfChecklistItems, newSelfChecklistItem.trim()]);
                      setNewSelfChecklistItem("");
                    }
                  }}
                  className="px-3 py-1.5 text-xs bg-sky-500/20 text-sky-400 rounded hover:bg-sky-500/30 transition"
                >
                  {ta("addItem")}
                </button>
              </div>
            </div>

            {/* Review Checklist Builder */}
            <div className="col-span-2">
              <label className="block text-xs text-discord-text-muted mb-1">{ta("reviewChecklist")}</label>
              {checklistItems.length > 0 && (
                <div className="space-y-1 mb-2">
                  {checklistItems.map((item, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-xs text-green-400">✓</span>
                      <span className="flex-1 text-sm text-discord-text">{item}</span>
                      <button type="button" onClick={() => setChecklistItems(checklistItems.filter((_, idx) => idx !== i))} className="text-red-400 hover:text-red-300 text-xs">✕</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  value={newChecklistItem}
                  onChange={(e) => setNewChecklistItem(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newChecklistItem.trim()) {
                      e.preventDefault();
                      setChecklistItems([...checklistItems, newChecklistItem.trim()]);
                      setNewChecklistItem("");
                    }
                  }}
                  placeholder="e.g. Audio quality meets requirements"
                  className="flex-1 p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (newChecklistItem.trim()) {
                      setChecklistItems([...checklistItems, newChecklistItem.trim()]);
                      setNewChecklistItem("");
                    }
                  }}
                  className="px-3 py-1.5 text-xs bg-discord-accent/20 text-discord-accent rounded hover:bg-discord-accent/30 transition"
                >
                  {ta("addItem")}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs text-discord-text-muted mb-1">{ta("maxAttempts")}</label>
              <input value={maxAttempts} onChange={(e) => setMaxAttempts(e.target.value)} type="number" min="1" className="w-full p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs text-discord-text-muted mb-1">{ta("deadline")}</label>
              <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="w-full p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none" />
              {!deadline && <p className="text-xs text-discord-text-muted mt-1">{ta("noDeadlineHint")}</p>}
              {deadline && new Date(deadline) < new Date() && <p className="text-xs text-discord-red mt-1">{ta("deadlinePastError")}</p>}
            </div>
          </div>
          {formError && <p className="text-xs text-discord-red mt-2">{formError}</p>}
          {deliverableSlots.length === 0 && (
            <p className="text-xs text-red-400 mt-2">⚠ {ta("cannotPublish")}</p>
          )}
          <div className="mt-4 flex gap-3">
            {editingTaskId && editingTaskStatus === "active" ? (
              /* Editing an already-active task: single "Save Changes" button */
              <button
                onClick={() => { setPublishNow(false); handleUpdate(false); }}
                disabled={creating || (!!deadline && new Date(deadline) < new Date())}
                className="flex-1 py-2.5 bg-discord-accent hover:bg-discord-accent/80 text-white rounded-lg text-sm font-semibold transition disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                <ButtonSpinner loading={creating}>{ta("saveChanges")}</ButtonSpinner>
              </button>
            ) : (
              /* Creating or editing a draft: Save as Draft + Publish */
              <>
                <button
                  onClick={() => { setPublishNow(false); (editingTaskId ? handleUpdate : handleCreate)(false); }}
                  disabled={creating || (!!deadline && new Date(deadline) < new Date())}
                  className="flex-1 py-2.5 bg-discord-bg-hover hover:bg-discord-border text-discord-text-secondary rounded-lg text-sm font-semibold transition disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  <ButtonSpinner loading={creating && !publishNow}>{ta("saveAsDraft")}</ButtonSpinner>
                </button>
                <button
                  onClick={() => { setPublishNow(true); (editingTaskId ? handleUpdate : handleCreate)(true); }}
                  disabled={creating || deliverableSlots.length === 0 || (!!deadline && new Date(deadline) < new Date())}
                  className="flex-1 py-2.5 bg-discord-accent hover:bg-discord-accent/80 text-white rounded-lg text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                >
                  <ButtonSpinner loading={creating && publishNow}>{ta("publish")}</ButtonSpinner>
                </button>
              </>
            )}
          </div>
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => { setShowSaveTemplate(!showSaveTemplate); setTemplateSaveMsg(null); }}
              className="py-1.5 px-3 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 rounded-lg text-xs font-semibold transition flex items-center gap-1.5"
            >
              📋 {ta("saveAsTemplate")}
            </button>
          </div>
          {templateSaveMsg && (
            <p className={`text-xs mt-2 ${templateSaveMsg.type === "ok" ? "text-green-400" : "text-discord-red"}`}>{templateSaveMsg.text}</p>
          )}
          {showSaveTemplate && (
            <div className="mt-3 p-3 bg-discord-bg rounded-lg border border-amber-500/30">
              <p className="text-xs text-discord-text-muted mb-2">Save current task configuration as a reusable template. Category icon will be auto-detected from your deliverable slots ({(TEMPLATE_ICONS[detectCategory(deliverableSlots)] || TEMPLATE_ICONS.other).icon} {detectCategory(deliverableSlots)}).</p>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div>
                  <label className="block text-xs text-discord-text-muted mb-1">{ta("templateName")}</label>
                  <input
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    placeholder="e.g. Voiceover Recording"
                    className="w-full p-2 bg-discord-bg-dark border border-discord-border rounded text-sm text-discord-text focus:outline-none"
                    onKeyDown={(e) => { if (e.key === "Enter" && templateName.trim()) handleSaveAsTemplate(); }}
                  />
                </div>
                <div>
                  <label className="block text-xs text-discord-text-muted mb-1">{ta("nameCn")}</label>
                  <input
                    value={templateNameCn}
                    onChange={(e) => setTemplateNameCn(e.target.value)}
                    placeholder="中文模板名称"
                    className="w-full p-2 bg-discord-bg-dark border border-discord-border rounded text-sm text-discord-text focus:outline-none"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSaveAsTemplate}
                  disabled={savingTemplate || !templateName.trim()}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded text-sm font-semibold transition disabled:opacity-50 flex items-center gap-1"
                >
                  <ButtonSpinner loading={savingTemplate}>{ta("saveTemplate")}</ButtonSpinner>
                </button>
                <button
                  onClick={() => { setShowSaveTemplate(false); setTemplateName(""); setTemplateNameCn(""); }}
                  className="px-4 py-2 bg-discord-bg-hover text-discord-text-muted rounded text-sm transition hover:text-discord-text"
                >
                  {ta("cancel")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Task List ── */}
      {tasks.length === 0 && createMode === "closed" ? (
        <div className="text-center py-12 bg-discord-bg-dark rounded-xl border border-discord-bg-darker/60">
          <p className="text-sm text-discord-text-muted mb-4">{ta("noTasksYetCreate")}</p>
          <button
            onClick={() => setCreateMode("picker")}
            className="px-6 py-2.5 bg-discord-accent hover:bg-discord-accent/80 text-white rounded-lg text-sm font-semibold transition"
          >
            + {ta("createTaskBtn")}
          </button>
        </div>
      ) : tasks.length > 0 && (
        <div className="space-y-1">
          {tasks.map((task) => (
            <div key={task.id} className="flex items-center gap-3 px-3 py-2.5 bg-discord-bg-dark rounded-lg hover:bg-discord-bg-hover/30 transition">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded ${TASK_STATUS_COLORS[task.status] || TASK_STATUS_COLORS.draft}`}>
                {task.status}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-discord-text truncate">{localized(locale, task.title, task.titleCn)}</div>
                <div className="text-xs text-discord-text-muted">#{task.channelName} — by {task.createdByUsername} — {task.attemptCount} attempts — created: {(() => { const d = new Date(task.createdAt); return `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; })()}</div>
              </div>
              <span className="text-sm font-bold text-green-400 shrink-0">${task.bountyUsd || "0"}</span>
              <div className="flex gap-1 shrink-0">
                {task.status === "draft" && (
                  <>
                    <button onClick={() => handleEdit(task.id)} disabled={editLoading === task.id} className="text-xs px-2 py-1 bg-discord-accent hover:bg-discord-accent/80 text-white rounded transition disabled:opacity-50 flex items-center gap-1"><ButtonSpinner loading={editLoading === task.id}>{ta("edit")}</ButtonSpinner></button>
                    <button onClick={() => handleStatusChange(task.id, "active")} disabled={actionLoadingId === task.id} className="text-xs px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded transition disabled:opacity-50 flex items-center gap-1"><ButtonSpinner loading={actionLoadingId === task.id}>{ta("publish")}</ButtonSpinner></button>
                    <button onClick={() => handleStatusChange(task.id, "archived")} disabled={actionLoadingId === task.id} className="text-xs px-2 py-1 bg-gray-600 hover:bg-gray-700 text-white rounded transition disabled:opacity-50 flex items-center gap-1"><ButtonSpinner loading={actionLoadingId === task.id}>{ta("archive")}</ButtonSpinner></button>
                  </>
                )}
                {task.status === "active" && (
                  <>
                    <button onClick={() => handleEdit(task.id)} disabled={editLoading === task.id} className="text-xs px-2 py-1 bg-discord-accent hover:bg-discord-accent/80 text-white rounded transition disabled:opacity-50 flex items-center gap-1"><ButtonSpinner loading={editLoading === task.id}>{ta("edit")}</ButtonSpinner></button>
                    <button onClick={() => handleStatusChange(task.id, "archived")} disabled={actionLoadingId === task.id} className="text-xs px-2 py-1 bg-gray-600 hover:bg-gray-700 text-white rounded transition disabled:opacity-50 flex items-center gap-1"><ButtonSpinner loading={actionLoadingId === task.id}>{ta("archive")}</ButtonSpinner></button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete template confirmation */}
      <ConfirmDialog
        open={!!confirmDeleteTemplateId}
        onClose={() => setConfirmDeleteTemplateId(null)}
        onConfirm={() => { if (confirmDeleteTemplateId) deleteTemplate(confirmDeleteTemplateId); }}
        title={ta("deleteTemplateConfirm")}
        confirmText={ta("delete")}
        variant="danger"
      >
        {ta("deleteTemplateMessage")}
      </ConfirmDialog>
    </div>
  );
}

// ─── Admin: Channels ──────────────────────────────────────────────────────────

interface ChannelItem {
  id: string;
  name: string;
  nameCn: string | null;
  slug: string;
  type: string;
  description: string | null;
  descriptionCn: string | null;
  isFixed: boolean;
  requiredTagId: string | null;
}

interface ChannelMod {
  id: string;
  username: string;
  displayName: string | null;
  role: string;
}

// ─── Admin: Task Templates — removed, merged into AdminTasksSection ──────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function __REMOVED_AdminTemplatesSection() {
  const ta = useTranslations("admin");
  const tc = useTranslations("common");
  const { navigateTo } = useSettingsModal();
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);

  const emptyForm = {
    name: "", nameCn: "", description: "", descriptionCn: "",
    bountyUsd: "", bountyRmb: "", bonusBountyUsd: "", bonusBountyRmb: "",
    maxAttempts: "5", checklistItems: [] as string[], newChecklistItem: "",
    selfChecklistItems: [] as string[], newSelfChecklistItem: "",
    deliverableSlots: [] as DeliverableSlot[],
  };

  // Auto-detect category from deliverable slot types
  const detectCategoryFromSlots = (slots: DeliverableSlot[]): string => {
    const types = slots.map((s) => s.type);
    if (types.some((t) => t === "upload-audio")) return "audio";
    if (types.some((t) => t === "upload-video")) return "video";
    if (types.some((t) => t === "upload-image")) return "image";
    if (types.some((t) => t === "upload-text" || t === "upload-tsv" || t === "upload-srt" || t === "textbox")) return "text";
    return "other";
  };
  const [templateForm, setTemplateForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/templates");
      const data = await res.json();
      setTemplates(data.templates || []);
      if (data.templates?.length === 0) {
        const seedRes = await fetch("/api/templates/seed", { method: "POST" });
        if (seedRes.ok) {
          const seedData = await seedRes.json();
          if (seedData.seeded) {
            const res2 = await fetch("/api/templates");
            const data2 = await res2.json();
            setTemplates(data2.templates || []);
          }
        }
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/templates");
        const data = await res.json();
        if (!active) return;
        let finalTemplates = data.templates || [];
        if (finalTemplates.length === 0) {
          const seedRes = await fetch("/api/templates/seed", { method: "POST" });
          if (seedRes.ok) {
            const seedData = await seedRes.json();
            if (seedData.seeded) {
              const res2 = await fetch("/api/templates");
              const data2 = await res2.json();
              finalTemplates = data2.templates || [];
            }
          }
        }
        if (active) { setTemplates(finalTemplates); setLoading(false); }
      } catch {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const startEdit = (t: TaskTemplate) => {
    setEditingTemplateId(t.id);
    setShowCreateForm(false);
    setTemplateForm({
      name: t.name, nameCn: t.nameCn || "",
      description: t.description || "", descriptionCn: t.descriptionCn || "",
      bountyUsd: t.bountyUsd || "", bountyRmb: t.bountyRmb || "",
      bonusBountyUsd: t.bonusBountyUsd || "", bonusBountyRmb: t.bonusBountyRmb || "",
      maxAttempts: String(t.maxAttempts), checklistItems: (t.checklist || []).map(c => c.label),
      newChecklistItem: "",
      selfChecklistItems: (t.selfChecklist || []).map((c: { label: string }) => c.label),
      newSelfChecklistItem: "",
      deliverableSlots: t.deliverableSlots || [],
    });
    setFormError("");
  };

  const startCreate = () => {
    setShowCreateForm(true);
    setEditingTemplateId(null);
    setTemplateForm(emptyForm);
    setFormError("");
  };

  const saveTemplate = async () => {
    const isCreate = showCreateForm;
    if (isCreate && !templateForm.name) {
      setFormError(ta("nameRequired"));
      return;
    }
    setSaving(true);
    setFormError("");

    const payload = {
      name: templateForm.name, nameCn: templateForm.nameCn || null,
      category: detectCategoryFromSlots(templateForm.deliverableSlots),
      description: templateForm.description || null,
      descriptionCn: templateForm.descriptionCn || null,
      bountyUsd: templateForm.bountyUsd || null,
      bountyRmb: templateForm.bountyRmb || null,
      bonusBountyUsd: templateForm.bonusBountyUsd || null,
      bonusBountyRmb: templateForm.bonusBountyRmb || null,
      maxAttempts: parseInt(templateForm.maxAttempts) || 5,
      checklist: templateForm.checklistItems.length > 0 ? templateForm.checklistItems.map(l => ({ label: l })) : null,
      selfChecklist: templateForm.selfChecklistItems.length > 0 ? templateForm.selfChecklistItems.map(l => ({ label: l })) : null,
      deliverableSlots: templateForm.deliverableSlots.length > 0 ? templateForm.deliverableSlots : null,
    };

    const url = isCreate ? "/api/templates" : `/api/templates/${editingTemplateId}`;
    const method = isCreate ? "POST" : "PATCH";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      setEditingTemplateId(null);
      setShowCreateForm(false);
      setTemplateForm(emptyForm);
      fetchTemplates();
    } else {
      const data = await res.json();
      setFormError(data.error || ta("failedToSave"));
    }
    setSaving(false);
  };

  const deleteTemplate = async (id: string) => {
    setDeletingTemplateId(id);
    await fetch(`/api/templates/${id}`, { method: "DELETE" });
    if (editingTemplateId === id) setEditingTemplateId(null);
    fetchTemplates();
    setDeletingTemplateId(null);
  };

  const [cloningTemplateId, setCloningTemplateId] = useState<string | null>(null);
  const cloneTemplate = async (t: TaskTemplate) => {
    setCloningTemplateId(t.id);
    const res = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `${t.name} (copy)`,
        nameCn: t.nameCn ? `${t.nameCn} (copy)` : null,
        category: detectCategoryFromSlots(t.deliverableSlots || []),
        description: t.description, descriptionCn: t.descriptionCn,
        bountyUsd: t.bountyUsd, bountyRmb: t.bountyRmb,
        bonusBountyUsd: t.bonusBountyUsd, bonusBountyRmb: t.bonusBountyRmb,
        maxAttempts: t.maxAttempts, checklist: t.checklist,
        selfChecklist: t.selfChecklist, deliverableSlots: t.deliverableSlots,
      }),
    });
    if (res.ok) fetchTemplates();
    setCloningTemplateId(null);
  };

  const applyTemplate = (t: TaskTemplate) => {
    pendingApplyTemplate = {
      name: t.name, nameCn: t.nameCn,
      description: t.description, descriptionCn: t.descriptionCn,
      bountyUsd: t.bountyUsd, bountyRmb: t.bountyRmb,
      bonusBountyUsd: t.bonusBountyUsd, bonusBountyRmb: t.bonusBountyRmb,
      maxAttempts: t.maxAttempts, checklist: t.checklist,
      selfChecklist: t.selfChecklist, deliverableSlots: t.deliverableSlots,
      attachments: t.attachments,
    };
    navigateTo("admin-tasks");
  };

  // Shared form UI for both create and edit
  const renderTemplateForm = () => (
    <div className="mb-6 p-4 bg-discord-bg-dark rounded-xl border border-discord-bg-darker/60">
      <h3 className="text-sm font-semibold text-discord-text mb-3 uppercase">
        {showCreateForm ? ta("newTemplate") : ta("editTemplate")}
      </h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <label className="text-xs text-discord-text-muted">{ta("templateName")}</label>
            <TranslateButton sourceText={templateForm.nameCn} from="zh" onTranslated={(v) => setTemplateForm({ ...templateForm, name: v })} context="task template name — keep it short" />
          </div>
          <input value={templateForm.name} onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })} className="w-full p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none" placeholder="e.g. Voiceover Recording" />
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <label className="text-xs text-discord-text-muted">{ta("nameCn")}</label>
            <TranslateButton sourceText={templateForm.name} from="en" onTranslated={(v) => setTemplateForm({ ...templateForm, nameCn: v })} context="task template name — keep it short" />
          </div>
          <input value={templateForm.nameCn} onChange={(e) => setTemplateForm({ ...templateForm, nameCn: e.target.value })} className="w-full p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none" placeholder="中文模板名称" />
        </div>
        <div>
          {(() => {
            const cat = detectCategoryFromSlots(templateForm.deliverableSlots);
            const style = TEMPLATE_ICONS[cat] || TEMPLATE_ICONS.other;
            return (
              <>
                <label className="block text-xs text-discord-text-muted mb-1">{ta("categoryAutoDetected")}</label>
                <div className="w-full p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text flex items-center gap-2">
                  <span>{style.icon}</span>
                  <span className="capitalize">{cat}</span>
                  <span className="text-[10px] text-discord-text-muted ml-auto">{ta("basedOnDeliverables")}</span>
                </div>
              </>
            );
          })()}
        </div>
        <div>
          <label className="block text-xs text-discord-text-muted mb-1">{ta("maxAttempts")}</label>
          <input type="number" min="1" value={templateForm.maxAttempts} onChange={(e) => setTemplateForm({ ...templateForm, maxAttempts: e.target.value })} className="w-full p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none" />
        </div>
        <div className="col-span-2">
          <div className="flex items-center gap-2 mb-1">
            <label className="text-xs text-discord-text-muted">{ta("descriptionEnLabel")}</label>
            <TranslateButton sourceText={templateForm.descriptionCn} from="zh" onTranslated={(v) => setTemplateForm({ ...templateForm, description: v })} context="task template description — may contain Markdown" />
          </div>
          <textarea value={templateForm.description} onChange={(e) => setTemplateForm({ ...templateForm, description: e.target.value })} rows={3} className="w-full p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none resize-none" placeholder="Task requirements and instructions (Markdown)..." />
        </div>
        <div className="col-span-2">
          <div className="flex items-center gap-2 mb-1">
            <label className="text-xs text-discord-text-muted">{ta("descriptionCnLabel")}</label>
            <TranslateButton sourceText={templateForm.description} from="en" onTranslated={(v) => setTemplateForm({ ...templateForm, descriptionCn: v })} context="task template description — may contain Markdown" />
          </div>
          <textarea value={templateForm.descriptionCn} onChange={(e) => setTemplateForm({ ...templateForm, descriptionCn: e.target.value })} rows={3} className="w-full p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none resize-none" placeholder="中文任务说明 (支持 Markdown)..." />
        </div>
        <div>
          <label className="block text-xs text-discord-text-muted mb-1">{ta("bountyUsd")}</label>
          <input value={templateForm.bountyUsd} onChange={(e) => setTemplateForm({ ...templateForm, bountyUsd: e.target.value })} onKeyDown={(e) => { if (e.key.length === 1 && !/[\d.,]/.test(e.key)) e.preventDefault(); }} placeholder="25.00" className="w-full p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none" />
        </div>
        <div>
          <label className="block text-xs text-discord-text-muted mb-1">{ta("bountyRmb")}</label>
          <input value={templateForm.bountyRmb} onChange={(e) => setTemplateForm({ ...templateForm, bountyRmb: e.target.value })} onKeyDown={(e) => { if (e.key.length === 1 && !/[\d.,]/.test(e.key)) e.preventDefault(); }} placeholder="178.00" className="w-full p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none" />
        </div>
        <div>
          <label className="block text-xs text-discord-text-muted mb-1">{ta("bonusUsd")}</label>
          <input value={templateForm.bonusBountyUsd} onChange={(e) => setTemplateForm({ ...templateForm, bonusBountyUsd: e.target.value })} onKeyDown={(e) => { if (e.key.length === 1 && !/[\d.,]/.test(e.key)) e.preventDefault(); }} placeholder="35.00" className="w-full p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none" />
        </div>
        <div>
          <label className="block text-xs text-discord-text-muted mb-1">{ta("bonusRmb")}</label>
          <input value={templateForm.bonusBountyRmb} onChange={(e) => setTemplateForm({ ...templateForm, bonusBountyRmb: e.target.value })} onKeyDown={(e) => { if (e.key.length === 1 && !/[\d.,]/.test(e.key)) e.preventDefault(); }} className="w-full p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none" />
        </div>
        {/* Checklist */}
        <div className="col-span-2">
          <label className="block text-xs text-discord-text-muted mb-1">{ta("reviewChecklistLabel")}</label>
          {templateForm.checklistItems.length > 0 && (
            <div className="space-y-1 mb-2">
              {templateForm.checklistItems.map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-green-400">✓</span>
                  <span className="flex-1 text-sm text-discord-text">{item}</span>
                  <button type="button" onClick={() => setTemplateForm({ ...templateForm, checklistItems: templateForm.checklistItems.filter((_, idx) => idx !== i) })} className="text-red-400 hover:text-red-300 text-xs">✕</button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              value={templateForm.newChecklistItem}
              onChange={(e) => setTemplateForm({ ...templateForm, newChecklistItem: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && templateForm.newChecklistItem.trim()) {
                  e.preventDefault();
                  setTemplateForm({ ...templateForm, checklistItems: [...templateForm.checklistItems, templateForm.newChecklistItem.trim()], newChecklistItem: "" });
                }
              }}
              placeholder="e.g. Audio quality meets requirements"
              className="flex-1 p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none"
            />
            <button
              type="button"
              onClick={() => {
                if (templateForm.newChecklistItem.trim()) {
                  setTemplateForm({ ...templateForm, checklistItems: [...templateForm.checklistItems, templateForm.newChecklistItem.trim()], newChecklistItem: "" });
                }
              }}
              className="px-3 py-1.5 text-xs bg-discord-accent/20 text-discord-accent rounded hover:bg-discord-accent/30 transition"
            >
              {ta("addItem")}
            </button>
          </div>
        </div>
        {/* Deliverable Slots */}
        <div className="col-span-2">
          <DeliverableSlotEditor
            slots={templateForm.deliverableSlots}
            onChange={(slots) => setTemplateForm({ ...templateForm, deliverableSlots: slots })}
            allowEmpty
          />
        </div>

        {/* Self-Checklist (creator guidance) */}
        <div className="col-span-2">
          <label className="block text-xs text-discord-text-muted mb-1">{ta("selfChecklistLabel")}</label>
          <p className="text-[10px] text-discord-text-muted mb-1.5">{ta("selfChecklistTemplateDesc")}</p>
          {templateForm.selfChecklistItems.length > 0 && (
            <div className="space-y-1 mb-2">
              {templateForm.selfChecklistItems.map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-sky-400">•</span>
                  <span className="flex-1 text-sm text-discord-text">{item}</span>
                  <button type="button" onClick={() => setTemplateForm({ ...templateForm, selfChecklistItems: templateForm.selfChecklistItems.filter((_, idx) => idx !== i) })} className="text-red-400 hover:text-red-300 text-xs">✕</button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              value={templateForm.newSelfChecklistItem}
              onChange={(e) => setTemplateForm({ ...templateForm, newSelfChecklistItem: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && templateForm.newSelfChecklistItem.trim()) {
                  e.preventDefault();
                  setTemplateForm({ ...templateForm, selfChecklistItems: [...templateForm.selfChecklistItems, templateForm.newSelfChecklistItem.trim()], newSelfChecklistItem: "" });
                }
              }}
              placeholder="e.g. No background noise, clear pronunciation"
              className="flex-1 p-2 bg-discord-bg border border-discord-border rounded text-sm text-discord-text focus:outline-none"
            />
            <button
              type="button"
              onClick={() => {
                if (templateForm.newSelfChecklistItem.trim()) {
                  setTemplateForm({ ...templateForm, selfChecklistItems: [...templateForm.selfChecklistItems, templateForm.newSelfChecklistItem.trim()], newSelfChecklistItem: "" });
                }
              }}
              className="px-3 py-1.5 text-xs bg-sky-500/20 text-sky-400 rounded hover:bg-sky-500/30 transition"
            >
              {ta("addItem")}
            </button>
          </div>
        </div>
      </div>
      {formError && <p className="text-xs text-discord-red mt-2">{formError}</p>}
      <div className="flex gap-2 mt-3">
        <button onClick={saveTemplate} disabled={saving} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-semibold transition disabled:opacity-50 flex items-center gap-1">
          <ButtonSpinner loading={saving}>{showCreateForm ? ta("createTemplate") : ta("saveChanges")}</ButtonSpinner>
        </button>
        <button onClick={() => { setShowCreateForm(false); setEditingTemplateId(null); setTemplateForm(emptyForm); }} className="px-4 py-2 bg-discord-bg-hover text-discord-text-muted rounded text-sm transition hover:text-discord-text">
          {ta("cancel")}
        </button>
      </div>
    </div>
  );

  if (loading) return <div className="text-discord-text-muted text-sm">{ta("loadingTemplates")}</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <SectionTitle>{ta("taskTemplates")}</SectionTitle>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              if (!confirm(ta("resetConfirm"))) return;
              setLoading(true);
              await fetch("/api/templates/seed", { method: "DELETE" });
              fetchTemplates();
            }}
            className="px-3 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg text-xs font-semibold transition"
          >
            {ta("resetToDefaults")}
          </button>
          <button
            onClick={() => showCreateForm ? setShowCreateForm(false) : startCreate()}
            className="px-4 py-2 bg-discord-accent hover:bg-discord-accent/80 text-white rounded-lg text-sm font-semibold transition"
          >
            {showCreateForm ? ta("cancel") : ta("createTemplateBtn")}
          </button>
        </div>
      </div>

      {/* Create / Edit form */}
      {(showCreateForm || editingTemplateId) && renderTemplateForm()}

      {/* Template list */}
      {templates.length === 0 ? (
        <p className="text-sm text-discord-text-muted text-center py-8">{ta("noTemplatesYet")}</p>
      ) : (
        <div className="space-y-3">
          {templates.map((t) => {
            const style = TEMPLATE_ICONS[t.category] || { icon: "📋", color: "text-gray-400", bg: "from-gray-500/10 to-gray-500/20" };
            const isEditing = editingTemplateId === t.id;

            return (
              <div key={t.id} className={`rounded-lg border border-discord-border bg-linear-to-br ${style.bg} overflow-hidden ${isEditing ? "ring-2 ring-discord-accent" : ""}`}>
                <div className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{style.icon}</span>
                    <div>
                      <h4 className="font-semibold text-discord-text">{t.name}</h4>
                      {t.nameCn && <p className="text-xs text-discord-text-muted">{t.nameCn}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex flex-wrap gap-1">
                      {t.bountyUsd && <span className="px-1.5 py-0.5 bg-green-500/20 text-green-300 text-[10px] rounded font-semibold">${t.bountyUsd}</span>}
                      {t.bountyRmb && <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-300 text-[10px] rounded font-semibold">¥{t.bountyRmb}</span>}
                      {t.checklist && <span className="px-1.5 py-0.5 bg-blue-500/20 text-blue-300 text-[10px] rounded font-semibold">{t.checklist.length} CHECKS</span>}
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => applyTemplate(t)}
                        className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs rounded font-semibold transition"
                      >
                        {ta("useTemplate")}
                      </button>
                      <button
                        onClick={() => isEditing ? setEditingTemplateId(null) : startEdit(t)}
                        className="px-3 py-1.5 bg-discord-accent/20 text-discord-accent text-xs rounded hover:bg-discord-accent/30 font-semibold transition"
                      >
                        {isEditing ? ta("cancelEdit") : ta("edit")}
                      </button>
                      <button
                        onClick={() => cloneTemplate(t)}
                        disabled={cloningTemplateId === t.id}
                        className="px-2 py-1.5 bg-sky-500/20 text-sky-400 text-xs rounded hover:bg-sky-500/30 transition disabled:opacity-50 flex items-center gap-1 font-semibold"
                      >
                        <ButtonSpinner loading={cloningTemplateId === t.id}>{ta("clone")}</ButtonSpinner>
                      </button>
                      <button
                        onClick={() => deleteTemplate(t.id)}
                        disabled={deletingTemplateId === t.id}
                        className="px-2 py-1.5 bg-red-500/20 text-red-400 text-xs rounded hover:bg-red-500/30 transition disabled:opacity-50 flex items-center gap-1"
                      >
                        <ButtonSpinner loading={deletingTemplateId === t.id}>{ta("delete")}</ButtonSpinner>
                      </button>
                    </div>
                  </div>
                </div>
                {/* Summary */}
                <div className="px-4 pb-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-xs text-discord-text-muted mb-1">{ta("descriptionPreview")}</p>
                      <p className="text-discord-text-secondary text-xs line-clamp-3">{t.description || ta("noDescription")}</p>
                    </div>
                    <div>
                      <p className="text-xs text-discord-text-muted mb-1">{ta("reviewChecklistLabel")}</p>
                      {t.checklist && t.checklist.length > 0 ? (
                        <ul className="text-xs text-discord-text-secondary space-y-0.5">
                          {t.checklist.slice(0, 4).map((c, i) => (
                            <li key={i} className="flex items-center gap-1"><span className="text-green-400">✓</span> {c.label}</li>
                          ))}
                          {t.checklist.length > 4 && <li className="text-discord-text-muted">+{t.checklist.length - 4} more...</li>}
                        </ul>
                      ) : <p className="text-xs text-discord-text-muted">{ta("noChecklistItems")}</p>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Admin: Channels ──────────────────────────────────────────────────────────

function AdminChannelsSection() {
  const ta = useTranslations("admin");
  const tc = useTranslations("common");
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [modUsers, setModUsers] = useState<{ id: string; username: string; displayName: string | null; role: string }[]>([]);
  const [channelList, setChannelList] = useState<ChannelItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form state
  const [name, setName] = useState("");
  const [nameCn, setNameCn] = useState("");
  const [type, setType] = useState<"task" | "discussion">("task");
  const [description, setDescription] = useState("");
  const [descriptionCn, setDescriptionCn] = useState("");
  const [requiredTagId, setRequiredTagId] = useState("");
  const [selectedMods, setSelectedMods] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createSuccess, setCreateSuccess] = useState("");
  const [createModDropdown, setCreateModDropdown] = useState("");

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editNameCn, setEditNameCn] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDescriptionCn, setEditDescriptionCn] = useState("");
  const [editRequiredTagId, setEditRequiredTagId] = useState("");
  const [editMods, setEditMods] = useState<string[]>([]);
  const [editModDropdown, setEditModDropdown] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Members modal state
  const [membersChannelId, setMembersChannelId] = useState<string | null>(null);
  const [membersTagId, setMembersTagId] = useState<string | null>(null);
  const [membersNoTag, setMembersNoTag] = useState(false);
  const [members, setMembers] = useState<{ id: string; username: string; displayName: string | null; role: string; isMod?: boolean }[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [revokingUserId, setRevokingUserId] = useState<string | null>(null);

  // Show/hide create form
  const [showCreate, setShowCreate] = useState(false);

  const fetchChannels = async () => {
    try {
      const res = await fetch("/api/channels");
      const data = await res.json();
      setChannelList(data.channels || []);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/tags").then((r) => r.json()),
      fetch("/api/admin/users").then((r) => r.json()),
      fetch("/api/channels").then((r) => r.json()),
    ])
      .then(([tagData, userData, channelData]) => {
        setAllTags(tagData.tags || []);
        setModUsers((userData.users || []).filter((u: { role: string }) => ["mod", "supermod", "admin"].includes(u.role)));
        setChannelList(channelData.channels || []);
      })
      .catch(() => { })
      .finally(() => setLoading(false));
  }, []);

  const handleCreate = async () => {
    if (!name || !type) { setCreateError(ta("nameAndTypeRequired")); return; }
    setCreating(true); setCreateError(""); setCreateSuccess("");

    const res = await fetch("/api/admin/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name, type,
        nameCn: nameCn || undefined,
        description: description || undefined,
        descriptionCn: descriptionCn || undefined,
        requiredTagId: requiredTagId || undefined,
        modUserIds: selectedMods.length > 0 ? selectedMods : undefined,
      }),
    });

    if (res.ok) {
      setCreateSuccess(ta("channelCreated", { name }));
      setName(""); setNameCn(""); setDescription(""); setDescriptionCn("");
      setRequiredTagId(""); setSelectedMods([]);
      await fetchChannels();
      window.dispatchEvent(new Event("channels-updated"));
    } else {
      const data = await res.json();
      setCreateError(data.error || ta("failedCreateChannel"));
    }
    setCreating(false);
  };

  const startEdit = async (ch: ChannelItem) => {
    setEditingId(ch.id);
    setEditName(ch.name);
    setEditNameCn(ch.nameCn || "");
    setEditDescription(ch.description || "");
    setEditDescriptionCn(ch.descriptionCn || "");
    setEditRequiredTagId(ch.requiredTagId || "");
    setEditError("");

    // Fetch mods for this channel directly (can't rely on stale state)
    try {
      const res = await fetch(`/api/admin/channels/${ch.id}/mods`);
      const data = await res.json();
      const mods: ChannelMod[] = data.mods || [];
      setEditMods(mods.map((m) => m.id));
    } catch { setEditMods([]); }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditError("");
  };

  const handleSaveEdit = async (ch: ChannelItem) => {
    setSaving(true); setEditError("");

    // Save channel details and mod assignments in parallel — neither should block the other
    const [res, modRes] = await Promise.all([
      fetch(`/api/admin/channels/${ch.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName,
          nameCn: editNameCn || null,
          description: editDescription || null,
          descriptionCn: editDescriptionCn || null,
          requiredTagId: editRequiredTagId || null,
        }),
      }),
      fetch(`/api/admin/channels/${ch.id}/mods`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modUserIds: editMods }),
      }),
    ]);

    const errors: string[] = [];
    if (!res.ok) {
      const data = await res.json();
      errors.push(data.error || ta("failedUpdateChannel"));
    }
    if (!modRes.ok) {
      const data = await modRes.json();
      errors.push(data.error || ta("failedUpdateMods"));
    }

    if (errors.length > 0) {
      setEditError(errors.join("; "));
      setSaving(false);
      return;
    }

    await fetchChannels();
    window.dispatchEvent(new Event("channels-updated"));
    setEditingId(null);
    setSaving(false);
  };

  const [deleteError, setDeleteError] = useState("");

  const handleDelete = async (channelId: string) => {
    setDeleting(true);
    setDeleteError("");
    try {
      const res = await fetch(`/api/admin/channels/${channelId}`, { method: "DELETE" });
      if (res.ok) {
        await fetchChannels();
        window.dispatchEvent(new Event("channels-updated"));
        setDeletingId(null);
      } else {
        const data = await res.json().catch(() => ({}));
        setDeleteError(data.error || `Delete failed (${res.status})`);
      }
    } catch {
      setDeleteError(ta("networkError"));
    }
    setDeleting(false);
  };

  const openMembers = async (channelId: string) => {
    setMembersChannelId(channelId);
    setMembersLoading(true);
    setMembersNoTag(false);
    setMembers([]);
    try {
      const res = await fetch(`/api/admin/channels/${channelId}/members`);
      const data = await res.json();
      if (data.noTag) {
        setMembersNoTag(true);
      } else {
        setMembers(data.members || []);
        setMembersTagId(data.tagId || null);
      }
    } catch { /* ignore */ }
    setMembersLoading(false);
  };

  const revokeTag = async (userId: string) => {
    if (!membersTagId) return;
    setRevokingUserId(userId);
    try {
      const res = await fetch("/api/admin/users/tags", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, tagId: membersTagId }),
      });
      if (res.ok) {
        setMembers((prev) => prev.filter((m) => m.id !== userId));
      }
    } catch { /* ignore */ }
    setRevokingUserId(null);
  };

  if (loading) return <div className="text-discord-text-muted text-sm">{ta("loading")}</div>;

  const grouped = {
    special: channelList.filter((c) => c.type === "special"),
    task: channelList.filter((c) => c.type === "task"),
    discussion: channelList.filter((c) => c.type === "discussion"),
  };

  const getTagName = (tagId: string | null) => {
    if (!tagId) return null;
    const tag = allTags.find((t) => t.id === tagId);
    return tag ? tag.name : null;
  };

  const TYPE_BADGE: Record<string, string> = {
    special: "bg-yellow-500/20 text-yellow-300",
    task: "bg-blue-500/20 text-blue-300",
    discussion: "bg-green-500/20 text-green-300",
  };

  const inputCls = "w-full p-2 bg-discord-bg-dark border border-discord-border rounded text-sm text-discord-text focus:outline-none focus:ring-2 focus:ring-discord-accent";

  const availableCreateMods = modUsers.filter((u) => !selectedMods.includes(u.id));

  return (
    <div>
      <SectionTitle>{ta("channelsTitle")}</SectionTitle>

      {/* ── Create New Channel (top) ── */}
      <div className="mb-6">
        <button
          onClick={() => { setShowCreate(!showCreate); setCreateError(""); setCreateSuccess(""); }}
          className="px-4 py-2 bg-discord-accent hover:bg-discord-accent/80 text-white rounded-lg text-sm font-semibold transition flex items-center gap-2"
        >
          <span className="text-lg leading-none">{showCreate ? "−" : "+"}</span>
          {ta("createNewChannel")}
        </button>

        {showCreate && (
          <div className="mt-4 p-5 bg-discord-bg-dark rounded-lg border border-discord-border space-y-4">
            <h3 className="text-sm font-bold text-discord-text">{ta("createNewChannel")}</h3>
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg px-4 py-2">
              <p className="text-xs text-blue-300">{ta("channelNote")}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <label className="text-xs font-medium text-discord-text-muted">{ta("channelNameEn")}</label>
                  <TranslateButton sourceText={nameCn} from="zh" onTranslated={setName} context="channel name — keep it short, like a Discord channel name" />
                </div>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="#channel-name" className={inputCls} />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <label className="text-xs font-medium text-discord-text-muted">{ta("channelNameCn")}</label>
                  <TranslateButton sourceText={name} from="en" onTranslated={setNameCn} context="channel name — keep it short, like a Discord channel name" />
                </div>
                <input value={nameCn} onChange={(e) => setNameCn(e.target.value)} placeholder="#频道名称" className={inputCls} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-discord-text-muted mb-1">{ta("channelType")}</label>
                <select value={type} onChange={(e) => setType(e.target.value as "task" | "discussion")} className={inputCls}>
                  <option value="task">{ta("task")}</option>
                  <option value="discussion">{ta("discussion")}</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {(type === "task" || type === "discussion") && (
                <div>
                  <label className="block text-xs font-medium text-discord-text-muted mb-1">{ta("requiredTag")}</label>
                  <select value={requiredTagId} onChange={(e) => setRequiredTagId(e.target.value)} className={inputCls}>
                    <option value="">{ta("none")}</option>
                    {allTags.map((tag) => (<option key={tag.id} value={tag.id}>{tag.name} {tag.nameCn ? `(${tag.nameCn})` : ""}</option>))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-discord-text-muted mb-1">{ta("assignedMods")}</label>
                <div className="flex items-center gap-2">
                  <select
                    value={createModDropdown}
                    onChange={(e) => setCreateModDropdown(e.target.value)}
                    className={inputCls + " flex-1"}
                  >
                    <option value="">{ta("selectModToAdd")}</option>
                    {availableCreateMods.map((u) => (
                      <option key={u.id} value={u.id}>{u.displayName || u.username} ({u.role})</option>
                    ))}
                  </select>
                  <button
                    onClick={() => { if (createModDropdown) { setSelectedMods((prev) => [...prev, createModDropdown]); setCreateModDropdown(""); } }}
                    disabled={!createModDropdown}
                    className="px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-bold transition disabled:opacity-30"
                  >+</button>
                </div>
                {selectedMods.length > 0 && (
                  <div className="space-y-1 mt-2">
                    {selectedMods.map((modId) => {
                      const u = modUsers.find((m) => m.id === modId);
                      if (!u) return null;
                      return (
                        <div key={modId} className="flex items-center justify-between bg-discord-bg border border-discord-border rounded px-3 py-1.5">
                          <span className="text-sm text-discord-text">{u.displayName || u.username} <RoleBadge role={u.role} /></span>
                          <button onClick={() => setSelectedMods((prev) => prev.filter((id) => id !== modId))} className="text-discord-red hover:text-discord-red/80 text-lg font-bold leading-none">&times;</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <label className="text-xs font-medium text-discord-text-muted">{ta("descriptionEnLabel")}</label>
                  <TranslateButton sourceText={descriptionCn} from="zh" onTranslated={setDescription} context="channel description" />
                </div>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Channel description..." className={inputCls + " resize-y"} />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <label className="text-xs font-medium text-discord-text-muted">{ta("descriptionCnLabel")}</label>
                  <TranslateButton sourceText={description} from="en" onTranslated={setDescriptionCn} context="channel description" />
                </div>
                <textarea value={descriptionCn} onChange={(e) => setDescriptionCn(e.target.value)} rows={3} placeholder="频道描述..." className={inputCls + " resize-y"} />
              </div>
            </div>
            {createError && <p className="text-sm text-discord-red">{createError}</p>}
            {createSuccess && <p className="text-sm text-green-400">{createSuccess}</p>}
            <div className="flex items-center gap-3">
              <button onClick={handleCreate} disabled={creating} className="px-5 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-50 flex items-center gap-1">
                <ButtonSpinner loading={creating}>{ta("saveChannel")}</ButtonSpinner>
              </button>
              <button onClick={() => setShowCreate(false)} className="text-sm text-discord-text-muted hover:text-discord-text transition">{ta("cancel")}</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Channel List ── */}
      {(["special", "task", "discussion"] as const).map((cType) => (
        <div key={cType} className="mb-6">
          <h3 className="text-xs font-bold text-discord-text-muted uppercase tracking-wider mb-2">
            {ta(`${cType}Channels` as "specialChannels" | "taskChannels" | "discussionChannels")} ({grouped[cType].length})
          </h3>
          {grouped[cType].length === 0 && (
            <p className="text-xs text-discord-text-muted italic">{ta("noChannelsOfType", { type: cType })}</p>
          )}
          <div className="space-y-2">
            {grouped[cType].map((ch) => (
              <div key={ch.id} className="bg-discord-bg-dark rounded-lg border border-discord-border">
                {/* Channel row */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <span className="text-discord-text font-medium text-sm">#{ch.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${TYPE_BADGE[ch.type] || ""}`}>{ch.type}</span>
                  {ch.requiredTagId && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300">
                      Tag: {getTagName(ch.requiredTagId)}
                    </span>
                  )}
                  {ch.description && (
                    <span className="text-xs text-discord-text-muted truncate max-w-[200px]">{ch.description}</span>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    {ch.requiredTagId && (
                      <button
                        onClick={() => openMembers(ch.id)}
                        className="text-xs text-purple-400 hover:text-purple-300 transition"
                      >
                        {ta("members")}
                      </button>
                    )}
                    {!ch.isFixed && (
                      <>
                        <button
                          onClick={() => editingId === ch.id ? cancelEdit() : startEdit(ch)}
                          className="text-xs text-discord-accent hover:text-discord-accent/80 transition"
                        >
                          {editingId === ch.id ? ta("cancel") : ta("edit")}
                        </button>
                        <button
                          onClick={() => setDeletingId(deletingId === ch.id ? null : ch.id)}
                          className="text-xs text-discord-red hover:text-discord-red/80 transition"
                        >
                          {ta("delete")}
                        </button>
                      </>
                    )}
                    {ch.isFixed && (
                      <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-label="Fixed channel — cannot edit or delete">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                    )}
                  </div>
                </div>

                {/* Edit form */}
                {editingId === ch.id && (
                  <div className="px-4 pb-4 border-t border-discord-border pt-3 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <label className="text-xs text-discord-text-muted">{ta("nameEn")}</label>
                          <TranslateButton sourceText={editNameCn} from="zh" onTranslated={setEditName} context="channel name — keep it short" />
                        </div>
                        <input value={editName} onChange={(e) => setEditName(e.target.value)} className={inputCls} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <label className="text-xs text-discord-text-muted">{ta("nameCn")}</label>
                          <TranslateButton sourceText={editName} from="en" onTranslated={setEditNameCn} context="channel name — keep it short" />
                        </div>
                        <input value={editNameCn} onChange={(e) => setEditNameCn(e.target.value)} className={inputCls} />
                      </div>
                    </div>
                    {(ch.type === "task" || ch.type === "discussion") && (
                      <div>
                        <label className="block text-xs text-discord-text-muted mb-1">{ta("requiredTag")}</label>
                        <select value={editRequiredTagId} onChange={(e) => setEditRequiredTagId(e.target.value)} className={inputCls}>
                          <option value="">{ta("noTagRequired")}</option>
                          {allTags.map((tag) => (
                            <option key={tag.id} value={tag.id}>{tag.name} {tag.nameCn ? `(${tag.nameCn})` : ""}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <label className="text-xs text-discord-text-muted">{ta("descriptionEnLabel")}</label>
                          <TranslateButton sourceText={editDescriptionCn} from="zh" onTranslated={setEditDescription} context="channel description" />
                        </div>
                        <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={2} className={inputCls + " resize-none"} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <label className="text-xs text-discord-text-muted">{ta("descriptionCnLabel")}</label>
                          <TranslateButton sourceText={editDescription} from="en" onTranslated={setEditDescriptionCn} context="channel description" />
                        </div>
                        <textarea value={editDescriptionCn} onChange={(e) => setEditDescriptionCn(e.target.value)} rows={2} className={inputCls + " resize-none"} />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-discord-text-muted mb-1">{ta("assignedMods")}</label>
                      <div className="flex items-center gap-2 mb-2">
                        <select
                          value={editModDropdown}
                          onChange={(e) => setEditModDropdown(e.target.value)}
                          className={inputCls + " flex-1"}
                        >
                          <option value="">{ta("selectModToAdd")}</option>
                          {modUsers.filter((u) => !editMods.includes(u.id)).map((u) => (
                            <option key={u.id} value={u.id}>{u.displayName || u.username} ({u.role})</option>
                          ))}
                        </select>
                        <button
                          onClick={() => { if (editModDropdown) { setEditMods((prev) => [...prev, editModDropdown]); setEditModDropdown(""); } }}
                          disabled={!editModDropdown}
                          className="px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-bold transition disabled:opacity-30"
                        >+</button>
                      </div>
                      {editMods.length > 0 && (
                        <div className="space-y-1">
                          {editMods.map((modId) => {
                            const u = modUsers.find((m) => m.id === modId);
                            if (!u) return null;
                            return (
                              <div key={modId} className="flex items-center justify-between bg-discord-bg border border-discord-border rounded px-3 py-1.5">
                                <span className="text-sm text-discord-text">{u.displayName || u.username} <RoleBadge role={u.role} /></span>
                                <button onClick={() => setEditMods((prev) => prev.filter((id) => id !== modId))} className="text-discord-red hover:text-discord-red/80 text-lg font-bold leading-none">&times;</button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {editError && <p className="text-sm text-discord-red">{editError}</p>}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleSaveEdit(ch)}
                        disabled={saving}
                        className="px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-semibold transition disabled:opacity-50 flex items-center gap-1"
                      >
                        <ButtonSpinner loading={saving}>{ta("saveChanges")}</ButtonSpinner>
                      </button>
                      <button onClick={cancelEdit} className="text-xs text-discord-text-muted hover:text-discord-text transition">
                        {ta("cancel")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Delete channel confirmation modal */}
      <ConfirmDialog
        open={!!deletingId}
        onClose={() => { setDeletingId(null); setDeleteError(""); }}
        onConfirm={() => { if (deletingId) handleDelete(deletingId); }}
        title={ta("deleteChannel")}
        confirmText={ta("delete")}
        variant="danger"
        loading={deleting}
      >
        <p>
          {ta("deleteChannelConfirm")}{" "}
          <span className="font-semibold text-discord-text">#{channelList.find((c) => c.id === deletingId)?.name}</span>
          {" "}{ta("deleteChannelWarning")}
        </p>
        {deleteError && <p className="mt-2 text-sm text-discord-red">{deleteError}</p>}
      </ConfirmDialog>

      {/* Members modal */}
      {membersChannelId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setMembersChannelId(null)}>
          <div className="bg-discord-bg-dark border border-discord-border rounded-lg w-full max-w-md max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-discord-border">
              <h3 className="text-sm font-bold text-discord-text">
                {ta("membersTitle", { name: channelList.find((c) => c.id === membersChannelId)?.name || "" })}
              </h3>
              <button onClick={() => setMembersChannelId(null)} className="text-discord-text-muted hover:text-discord-text text-lg leading-none">&times;</button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {membersLoading ? (
                <div className="flex justify-center py-8"><Spinner /></div>
              ) : membersNoTag ? (
                <p className="text-sm text-discord-text-muted">{ta("noRequiredTagDesc")}</p>
              ) : members.length === 0 ? (
                <p className="text-sm text-discord-text-muted">{ta("noUsersWithTag")}</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-discord-text-muted mb-3">{members.length} user{members.length !== 1 ? "s" : ""} with tag: <span className="text-purple-300 font-medium">{getTagName(membersTagId)}</span></p>
                  {members.map((m) => (
                    <div key={m.id} className="flex items-center justify-between bg-discord-bg border border-discord-border rounded px-4 py-2">
                      <span className="text-sm text-discord-text">
                        {m.displayName || m.username} <RoleBadge role={m.role} />
                        {m.isMod && <span className="ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">{ta("assignedMod")}</span>}
                      </span>
                      {!m.isMod && (
                        <button
                          onClick={() => revokeTag(m.id)}
                          disabled={revokingUserId === m.id}
                          className="px-3 py-1 bg-discord-red/20 text-discord-red hover:bg-discord-red/30 rounded text-xs font-medium transition disabled:opacity-50 flex items-center gap-1"
                        >
                          <ButtonSpinner loading={revokingUserId === m.id}>{ta("revokeTag")}</ButtonSpinner>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Admin: Audit ─────────────────────────────────────────────────────────────

interface AuditItem {
  taskId: string;
  taskTitle: string;
  taskStatus: string;
  channelName: string;
  channelSlug: string;
  bountyUsd: string | null;
  bountyRmb: string | null;
  approvedAt: string;
  attemptId: string;
  attemptUserId: string;
  attemptDeliverables: any;
  attemptCreatedAt: string;
  creatorUsername: string;
  creatorDisplayName: string | null;
}

function AdminAuditSection() {
  const ta = useTranslations("admin");
  const tc = useTranslations("common");
  const { user } = useAuth();
  const [items, setItems] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<AuditItem | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchItems = () => {
    fetch("/api/admin/audit")
      .then((r) => r.json())
      .then((data) => setItems(data.auditItems || []))
      .catch(() => { })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!["admin", "supermod"].includes(user?.role ?? "")) return;
    fetchItems();
  }, [user]);

  const handleReversal = async () => {
    if (!selectedItem || !reason.trim()) return;
    setSubmitting(true);
    const res = await fetch("/api/admin/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: selectedItem.taskId, attemptId: selectedItem.attemptId, reason }),
    });
    if (res.ok) { setSelectedItem(null); setReason(""); fetchItems(); }
    setSubmitting(false);
  };

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  if (!["admin", "supermod"].includes(user?.role ?? "")) {
    return <div className="text-discord-text-muted text-sm">{ta("noPermission")}</div>;
  }

  return (
    <div>
      <SectionTitle>{ta("auditTitle")}</SectionTitle>
      <p className="text-sm text-discord-text-muted mb-6 -mt-2">
        {ta("auditDesc")}
      </p>

      {loading ? (
        <p className="text-discord-text-muted text-sm">{ta("loading")}</p>
      ) : items.length === 0 ? (
        <div className="text-center text-discord-text-muted py-12">
          <svg className="w-8 h-8 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm">{ta("noApprovedTasks")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.attemptId} className="p-4 bg-discord-bg-dark rounded-xl border border-discord-bg-darker/40">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h4 className="font-semibold text-discord-text text-sm">{item.taskTitle}</h4>
                  <p className="text-xs text-discord-text-muted">
                    #{item.channelName} — by {item.creatorDisplayName || item.creatorUsername} — Approved {formatDate(item.approvedAt)}
                  </p>
                </div>
                <span className="text-sm font-bold text-green-400">${item.bountyUsd || "0"} / ¥{item.bountyRmb || "0"}</span>
              </div>
              <div className="mb-3 p-3 bg-discord-bg rounded text-sm text-discord-text-secondary">
                {item.attemptDeliverables?.text ? (
                  <p className="whitespace-pre-wrap line-clamp-4">{item.attemptDeliverables.text}</p>
                ) : (
                  <p className="italic text-discord-text-muted">{JSON.stringify(item.attemptDeliverables)}</p>
                )}
              </div>
              {selectedItem?.attemptId === item.attemptId ? (
                <div className="space-y-2">
                  <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ta("reasonForReversal")} className="w-full p-2 bg-discord-bg border border-red-500/30 rounded text-sm text-discord-text placeholder-discord-text-muted focus:outline-none resize-none" rows={2} />
                  <div className="flex gap-2">
                    <button onClick={handleReversal} disabled={submitting || !reason.trim()} className="text-xs px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded font-semibold transition disabled:opacity-50 flex items-center gap-1">
                      <ButtonSpinner loading={submitting}>{ta("confirmReversal")}</ButtonSpinner>
                    </button>
                    <button onClick={() => { setSelectedItem(null); setReason(""); }} className="text-xs px-3 py-1.5 text-discord-text-muted hover:text-discord-text transition">
                      {ta("cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setSelectedItem(item)} className="text-xs px-3 py-1.5 bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded font-semibold transition border border-red-600/30">
                  {ta("reverseApproval")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Modal shell ───────────────────────────────────────────────────────────────

interface UserSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialSection?: Section;
}

export function UserSettingsModal({ isOpen, onClose, initialSection = "my-account" }: UserSettingsModalProps) {
  const { user, logout } = useAuth();
  const { navTick } = useSettingsModal();
  const ts = useTranslations("settings");
  const ta = useTranslations("admin");
  const tc = useTranslations("common");
  const [section, setSection] = useState<Section>(initialSection);
  const [prevSyncKey, setPrevSyncKey] = useState({ isOpen, initialSection, navTick });
  if (isOpen !== prevSyncKey.isOpen || initialSection !== prevSyncKey.initialSection || navTick !== prevSyncKey.navTick) {
    setPrevSyncKey({ isOpen, initialSection, navTick });
    if (isOpen) setSection(initialSection);
  }

  const [editingLessonId, setEditingLessonId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  if (!isOpen || !user) return null;

  const handleLogout = async () => {
    onClose();
    await logout(); // logout() handles redirect internally
  };

  type NavItem = { id: Section; label: string };

  const userItems: NavItem[] = [
    { id: "my-account", label: ts("myAccount") },
    { id: "profile", label: ts("profile") },
    { id: "account-settings", label: ts("accountSettings") },
  ];

  const adminItems: NavItem[] = [
    { id: "admin-overview", label: ta("overview") },
    { id: "admin-users", label: ta("users") },
    { id: "admin-invites", label: ta("inviteCodes") },
    { id: "admin-tags", label: ta("tagsLabel") },
    { id: "admin-tasks", label: ta("tasks") },
    { id: "admin-channels", label: ta("channels") },
    { id: "admin-training", label: ta("training") },
    { id: "admin-upload-reviews", label: ta("uploadReviews") },
  ];

  const supermodItems: NavItem[] = [
    { id: "admin-audit", label: ta("audit") },
  ];

  const NavBtn = ({ id, label }: NavItem) => (
    <button
      onClick={() => setSection(id)}
      className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors font-medium ${section === id
        ? "bg-discord-bg-hover text-discord-text"
        : "text-discord-text-muted hover:text-discord-text hover:bg-discord-bg-hover/50"
        }`}
    >
      {label}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ backgroundColor: "rgba(0,0,0,0.8)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative flex rounded-xl overflow-hidden shadow-2xl border border-white/5"
        style={{ width: "min(1140px, 96vw)", height: "min(780px, 94vh)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Left sidebar ── */}
        <div className="w-56 shrink-0 bg-discord-sidebar flex flex-col overflow-y-auto py-14 px-3">
          <div className="mb-5">
            <div className="px-3 mb-2 text-xs font-bold uppercase tracking-widest text-discord-text-muted">
              {tc("userSettings")}
            </div>
            {userItems.map((item) => <NavBtn key={item.id} {...item} />)}
          </div>

          {["admin", "supermod", "mod"].includes(user.role) && (
            <div className="mb-5">
              <div className="px-3 mb-2 text-xs font-bold uppercase tracking-widest text-discord-text-muted">
                {ta("adminSettings")}
              </div>
              {user.role === "admin" && adminItems.map((item) => <NavBtn key={item.id} {...item} />)}
              {user.role === "mod" && [{ id: "admin-tasks" as Section, label: ta("tasks") }, { id: "admin-upload-reviews" as Section, label: ta("uploadReviews") }].map((item) => <NavBtn key={item.id} {...item} />)}
              {user.role === "supermod" && [...adminItems, ...supermodItems].map((item) => <NavBtn key={item.id} {...item} />)}
              {user.role === "admin" && supermodItems.map((item) => <NavBtn key={item.id} {...item} />)}
            </div>
          )}

          {/* Log out */}
          <div className="mt-auto pt-4 border-t border-discord-bg-darker/60 px-1">
            <button
              onClick={handleLogout}
              className="w-full text-left px-3 py-2 rounded-md text-sm font-medium text-discord-red hover:bg-discord-red/10 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              {tc("logOut")}
            </button>
          </div>
        </div>

        {/* ── Right content ── */}
        <div className="flex-1 bg-discord-bg overflow-y-auto px-12 py-14">
          {section === "my-account" && <MyAccountSection />}
          {section === "profile" && <ProfileSection />}
          {section === "account-settings" && <AccountSettingsSection />}
          {section === "admin-overview" && <AdminOverviewSection />}
          {section === "admin-users" && <AdminUsersSection />}
          {section === "admin-invites" && <AdminInvitesSection />}
          {section === "admin-tags" && <AdminTagsSection />}
          {section === "admin-tasks" && <AdminTasksSection key={navTick} />}
          {section === "admin-channels" && <AdminChannelsSection />}
          {section === "admin-audit" && <AdminAuditSection />}
          {section === "admin-training" && !editingLessonId && (
            <AdminTrainingSection
              onOpenEditor={(id) => {
                setEditingLessonId(id);
                setSection("admin-training-editor");
              }}
            />
          )}
          {(section === "admin-training-editor" || (section === "admin-training" && editingLessonId)) && editingLessonId && (
            <LessonEditor
              lessonId={editingLessonId}
              onBack={() => {
                setEditingLessonId(null);
                setSection("admin-training");
              }}
              onNavigateToTags={() => {
                setEditingLessonId(null);
                setSection("admin-tags");
              }}
            />
          )}
          {section === "admin-upload-reviews" && <AdminUploadReviewSection />}
        </div>

        {/* ── X close button ── */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-9 h-9 rounded-full bg-discord-bg-dark hover:bg-discord-bg-darker flex items-center justify-center text-discord-text-muted hover:text-discord-text transition-colors border border-discord-bg-darker/60 shadow-sm"
          title={ta("closeEsc")}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
