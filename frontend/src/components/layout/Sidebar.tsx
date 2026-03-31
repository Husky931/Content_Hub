"use client";

import { useEffect, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { UserPanel } from "./UserPanel";
import { useTranslations, useLocale } from "next-intl";
import { localized } from "@/lib/localize";
import { getSocket, WS_EVENTS } from "@/lib/realtime";

interface Channel {
  id: string;
  name: string;
  nameCn?: string | null;
  slug: string;
  type: "special" | "task" | "discussion";
  description: string | null;
  isFixed: boolean;
  requiredTagId: string | null;
  hasAccess: boolean;
  hasUnread: boolean;
  pendingAppealsCount?: number;
}

export function Sidebar() {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const locale = useLocale();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const fetchChannels = useCallback(() => {
    fetch("/api/channels")
      .then((res) => res.json())
      .then((data) => setChannels(data.channels || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  // Mark channel as read when navigating to it
  useEffect(() => {
    const match = pathname.match(/^\/channels\/(.+)$/);
    if (!match) return;
    const activeSlug = match[1];

    // Mark as read on server
    fetch(`/api/channels/${activeSlug}/read`, { method: "POST" }).catch(
      () => {}
    );

    // Clear unread locally immediately
    setChannels((prev) =>
      prev.map((ch) =>
        ch.slug === activeSlug ? { ...ch, hasUnread: false } : ch
      )
    );
  }, [pathname]);

  // Refetch channels when window regains focus (catches messages from other tabs/users)
  useEffect(() => {
    const onFocus = () => fetchChannels();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchChannels]);

  // Refetch channels when admin creates/edits/deletes a channel from settings
  useEffect(() => {
    const handler = () => fetchChannels();
    window.addEventListener("channels-updated", handler);
    return () => window.removeEventListener("channels-updated", handler);
  }, [fetchChannels]);

  // Refetch channels on real-time notifications (e.g. new appeal filed → badge updates)
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const handler = () => fetchChannels();
    s.on(WS_EVENTS.NOTIFICATION_NEW, handler);
    s.on(WS_EVENTS.MESSAGE_SYSTEM, handler);
    return () => {
      s.off(WS_EVENTS.NOTIFICATION_NEW, handler);
      s.off(WS_EVENTS.MESSAGE_SYSTEM, handler);
    };
  }, [fetchChannels]);

  const specialChannels = channels.filter((c) => c.type === "special");
  const taskChannels = channels.filter((c) => c.type === "task");
  const discussionChannels = channels.filter((c) => c.type === "discussion");

  const isActive = (slug: string) => pathname === `/channels/${slug}`;

  const channelIcon = (type: string) => {
    if (type === "special") return "#";
    if (type === "task") return "#";
    return "#";
  };

  const toggleCollapsed = (key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const renderChannelGroup = (key: string, title: string, items: Channel[]) => {
    if (items.length === 0) return null;
    const isCollapsed = collapsed[key];
    return (
      <div className="mb-4">
        <button
          onClick={() => toggleCollapsed(key)}
          className="w-full flex items-center gap-1 px-3 mb-1 group"
        >
          <svg
            className={`w-3 h-3 text-discord-text-muted transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-discord-text-muted group-hover:text-discord-text-secondary transition-colors">
            {title}
          </h3>
        </button>
        {!isCollapsed &&
          items.map((ch) => {
            const active = isActive(ch.slug);
            const unread = !active && ch.hasUnread;
            return (
              <Link
                key={ch.id}
                href={`/channels/${ch.slug}`}
                className={`flex items-center gap-2 px-3 py-1.5 mx-2 rounded text-sm transition-colors ${
                  active
                    ? "bg-discord-bg-hover text-discord-text font-medium"
                    : unread
                    ? "text-discord-text font-semibold hover:bg-discord-bg-hover/50"
                    : "text-discord-text-muted hover:text-discord-text-secondary hover:bg-discord-bg-hover/50"
                }`}
              >
                <span className="text-discord-text-muted font-medium">
                  {channelIcon(ch.type)}
                </span>
                <span className="truncate">{localized(locale, ch.name, ch.nameCn)}</span>

                {/* Pending appeals badge */}
                {ch.slug === "appeals" &&
                  ch.pendingAppealsCount != null &&
                  ch.pendingAppealsCount > 0 && (
                    <span className="ml-auto min-w-5 text-center text-xs px-1.5 py-0.5 bg-red-500 text-white rounded-full font-bold leading-none">
                      {ch.pendingAppealsCount}
                    </span>
                  )}

                {/* Tag-gated lock indicator */}
                {ch.requiredTagId && !ch.hasAccess && (
                  <span className="ml-auto text-discord-text-muted" title={t("requiresTag")}>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </span>
                )}
                {/* Tag indicator for accessible tag-gated channels */}
                {ch.requiredTagId && ch.hasAccess && (
                  <span className="ml-auto text-xs px-1.5 py-0.5 bg-discord-accent/20 text-discord-accent rounded">
                    {t("tag")}
                  </span>
                )}
              </Link>
            );
          })}
      </div>
    );
  };

  return (
    <div className="w-60 bg-discord-sidebar flex flex-col h-full">
      {/* Server header */}
      <div className="h-12 px-4 flex items-center border-b border-discord-bg-darker shadow-sm">
        <h2 className="font-semibold text-discord-text truncate">
          {t("creatorHub")}
        </h2>
      </div>

      {/* Channel list */}
      <div className="flex-1 overflow-y-auto pt-3">
        {renderChannelGroup("special", t("special"), specialChannels)}
        {renderChannelGroup("task", t("taskChannels"), taskChannels)}
        {renderChannelGroup("discussion", t("discussion"), discussionChannels)}
      </div>

      {/* User panel */}
      <UserPanel />
    </div>
  );
}
