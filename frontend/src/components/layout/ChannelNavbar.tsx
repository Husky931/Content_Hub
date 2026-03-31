"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter, usePathname } from "next/navigation";
import { useSettingsModal } from "@/contexts/SettingsModalContext";
import { useTranslations, useLocale } from "next-intl";
import { localized } from "@/lib/localize";
import { getSocket, onSocketReady, WS_EVENTS } from "@/lib/realtime";

export function ChannelNavbar() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { openSettings } = useSettingsModal();
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const locale = useLocale();

  const [walletBalance, setWalletBalance] = useState<{ usd: string; rmb: string } | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Channel info (only for /channels/[slug] pages)
  const [channelInfo, setChannelInfo] = useState<{ slug: string; name: string; nameCn?: string | null; description: string | null; descriptionCn?: string | null } | null>(null);

  // Determine current page context
  const channelMatch = pathname.match(/^\/channels\/([^/]+)/);
  const currentSlug = channelMatch?.[1];
  const isChannelPage = !!currentSlug;

  const PAGE_TITLES: Record<string, string> = {
    "/tasks": t("taskList"),
    "/financials": t("financials"),
    "/notifications": t("notifications"),
    "/review": t("reviewTasks"),
    "/settings": t("settings"),
  };

  // Fetch wallet balance once, then listen for real-time updates
  useEffect(() => {
    const fetchBalance = () => {
      fetch("/api/ledger")
        .then((r) => r.json())
        .then((data) => {
          if (data.summary) {
            setWalletBalance({
              usd: data.summary.availableUsd,
              rmb: data.summary.availableRmb,
            });
          }
        })
        .catch(() => { });
    };
    fetchBalance();

    const handleWalletUpdate = () => fetchBalance();

    const unsub = onSocketReady((socket) => {
      socket.on(WS_EVENTS.WALLET_UPDATED, handleWalletUpdate);
    });
    return () => {
      unsub();
      getSocket()?.off(WS_EVENTS.WALLET_UPDATED, handleWalletUpdate);
    };
  }, []);

  // Fetch unread count once, then listen for real-time updates
  useEffect(() => {
    const fetchUnread = () => {
      fetch("/api/notifications?unread=true")
        .then((r) => r.json())
        .then((data) => setUnreadCount(data.unreadCount || 0))
        .catch(() => { });
    };
    fetchUnread();

    const handleNotification = () => fetchUnread();

    const unsub = onSocketReady((socket) => {
      socket.on(WS_EVENTS.NOTIFICATION_NEW, handleNotification);
    });

    return () => {
      unsub();
      getSocket()?.off(WS_EVENTS.NOTIFICATION_NEW, handleNotification);
    };
  }, []);

  // Fetch channel info when slug changes
  useEffect(() => {
    if (!currentSlug) return;

    let cancelled = false;

    fetch(`/api/channels/${currentSlug}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.channel) {
          setChannelInfo({ slug: currentSlug, name: data.channel.name, nameCn: data.channel.nameCn, description: data.channel.description, descriptionCn: data.channel.descriptionCn });
        }
      })
      .catch(() => {
        if (!cancelled) setChannelInfo({ slug: currentSlug, name: currentSlug, description: null });
      });

    return () => { cancelled = true; };
  }, [currentSlug]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const initials = user
    ? (user.displayName || user.username).slice(0, 2).toUpperCase()
    : "";

  const currency = user?.currency || "usd";
  const displayBalance = walletBalance
    ? currency === "rmb"
      ? `¥${walletBalance.rmb}`
      : `$${walletBalance.usd}`
    : "$0.00";

  // Derive channel fields — only use if fetched data matches current slug
  const isCurrentChannel = channelInfo?.slug === currentSlug;
  const channelName = isCurrentChannel ? localized(locale, channelInfo?.name ?? "", channelInfo?.nameCn) : "";
  const channelDescription = isCurrentChannel ? localized(locale, channelInfo?.description ?? "", channelInfo?.descriptionCn) : null;

  // Title to display
  const displayTitle = isChannelPage
    ? channelName || currentSlug
    : PAGE_TITLES[pathname] || t("creatorHub");

  const handleToggleLocale = async () => {
    const newLocale = locale === "en" ? "zh" : "en";
    // Set cookie immediately for next-intl
    document.cookie = `NEXT_LOCALE=${newLocale};path=/;max-age=${365 * 24 * 60 * 60};samesite=lax`;
    // Persist to DB if authenticated
    try {
      await fetch("/api/settings/locale", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: newLocale }),
      });
    } catch {
      // Cookie already set, so UI will still switch
    }
    // Reload to apply new locale
    window.location.reload();
  };

  return (
    <div className="h-12 px-4 flex items-center border-b border-discord-bg-darker shadow-sm bg-discord-bg shrink-0 gap-3">
      {/* Page/channel title + description */}
      <div className="flex items-center flex-1 min-w-0">
        {isChannelPage && (
          <span className="text-discord-text-muted font-medium mr-2">#</span>
        )}
        <h2 className="font-semibold text-discord-text">{displayTitle}</h2>
        {isChannelPage && channelDescription && (
          <>
            <div className="w-px h-6 bg-discord-border mx-3" />
            <p className="text-sm text-discord-text-muted truncate">
              {channelDescription}
            </p>
          </>
        )}
      </div>

      {/* Right side: locale toggle, wallet, bell, user dropdown */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Language toggle */}
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

        {/* Wallet balance button — always visible */}
        <button
          onClick={() => router.push("/financials")}
          className="flex items-center gap-1.5 px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded transition"
          title={t("viewFinancials")}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
          </svg>
          {displayBalance}
        </button>

        {/* Notification bell — always visible, color changes based on unread */}
        <button
          onClick={() => router.push("/notifications")}
          className={`relative p-1.5 transition rounded ${unreadCount > 0
            ? "text-discord-red hover:text-red-300"
            : "text-discord-text-muted hover:text-discord-text"
            }`}
          title={t("notifications")}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-discord-red text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>

        {/* User avatar + dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-2 p-1 rounded hover:bg-discord-bg-hover/50 transition"
          >
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="w-7 h-7 rounded-full" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-discord-accent flex items-center justify-center text-white text-xs font-bold">
                {initials}
              </div>
            )}
            <span className="text-sm text-discord-text font-medium hidden lg:block">
              {user?.displayName || user?.username}
            </span>
            <svg
              className={`w-3 h-3 text-discord-text-muted transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>

          {dropdownOpen && (
            <div className="absolute right-0 top-full mt-1 w-52 bg-discord-bg-dark border border-discord-border rounded-lg shadow-xl z-50 py-1">
              <button
                onClick={() => { setDropdownOpen(false); openSettings("my-account"); }}
                className="w-full px-3 py-2 text-sm text-discord-text-secondary hover:bg-discord-accent hover:text-white text-left flex items-center gap-2 transition"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {t("settings")}
              </button>
              <button
                onClick={() => { setDropdownOpen(false); router.push("/tasks"); }}
                className="w-full px-3 py-2 text-sm text-discord-text-secondary hover:bg-discord-accent hover:text-white text-left flex items-center gap-2 transition"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
                {t("taskList")}
              </button>
              <button
                onClick={() => { setDropdownOpen(false); router.push("/financials"); }}
                className="w-full px-3 py-2 text-sm text-discord-text-secondary hover:bg-discord-accent hover:text-white text-left flex items-center gap-2 transition"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {t("financials")}
              </button>
              <button
                onClick={() => { setDropdownOpen(false); router.push("/notifications"); }}
                className="w-full px-3 py-2 text-sm text-discord-text-secondary hover:bg-discord-accent hover:text-white text-left flex items-center gap-2 transition"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                {t("notifications")}
                {unreadCount > 0 && (
                  <span className="ml-auto text-xs px-1.5 py-0.5 bg-discord-red text-white rounded-full">
                    {unreadCount}
                  </span>
                )}
              </button>
              <div className="h-px bg-discord-border my-1" />
              {["admin", "supermod", "mod"].includes(user?.role ?? "") && (
                <button
                  onClick={() => { setDropdownOpen(false); router.push("/review"); }}
                  className="w-full px-3 py-2 text-sm text-orange-400 hover:bg-discord-accent hover:text-white text-left flex items-center gap-2 transition"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {t("reviewTasks")}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
