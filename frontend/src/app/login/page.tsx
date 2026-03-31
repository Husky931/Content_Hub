"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Spinner } from "@/components/ui/Spinner";
import { useTranslations, useLocale } from "next-intl";

type LoginMethod = "email" | "phone";

export default function LoginPage() {
  const { login, refreshUser } = useAuth();
  const router = useRouter();
  const t = useTranslations("auth");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [method, setMethod] = useState<LoginMethod>("email");

  // Email fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Phone fields
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpCooldown, setOtpCooldown] = useState(0);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleMethodSwitch = (m: LoginMethod) => {
    setMethod(m);
    setError("");
  };

  const handleSendOtp = async () => {
    if (!phone || otpCooldown > 0) return;
    setOtpLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/send-login-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t("failedSendOtp"));
      } else {
        setOtpSent(true);
        setOtpCooldown(60);
        const timer = setInterval(() => {
          setOtpCooldown((prev) => {
            if (prev <= 1) { clearInterval(timer); return 0; }
            return prev - 1;
          });
        }, 1000);
      }
    } finally {
      setOtpLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (method === "email") {
      const result = await login(email, password);
      setLoading(false);
      if (result.error) {
        setError(result.error);
      } else {
        router.push("/channels");
      }
    } else {
      try {
        const res = await fetch("/api/auth/login-phone", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, otp }),
        });
        const data = await res.json();
        setLoading(false);
        if (!res.ok) {
          setError(data.error || t("loginFailed"));
        } else {
          await refreshUser();
          router.push("/channels");
        }
      } catch {
        setLoading(false);
        setError(t("networkError"));
      }
    }
  };

  const handleToggleLocale = () => {
    const newLocale = locale === "en" ? "zh" : "en";
    document.cookie = `NEXT_LOCALE=${newLocale};path=/;max-age=${365 * 24 * 60 * 60};samesite=lax`;
    window.location.reload();
  };

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
            <h1 className="text-2xl font-bold text-discord-text">{tn("creatorHub")}</h1>
            <p className="text-sm text-discord-text-secondary mt-2">{t("signInSubtitle")}</p>
          </div>

          {/* Method toggle */}
          <div className="flex justify-center mb-6">
            <div className="inline-flex items-center bg-discord-bg-dark border border-discord-border rounded-lg p-1">
              <button
                type="button"
                onClick={() => handleMethodSwitch("email")}
                className={`px-4 py-1.5 rounded text-xs font-semibold transition ${
                  method === "email"
                    ? "bg-discord-accent text-white"
                    : "text-discord-text-secondary hover:text-discord-text"
                }`}
              >
                {t("email")}
              </button>
              <button
                type="button"
                onClick={() => handleMethodSwitch("phone")}
                className={`px-4 py-1.5 rounded text-xs font-semibold transition ${
                  method === "phone"
                    ? "bg-discord-accent text-white"
                    : "text-discord-text-secondary hover:text-discord-text"
                }`}
              >
                {t("phoneChina")}
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 bg-discord-red/10 border border-discord-red/30 rounded-lg text-sm text-discord-red">
                {error}
              </div>
            )}

            {method === "email" ? (
              <>
                <div className="text-xs font-semibold text-discord-text-muted uppercase tracking-wider">
                  {t("emailPassword")}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2 text-discord-text-secondary uppercase tracking-wide">
                    {t("email")}
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full p-3 bg-discord-bg-dark border border-discord-border rounded-lg text-discord-text text-sm focus:outline-none focus:border-discord-accent"
                    placeholder="you@example.com"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2 text-discord-text-secondary uppercase tracking-wide">
                    {t("password")}
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full p-3 bg-discord-bg-dark border border-discord-border rounded-lg text-discord-text text-sm focus:outline-none focus:border-discord-accent"
                    placeholder="••••••••"
                    required
                  />
                  <div className="flex justify-end mt-1">
                    <Link href="/forgot-password" className="text-xs text-discord-accent hover:underline">
                      {t("forgotPassword")}
                    </Link>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="text-xs font-semibold text-discord-text-muted uppercase tracking-wider">
                  {t("phoneOtp")}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2 text-discord-text-secondary uppercase tracking-wide">
                    {t("phone")}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="flex-1 p-3 bg-discord-bg-dark border border-discord-border rounded-lg text-discord-text text-sm focus:outline-none focus:border-discord-accent"
                      placeholder="+86 138 0000 0000"
                      required
                    />
                    <button
                      type="button"
                      onClick={handleSendOtp}
                      disabled={!phone || otpCooldown > 0 || otpLoading}
                      className="px-3 py-2 bg-discord-bg-dark border border-discord-border text-discord-text-secondary rounded-lg text-sm hover:bg-discord-bg-darker transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 whitespace-nowrap"
                    >
                      {otpLoading ? <Spinner /> : null}
                      {otpCooldown > 0 ? `${otpCooldown}s` : otpSent ? t("resend") : t("sendOtp")}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2 text-discord-text-secondary uppercase tracking-wide">
                    {t("otpCode")}
                  </label>
                  <input
                    type="text"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    className="w-full p-3 bg-discord-bg-dark border border-discord-border rounded-lg text-discord-text text-sm font-mono tracking-widest focus:outline-none focus:border-discord-accent"
                    placeholder="123456"
                    maxLength={6}
                    required
                  />
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-discord-accent text-white rounded-lg font-medium hover:bg-discord-accent-hover transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
            >
              {loading ? <Spinner /> : null}
              {t("signIn")}
            </button>
          </form>

          <p className="text-center text-sm text-discord-text-muted mt-6">
            {t("noAccount")}{" "}
            <Link href="/signup" className="text-discord-accent hover:underline">
              {t("signUpWithInvite")}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
