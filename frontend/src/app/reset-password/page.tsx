"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Spinner } from "@/components/ui/Spinner";
import { useTranslations, useLocale } from "next-intl";
import { Suspense } from "react";

function ResetPasswordForm() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleToggleLocale = () => {
    const newLocale = locale === "en" ? "zh" : "en";
    document.cookie = `NEXT_LOCALE=${newLocale};path=/;max-age=${365 * 24 * 60 * 60};samesite=lax`;
    window.location.reload();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (password !== confirmPassword) {
      setError(t("passwordsDoNotMatch"));
      return;
    }

    if (password.length < 8) {
      setError(t("minPassword"));
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || t("resetFailed"));
      } else {
        setSuccess(data.message);
      }
    } catch {
      setError(tc("networkError"));
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-discord-bg-darker">
        <div className="w-full max-w-md">
          <div className="bg-discord-bg rounded-lg shadow-xl p-8 text-center">
            <p className="text-discord-text-secondary mb-4">{t("invalidResetLink")}</p>
            <Link href="/forgot-password" className="text-discord-accent hover:underline">
              {t("requestNewLink")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-discord-bg-darker">
      <div className="w-full max-w-md">
        <div className="bg-discord-bg rounded-lg shadow-xl p-8">
          <div className="text-center mb-8">
            <div className="flex justify-end mb-4">
              <button
                onClick={handleToggleLocale}
                className="flex items-center bg-discord-bg-dark border border-discord-border rounded-lg p-0.5"
              >
                <span className={`px-2 py-0.5 rounded text-xs font-semibold transition ${locale === "en" ? "bg-discord-accent text-white" : "text-discord-text-muted"}`}>
                  {tc("en")}
                </span>
                <span className={`px-2 py-0.5 rounded text-xs font-semibold transition ${locale === "zh" ? "bg-discord-accent text-white" : "text-discord-text-muted"}`}>
                  {tc("zh")}
                </span>
              </button>
            </div>
            <h1 className="text-2xl font-bold text-discord-text">{t("resetPassword")}</h1>
            <p className="text-sm text-discord-text-secondary mt-2">{t("resetPasswordSubtitle")}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 bg-discord-red/10 border border-discord-red/30 rounded-lg text-sm text-discord-red">
                {error}
              </div>
            )}
            {success && (
              <div className="p-3 bg-discord-green/10 border border-discord-green/30 rounded-lg text-sm text-discord-green">
                {success}
                <Link href="/login" className="block mt-2 text-discord-accent hover:underline">
                  {t("backToLogin")}
                </Link>
              </div>
            )}

            {!success && (
              <>
                <div>
                  <label className="block text-sm font-medium mb-2 text-discord-text-secondary uppercase tracking-wide">
                    {t("newPassword")}
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full p-3 bg-discord-bg-dark border border-discord-border rounded-lg text-discord-text text-sm focus:outline-none focus:border-discord-accent"
                    placeholder="••••••••"
                    minLength={8}
                    required
                  />
                  <p className="text-xs text-discord-text-muted mt-1">{t("minPassword")}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2 text-discord-text-secondary uppercase tracking-wide">
                    {t("confirmPassword")}
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full p-3 bg-discord-bg-dark border border-discord-border rounded-lg text-discord-text text-sm focus:outline-none focus:border-discord-accent"
                    placeholder="••••••••"
                    minLength={8}
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-discord-accent text-white rounded-lg font-medium hover:bg-discord-accent-hover transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                >
                  {loading ? <Spinner /> : null}
                  {t("resetPassword")}
                </button>
              </>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-discord-bg-darker">
        <Spinner />
      </div>
    }>
      <ResetPasswordForm />
    </Suspense>
  );
}
