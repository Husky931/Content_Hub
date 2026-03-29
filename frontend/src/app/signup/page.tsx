"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import Link from "next/link";
import { Spinner } from "@/components/ui/Spinner";
import { useTranslations, useLocale } from "next-intl";

type SignupMethod = "email" | "phone";

export default function SignupPage() {
  const router = useRouter();
  const { signup, refreshUser } = useAuth();
  const t = useTranslations("auth");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [method, setMethod] = useState<SignupMethod>("email");

  // Shared
  const [inviteCode, setInviteCode] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [devVerifyUrl, setDevVerifyUrl] = useState("");

  // Email fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Phone fields
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpCooldown, setOtpCooldown] = useState(0);

  const handleMethodSwitch = (m: SignupMethod) => {
    setMethod(m);
    setError("");
    setSuccess("");
  };

  const handleSendOtp = async () => {
    if (!phone || otpCooldown > 0) return;
    setOtpLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, inviteCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t("failedSendOtp"));
      } else {
        setOtpSent(true);
        // 60s cooldown
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
    setSuccess("");
    setDevVerifyUrl("");
    setLoading(true);

    if (method === "email") {
      const result = await signup({ email, username, password, inviteCode });
      setLoading(false);
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(t("accountCreatedEmail"));
        if (result.devVerifyUrl) setDevVerifyUrl(result.devVerifyUrl);
      }
    } else {
      try {
        const res = await fetch("/api/auth/signup-phone", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, otp, username, inviteCode }),
        });
        const data = await res.json();
        setLoading(false);
        if (!res.ok) {
          setError(data.error || t("signupFailed"));
        } else {
          setSuccess(t("accountCreatedRedirect"));
          await refreshUser();
          setTimeout(() => router.push("/"), 1500);
        }
      } catch {
        setLoading(false);
        setError(tc("networkError"));
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
            <h1 className="text-2xl font-bold text-discord-text">{t("joinCreatorHub")}</h1>
            <p className="text-sm text-discord-text-secondary mt-2">{t("inviteCodeRequired")}</p>
          </div>

          {/* Method toggle */}
          <div className="flex justify-center mb-6">
            <div className="inline-flex items-center bg-discord-bg-dark border border-discord-border rounded-lg p-1">
              <button
                type="button"
                onClick={() => handleMethodSwitch("email")}
                className={`px-4 py-1.5 rounded text-xs font-semibold transition ${method === "email"
                    ? "bg-green-600 text-white"
                    : "text-discord-text-secondary hover:text-discord-text"
                  }`}
              >
                {t("email")}
              </button>
              <button
                type="button"
                onClick={() => handleMethodSwitch("phone")}
                className={`px-4 py-1.5 rounded text-xs font-semibold transition ${method === "phone"
                    ? "bg-green-600 text-white"
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
            {success && (
              <div className="p-3 bg-discord-green/10 border border-discord-green/30 rounded-lg text-sm text-discord-green">
                {success}
              </div>
            )}

            {/* Invite code — always shown */}
            <div>
              <label className="block text-sm font-medium mb-2 text-discord-text-secondary uppercase tracking-wide">
                {t("inviteCode")}
              </label>
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                className="w-full p-3 bg-discord-bg-dark border border-discord-border rounded-lg text-discord-text text-sm font-mono focus:outline-none focus:border-discord-accent"
                placeholder="INV-XXXX-XXXX"
                required
              />
            </div>

            {method === "email" ? (
              <>
                <div className="text-xs font-semibold text-discord-text-muted uppercase tracking-wider pt-1">
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
                    {t("username")}
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full p-3 bg-discord-bg-dark border border-discord-border rounded-lg text-discord-text text-sm focus:outline-none focus:border-discord-accent"
                    placeholder="your_username"
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
                    minLength={8}
                    required
                  />
                  <p className="text-xs text-discord-text-muted mt-1">{t("minPassword")}</p>
                </div>
              </>
            ) : (
              <>
                <div className="text-xs font-semibold text-discord-text-muted uppercase tracking-wider pt-1">
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
                <div>
                  <label className="block text-sm font-medium mb-2 text-discord-text-secondary uppercase tracking-wide">
                    {t("username")}
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full p-3 bg-discord-bg-dark border border-discord-border rounded-lg text-discord-text text-sm focus:outline-none focus:border-discord-accent"
                    placeholder="your_username"
                    required
                  />
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
            >
              {loading ? <Spinner /> : null}
              {t("createAccount")}
            </button>
          </form>

          <p className="text-center text-sm text-discord-text-muted mt-6">
            {t("haveAccount")}{" "}
            <Link href="/login" className="text-discord-accent hover:underline">
              {t("signInLink")}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
