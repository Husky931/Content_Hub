"use client";

import { Suspense, useEffect, useState, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useParams, useSearchParams } from "next/navigation";
import { useSettingsModal } from "@/contexts/SettingsModalContext";
import { TaskSummaryBar } from "@/components/channel/TaskSummaryBar";
import { TaskCard } from "@/components/channel/TaskCard";
import { AppealCard } from "@/components/channel/AppealCard";
import { getSocket, joinChannel, leaveChannel, onSocketReady, WS_EVENTS } from "@/lib/realtime";
import { Spinner } from "@/components/ui/Spinner";
import { SystemMessage } from "@/components/channel/SystemMessage";
import { TrainingView } from "@/components/training/TrainingView";
import { useTranslations } from "next-intl";

interface Message {
  id: string;
  content: string;
  type: "text" | "mod" | "system";
  replyToId?: string | null;
  privateToUserId?: string | null;
  replyCount?: number;
  createdAt: string;
  updatedAt?: string | null;
  deletedAt?: string | null;
  channelSlug?: string;
  user: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    role: string;
  };
}

interface ChannelInfo {
  id: string;
  name: string;
  type: string;
  description: string | null;
  requiredTagId?: string | null;
}

interface TaskInfo {
  id: string;
  title: string;
  titleCn?: string | null;
  description: string;
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
  myAttempt?: { id: string; status: string; deliverables: { text?: string } | null; appealStatus?: string | null } | null;
  submittedCount?: number;
  reviewClaimedBy?: string | null;
}

// Role icon SVGs overlaid on bottom-right of avatar
function RoleIcon({ role }: { role: string }) {
  if (role === "admin") {
    return (
      <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 border-2 border-discord-bg flex items-center justify-center" title="Admin">
        <svg className="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
        </svg>
      </div>
    );
  }
  if (role === "supermod") {
    return (
      <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-indigo-500 border-2 border-discord-bg flex items-center justify-center" title="Supermod">
        <svg className="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 1l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" />
        </svg>
      </div>
    );
  }
  if (role === "mod") {
    return (
      <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-green-500 border-2 border-discord-bg flex items-center justify-center" title="Mod">
        <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622C17.176 19.29 21 14.591 21 9c0-1.055-.15-2.079-.434-3.044z" />
        </svg>
      </div>
    );
  }
  return (
    <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-discord-accent border-2 border-discord-bg" title="Creator" />
  );
}

const ROLE_AVATAR_COLOR: Record<string, string> = {
  admin: "bg-red-500",
  supermod: "bg-indigo-500",
  mod: "bg-green-500",
  creator: "bg-discord-accent",
};

const ROLE_NAME_COLOR: Record<string, string> = {
  admin: "text-red-400",
  supermod: "text-indigo-400",
  mod: "text-green-400",
  creator: "text-discord-text",
};

const ROLE_TAG: Record<string, { label: string; className: string }> = {
  admin: {
    label: "Admin",
    className: "bg-red-500/20 text-red-400 border border-red-500/30",
  },
  supermod: {
    label: "Supermod",
    className: "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30",
  },
  mod: {
    label: "Mod",
    className: "bg-green-500/20 text-green-400 border border-green-500/30",
  },
  creator: {
    label: "Creator",
    className: "bg-discord-accent/20 text-discord-accent border border-discord-accent/30",
  },
};

function RoleTag({ role, small = false }: { role: string; small?: boolean }) {
  const tag = ROLE_TAG[role];
  if (!tag) return null;
  return (
    <span
      className={`inline-flex items-center rounded px-1 font-semibold tracking-wide ${small ? "text-[9px] py-px" : "text-[10px] py-px"
        } ${tag.className}`}
    >
      {tag.label.toUpperCase()}
    </span>
  );
}

function renderContentWithMentions(content: string) {
  const parts = content.split(/(@\w+)/g);
  if (parts.length === 1) return content;
  return parts.map((part, i) => {
    if (part.match(/^@\w+$/)) {
      return (
        <span key={i} className="bg-discord-accent/20 text-discord-accent rounded px-0.5 font-medium">
          {part}
        </span>
      );
    }
    return part;
  });
}

export default function ChannelPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen bg-discord-bg text-discord-text-muted"><Spinner /></div>}>
      <ChannelPageContent />
    </Suspense>
  );
}

function ChannelPageContent() {
  const { slug } = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const expandTaskId = searchParams.get("task");
  const { user } = useAuth();
  const { openSettings } = useSettingsModal();
  const t = useTranslations("channels");
  const [channel, setChannel] = useState<ChannelInfo | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [collapsedThreads, setCollapsedThreads] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [privateTo, setPrivateTo] = useState<{ id: string; username: string; displayName: string | null } | null>(null);
  const [userMenuMsg, setUserMenuMsg] = useState<string | null>(null);
  // @ mention autocomplete
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionResults, setMentionResults] = useState<{ id: string; username: string; displayName: string | null; avatarUrl: string | null; role: string }[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const tasksFetchRef = useRef<AbortController | null>(null);
  const fetchTasksRef = useRef<() => void>(() => { });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [appeals, setAppeals] = useState<any[]>([]);

  const isAppealsChannel = slug === "appeals";

  // Close user menu on click outside
  useEffect(() => {
    if (!userMenuMsg) return;
    const close = () => setUserMenuMsg(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [userMenuMsg]);

  // @ mention search with debounce
  useEffect(() => {
    if (mentionQuery === null || mentionQuery.length === 0) {
      setMentionResults([]);
      return;
    }
    if (mentionSearchTimer.current) clearTimeout(mentionSearchTimer.current);
    mentionSearchTimer.current = setTimeout(() => {
      fetch(`/api/users/search?q=${encodeURIComponent(mentionQuery)}`)
        .then((res) => res.json())
        .then((data) => {
          setMentionResults(data.users || []);
          setMentionIndex(0);
        })
        .catch(() => { });
    }, 200);
    return () => {
      if (mentionSearchTimer.current) clearTimeout(mentionSearchTimer.current);
    };
  }, [mentionQuery]);

  // Detect @ in input and extract query
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = e.target.value.slice(0, 2000);
    setNewMessage(value);

    // Auto-resize textarea on content change (handles paste, etc.)
    const target = e.target as HTMLTextAreaElement;
    target.style.height = "auto";
    target.style.height = Math.min(target.scrollHeight, 150) + "px";

    const cursorPos = e.target.selectionStart ?? value.length;
    const textBeforeCursor = value.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@(\w*)$/);
    if (atMatch) {
      setMentionQuery(atMatch[1]);
    } else {
      setMentionQuery(null);
    }
  };

  // Insert @mention into the message text
  const insertMention = (username: string) => {
    const cursorPos = inputRef.current?.selectionStart ?? newMessage.length;
    const textBeforeCursor = newMessage.slice(0, cursorPos);
    const textAfterCursor = newMessage.slice(cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf("@");
    const before = newMessage.slice(0, atIndex);
    const after = textAfterCursor;
    setNewMessage(`${before}@${username} ${after}`);
    setMentionQuery(null);
    setMentionResults([]);
    inputRef.current?.focus();
  };

  // Set privateTo from mention dropdown
  const startPrivateFromMention = (u: { id: string; username: string; displayName: string | null }) => {
    // Remove the @query from the input text
    const cursorPos = inputRef.current?.selectionStart ?? newMessage.length;
    const textBeforeCursor = newMessage.slice(0, cursorPos);
    const textAfterCursor = newMessage.slice(cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf("@");
    const before = newMessage.slice(0, atIndex);
    setNewMessage(`${before}${textAfterCursor}`.trim());
    setPrivateTo(u);
    setMentionQuery(null);
    setMentionResults([]);
    inputRef.current?.focus();
  };

  const fetchAppeals = useCallback(() => {
    if (!isAppealsChannel) return;
    fetch("/api/appeals")
      .then((res) => res.json())
      .then((data) => setAppeals(data.appeals || []))
      .catch(() => { });
  }, [isAppealsChannel]);

  const fetchData = () => {
    if (!slug) return;
    fetch(`/api/channels/${slug}`)
      .then((res) => res.json())
      .then((data) => {
        setChannel(data.channel);
        setMessages(data.messages || []);
      })
      .catch(() => { });
  };

  const fetchTasks = () => {
    if (!slug) return;
    tasksFetchRef.current?.abort();
    const controller = new AbortController();
    tasksFetchRef.current = controller;
    fetch(`/api/tasks?channel=${slug}`, { signal: controller.signal, cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setTasks(data.tasks || []))
      .catch((err) => {
        if (err.name !== "AbortError") console.warn("[tasks] fetch failed:", err);
      });
  };
  fetchTasksRef.current = fetchTasks;

  useEffect(() => {
    fetchData();
    fetchTasks();
    fetchAppeals();
  }, [slug, fetchAppeals]);

  // Listen for same-tab task mutations (e.g. edit from settings modal)
  useEffect(() => {
    const handler = () => fetchTasksRef.current();
    window.addEventListener("tasks-updated", handler);
    return () => window.removeEventListener("tasks-updated", handler);
  }, []);

  // Real-time: subscribe to channel messages via WebSocket
  useEffect(() => {
    if (!slug) return;

    let activeSocket: ReturnType<typeof getSocket> = null;

    const handleNewMessage = (msg: Message) => {
      // Private messages arrive via user room with channelSlug — ignore if not this channel
      if (msg.channelSlug && msg.channelSlug !== slug) return;

      const normalized: Message = {
        ...msg,
        id: msg.id || `ws-${Date.now()}`,
        createdAt: msg.createdAt || new Date().toISOString(),
        replyToId: msg.replyToId || null,
        privateToUserId: msg.privateToUserId || null,
        replyCount: msg.replyCount || 0,
        user: msg.user || {
          id: "system",
          username: "System",
          displayName: "System",
          avatarUrl: null,
          role: "system",
        },
      };

      setMessages((prev) => {
        if (prev.some((m) => m.id === normalized.id)) return prev;

        // If this is a reply, increment replyCount on the parent
        if (normalized.replyToId) {
          const updated = prev.map((m) =>
            m.id === normalized.replyToId
              ? { ...m, replyCount: (m.replyCount || 0) + 1 }
              : m
          );
          return [...updated, normalized];
        }

        return [...prev, normalized];
      });
    };

    const handleTaskUpdate = () => {
      fetchTasksRef.current();
    };

    const handleMessageEdit = (data: { id: string; content: string; updatedAt: string; channelSlug?: string }) => {
      if (data.channelSlug && data.channelSlug !== slug) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === data.id ? { ...m, content: data.content, updatedAt: data.updatedAt } : m
        )
      );
    };

    const handleMessageDelete = (data: { id: string; channelSlug?: string }) => {
      if (data.channelSlug && data.channelSlug !== slug) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === data.id ? { ...m, deletedAt: new Date().toISOString(), content: "" } : m
        )
      );
    };

    const setup = (socket: NonNullable<ReturnType<typeof getSocket>>) => {
      activeSocket = socket;
      joinChannel(slug);
      socket.on(WS_EVENTS.MESSAGE_NEW, handleNewMessage);
      socket.on(WS_EVENTS.MESSAGE_SYSTEM, handleNewMessage);
      socket.on(WS_EVENTS.MESSAGE_EDIT, handleMessageEdit);
      socket.on(WS_EVENTS.MESSAGE_DELETE, handleMessageDelete);
      socket.on(WS_EVENTS.TASK_UPDATED, handleTaskUpdate);
    };

    const unsub = onSocketReady(setup);

    return () => {
      unsub();
      leaveChannel(slug);
      if (activeSocket) {
        activeSocket.off(WS_EVENTS.MESSAGE_NEW, handleNewMessage);
        activeSocket.off(WS_EVENTS.MESSAGE_SYSTEM, handleNewMessage);
        activeSocket.off(WS_EVENTS.MESSAGE_EDIT, handleMessageEdit);
        activeSocket.off(WS_EVENTS.MESSAGE_DELETE, handleMessageDelete);
        activeSocket.off(WS_EVENTS.TASK_UPDATED, handleTaskUpdate);
      }
    };
  }, [slug]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || sending) return;

    setSending(true);
    try {
      const res = await fetch(`/api/channels/${slug}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: newMessage.trim(),
          replyToId: replyingTo?.id || null,
          privateToUserId: privateTo?.id || null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => {
          if (prev.some((m) => m.id === data.message.id)) return prev;

          // If replying, increment parent's replyCount
          if (data.message.replyToId) {
            const updated = prev.map((m) =>
              m.id === data.message.replyToId
                ? { ...m, replyCount: (m.replyCount || 0) + 1 }
                : m
            );
            return [...updated, data.message];
          }

          return [...prev, data.message];
        });
        setNewMessage("");
        if (inputRef.current) inputRef.current.style.height = "auto";
        setReplyingTo(null);
        setPrivateTo(null);
      }
    } catch {
      // silent fail
    } finally {
      setSending(false);
    }
  };

  const handleReply = useCallback((msg: Message) => {
    setReplyingTo(msg);
    // Auto-set privateTo when replying to a private message
    if (msg.privateToUserId) {
      const otherUser = msg.user.id === user?.id
        ? { id: msg.privateToUserId, username: "", displayName: null } // Will show from context
        : { id: msg.user.id, username: msg.user.username, displayName: msg.user.displayName };
      setPrivateTo(otherUser);
    }
    inputRef.current?.focus();
  }, [user]);

  const toggleThread = useCallback((msgId: string) => {
    setCollapsedThreads((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) {
        next.delete(msgId);
      } else {
        next.add(msgId);
      }
      return next;
    });
  }, []);

  const handleEditStart = useCallback((msg: Message) => {
    setEditingId(msg.id);
    setEditContent(msg.content);
  }, []);

  const handleEditSave = useCallback(async () => {
    if (!editingId || !editContent.trim() || editSaving) return;
    setEditSaving(true);
    try {
      const res = await fetch(`/api/channels/${slug}/messages/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setMessages((prev) =>
          prev.map((m) =>
            m.id === editingId
              ? { ...m, content: data.message.content, updatedAt: data.message.updatedAt }
              : m
          )
        );
        setEditingId(null);
        setEditContent("");
      }
    } catch {
      // silent fail
    } finally {
      setEditSaving(false);
    }
  }, [editingId, editContent, editSaving, slug]);

  const handleEditCancel = useCallback(() => {
    setEditingId(null);
    setEditContent("");
  }, []);

  const handleDelete = useCallback(async (msgId: string) => {
    if (deletingId) return;
    setDeletingId(msgId);
    try {
      const res = await fetch(`/api/channels/${slug}/messages/${msgId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId ? { ...m, deletedAt: new Date().toISOString(), content: "" } : m
          )
        );
      }
    } catch {
      // silent fail
    } finally {
      setDeletingId(null);
    }
  }, [deletingId, slug]);

  // Delete permission: own message, mod can delete creator, admin can delete anyone
  const canDeleteMsg = useCallback((msg: Message) => {
    if (!user) return false;
    if (msg.user?.id === user.id) return true;
    if (user.role === "admin") return true;
    if (["mod", "supermod"].includes(user.role ?? "") && msg.user?.role === "creator") return true;
    return false;
  }, [user]);

  // Check if user has tag access for tag-gated channels
  const hasTagAccess = (() => {
    if (!channel?.requiredTagId) return true;
    if (["supermod", "admin"].includes(user?.role ?? "")) return true;
    return user?.tags?.some((t) => t.id === channel.requiredTagId) ?? false;
  })();

  const canPost =
    (channel?.name !== "announcements" ||
      ["mod", "supermod", "admin"].includes(user?.role ?? "")) &&
    hasTagAccess;

  const isTaskChannel = channel?.type === "task";
  const isTrainingChannel = slug === "beginner-training";
  const isMod = ["admin", "supermod", "mod"].includes(user?.role ?? "");
  const activeTasks = tasks.filter(
    (t) => t.status === "active" || t.status === "locked"
  );

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  };

  // Separate top-level messages and replies
  const topLevelMessages = messages.filter((m) => !m.replyToId);
  const repliesByParent: Record<string, Message[]> = {};
  for (const msg of messages) {
    if (msg.replyToId) {
      if (!repliesByParent[msg.replyToId]) repliesByParent[msg.replyToId] = [];
      repliesByParent[msg.replyToId].push(msg);
    }
  }

  // Group top-level messages by date
  const groupedMessages: { date: string; messages: Message[] }[] = [];
  let currentDate = "";
  for (const msg of topLevelMessages) {
    const date = formatDate(msg.createdAt);
    if (date !== currentDate) {
      currentDate = date;
      groupedMessages.push({ date, messages: [] });
    }
    groupedMessages[groupedMessages.length - 1].messages.push(msg);
  }

  // Render a single message row
  const renderMessage = (msg: Message, isReply = false) => {
    const isDeleted = !!msg.deletedAt;
    const isEditing = editingId === msg.id;
    const isOwnMessage = msg.user?.id === user?.id;

    // Deleted message placeholder
    if (isDeleted) {
      return (
        <div
          key={msg.id}
          className={`flex gap-3 py-1 px-2 rounded opacity-50 ${isReply ? "ml-6" : ""}`}
        >
          <div className={`rounded-full flex items-center justify-center bg-discord-text-muted/30 ${isReply ? "w-7 h-7" : "w-10 h-10"}`}>
            <svg className={`text-discord-text-muted ${isReply ? "w-3 h-3" : "w-4 h-4"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className={`italic text-discord-text-muted ${isReply ? "text-xs" : "text-sm"}`}>
              {t("messageDeleted")}
            </p>
          </div>
        </div>
      );
    }

    // System messages get their own themed component
    if (msg.type === "system") {
      return (
        <div key={msg.id} className={isReply ? "ml-6" : ""}>
          <SystemMessage id={msg.id} content={msg.content} createdAt={msg.createdAt} />
        </div>
      );
    }

    const isPrivate = !!msg.privateToUserId;

    return (
      <div
        key={msg.id}
        className={`flex gap-3 py-1 px-2 hover:bg-discord-bg-hover/30 rounded group ${isPrivate
          ? "border-l-2 border-purple-400 pl-4 bg-purple-500/5"
          : msg.type === "mod"
            ? "border-l-2 border-discord-accent pl-4"
            : ""
          } ${isReply ? "ml-6" : ""}`}
      >
        {/* Avatar with role icon */}
        <div className="relative shrink-0 mt-0.5">
          {msg.user?.avatarUrl ? (
            <>
              <img
                src={msg.user.avatarUrl}
                alt=""
                className={`rounded-full ${isReply ? "w-7 h-7" : "w-10 h-10"}`}
              />
              {!isReply && <RoleIcon role={msg.user.role} />}
            </>
          ) : (
            <>
              <div
                className={`rounded-full flex items-center justify-center text-white font-bold ${isReply ? "w-7 h-7 text-xs" : "w-10 h-10 text-sm"
                  } ${ROLE_AVATAR_COLOR[msg.user?.role] ?? "bg-discord-accent"}`}
              >
                {(msg.user?.displayName || msg.user?.username || "S")
                  .slice(0, 2)
                  .toUpperCase()}
              </div>
              {!isReply && msg.user && <RoleIcon role={msg.user.role} />}
            </>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="relative">
              <span
                onClick={() => {
                  if (msg.user?.id !== user?.id) {
                    setUserMenuMsg(userMenuMsg === msg.id ? null : msg.id);
                  }
                }}
                className={`font-medium ${isReply ? "text-xs" : "text-sm"} ${ROLE_NAME_COLOR[msg.user?.role] ?? "text-discord-text"
                  } ${msg.user?.id !== user?.id ? "cursor-pointer hover:underline" : ""}`}
              >
                {msg.user?.displayName || msg.user?.username || "System"}
              </span>
              {/* Private message dropdown */}
              {userMenuMsg === msg.id && (
                <div className="absolute left-0 top-full mt-1 z-50 bg-discord-bg-dark border border-discord-border rounded-lg shadow-xl py-1 min-w-[180px]">
                  <button
                    onClick={() => {
                      setPrivateTo({ id: msg.user.id, username: msg.user.username, displayName: msg.user.displayName });
                      setUserMenuMsg(null);
                      inputRef.current?.focus();
                    }}
                    className="w-full text-left px-3 py-1.5 text-sm text-purple-400 hover:bg-purple-500/10 flex items-center gap-2"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    {t("privateMessage")}
                  </button>
                </div>
              )}
            </span>
            {msg.user && (
              <RoleTag role={msg.user.role} small={isReply} />
            )}
            {isPrivate && (
              <span className="text-[10px] px-1.5 py-0.5 bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded inline-flex items-center gap-1 font-semibold tracking-wide">
                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                {t("private").toUpperCase()}
              </span>
            )}
            {msg.type === "mod" && !isPrivate && (
              <span className="text-xs px-1.5 py-0.5 bg-discord-accent/20 text-discord-accent rounded">
                {t("mod")}
              </span>
            )}
            <span className="text-xs text-discord-text-muted">
              {formatTime(msg.createdAt)}
            </span>
            {msg.updatedAt && (
              <span className="text-xs text-discord-text-muted/60 italic">{t("edited")}</span>
            )}

            {/* Action buttons — visible on hover */}
            {(
              <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {/* Reply */}
                {canPost && (
                  <button
                    onClick={() => handleReply(msg)}
                    className="text-xs text-discord-text-muted hover:text-discord-accent flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-discord-accent/10"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a5 5 0 015 5v4M3 10l6 6M3 10l6-6" />
                    </svg>
                    {t("reply")}
                  </button>
                )}
                {/* Edit — own messages only */}
                {isOwnMessage && (
                  <button
                    onClick={() => handleEditStart(msg)}
                    className="text-xs text-discord-text-muted hover:text-yellow-400 flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-yellow-400/10"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    {t("edit")}
                  </button>
                )}
                {/* Delete */}
                {canDeleteMsg(msg) && (
                  <button
                    onClick={() => handleDelete(msg.id)}
                    disabled={deletingId === msg.id}
                    className="text-xs text-discord-text-muted hover:text-red-400 flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-red-400/10 disabled:opacity-50"
                  >
                    {deletingId === msg.id ? (
                      <Spinner />
                    ) : (
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    )}
                    {t("delete")}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Message content or inline edit */}
          {isEditing ? (
            <div className="mt-1">
              <input
                type="text"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value.slice(0, 2000))}
                maxLength={2000}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleEditSave();
                  if (e.key === "Escape") handleEditCancel();
                }}
                autoFocus
                className="w-full p-1.5 bg-discord-bg-hover text-sm text-discord-text rounded border border-discord-accent focus:outline-none"
              />
              <div className="flex items-center gap-2 mt-1">
                <button
                  onClick={handleEditSave}
                  disabled={editSaving || !editContent.trim()}
                  className="text-xs px-2 py-0.5 bg-discord-accent hover:bg-discord-accent/80 text-white rounded disabled:opacity-50 flex items-center gap-1"
                >
                  {editSaving && <Spinner />}
                  {t("save")}
                </button>
                <button
                  onClick={handleEditCancel}
                  className="text-xs px-2 py-0.5 text-discord-text-muted hover:text-discord-text"
                >
                  {t("cancel")}
                </button>
                <span className="text-xs text-discord-text-muted/50">
                  {t("escToCancel")}
                </span>
              </div>
            </div>
          ) : (
            <p className={`text-discord-text-secondary wrap-break-word whitespace-pre-wrap ${isReply ? "text-xs" : "text-sm"}`}>
              {renderContentWithMentions(msg.content)}
            </p>
          )}
        </div>
      </div>
    );
  };

  // Count all descendants recursively
  const countAllReplies = (parentId: string): number => {
    const directReplies = repliesByParent[parentId] || [];
    let total = directReplies.length;
    for (const reply of directReplies) {
      total += countAllReplies(reply.id);
    }
    return total;
  };

  // Render nested replies recursively (Reddit-style tree)
  const renderReplies = (parentId: string, depth: number = 0) => {
    const replies = repliesByParent[parentId] || [];
    if (replies.length === 0) return null;

    return (
      <div className={`border-l-2 border-discord-border/40 hover:border-discord-accent/40 ${depth === 0 ? "ml-6" : "ml-4"} pl-2 mt-0.5 space-y-0.5`}>
        {replies.map((reply) => (
          <div key={reply.id}>
            {renderMessage(reply, true)}
            {renderReplies(reply.id, depth + 1)}
          </div>
        ))}
      </div>
    );
  };

  // Render thread for a top-level message — expanded by default, collapsible
  const renderThread = (parentMsg: Message) => {
    const totalReplies = countAllReplies(parentMsg.id);
    if (totalReplies === 0) return null;

    const isCollapsed = collapsedThreads.has(parentMsg.id);

    return (
      <div className="ml-6 mt-0.5">
        <button
          onClick={() => toggleThread(parentMsg.id)}
          className="flex items-center gap-1.5 text-xs text-discord-accent hover:text-discord-accent/80 transition-colors py-0.5 px-1 -ml-1 rounded hover:bg-discord-accent/10"
        >
          <span className="font-mono font-bold text-xs w-3 text-center">
            {isCollapsed ? "+" : "−"}
          </span>
          <span>
            {t("replyCount", { count: totalReplies })}
          </span>
        </button>

        {!isCollapsed && renderReplies(parentMsg.id)}
      </div>
    );
  };

  // Render training UI for #beginner-training channel
  if (isTrainingChannel) {
    return <TrainingView />;
  }

  return (
    <>
      {/* Task summary bar (task channels only) */}
      {isTaskChannel && <TaskSummaryBar channelSlug={slug} />}

      {/* Task channel header bar: Create (mod-only) + View Tasks (all users) */}
      {isTaskChannel && (isMod || activeTasks.length > 0) && (
        <div className="px-4 py-2 bg-discord-bg border-b border-discord-border/50 flex items-center">
          {isMod && (
            <button
              onClick={() => openSettings("admin-tasks")}
              className="text-xs px-3 py-1.5 bg-discord-accent hover:bg-discord-accent/80 text-white rounded font-semibold transition flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              {t("createTask")}
            </button>
          )}
          {activeTasks.length > 0 && (
            <button
              onClick={() => messagesContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
              className="ml-auto text-xs px-3 py-1.5 bg-discord-bg-dark hover:bg-discord-bg-dark/80 text-discord-text-secondary hover:text-discord-text rounded font-semibold transition flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              {t("viewChannelTasks")}
            </button>
          )}
        </div>
      )}

      {/* Messages area */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-4 bg-discord-bg">
        {messages.length === 0 && tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-discord-text-muted">
            <div className="text-4xl mb-4">#</div>
            <h3 className="text-xl font-bold text-discord-text mb-2">
              {t("welcomeToChannel", { channel: channel?.name || slug })}
            </h3>
            <p className="text-sm">
              {channel?.description || t("channelStart")}
            </p>
          </div>
        )}

        {/* Active task cards at the top of the feed */}
        {isTaskChannel && activeTasks.length > 0 && (
          <div className="mb-4">
            {activeTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                defaultExpanded={task.id === expandTaskId}
                onAttemptSubmitted={() => {
                  fetchTasks();
                  fetchData();
                }}
              />
            ))}
          </div>
        )}

        {/* Appeal cards in #appeals channel */}
        {isAppealsChannel && appeals.length > 0 && (
          <div className="mb-4">
            {appeals.map((appeal) => (
              <AppealCard
                key={appeal.id}
                appeal={appeal}
                onResolved={() => {
                  fetchAppeals();
                  fetchData();
                }}
              />
            ))}
          </div>
        )}

        {groupedMessages.map((group) => (
          <div key={group.date}>
            {/* Date divider */}
            <div className="flex items-center my-4">
              <div className="flex-1 h-px bg-discord-border" />
              <span className="px-3 text-xs text-discord-text-muted font-medium">
                {group.date}
              </span>
              <div className="flex-1 h-px bg-discord-border" />
            </div>

            {group.messages.map((msg) => (
              <div key={msg.id} className="mb-2">
                {renderMessage(msg)}
                {renderThread(msg)}
              </div>
            ))}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Private message banner */}
      {privateTo && canPost && (
        <div className={`px-4 ${replyingTo ? "" : "pt-2"} bg-discord-bg shrink-0`}>
          <div className={`flex items-center gap-2 px-3 py-2 bg-discord-bg-dark border-l-2 border-purple-400 text-xs text-discord-text-muted ${replyingTo ? "" : "rounded-t-lg"}`}>
            <svg className="w-3 h-3 shrink-0 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span>
              {t("privateMessageTo", { name: privateTo.displayName || privateTo.username })}
            </span>
            <button
              onClick={() => setPrivateTo(null)}
              className="ml-auto text-discord-text-muted hover:text-discord-text shrink-0"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Reply preview bar */}
      {replyingTo && canPost && (
        <div className={`px-4 ${privateTo ? "" : "pt-2"} bg-discord-bg shrink-0`}>
          <div className={`flex items-center gap-2 px-3 py-2 bg-discord-bg-dark border-l-2 border-discord-accent text-xs text-discord-text-muted ${privateTo ? "" : "rounded-t-lg"}`}>
            <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a5 5 0 015 5v4M3 10l6 6M3 10l6-6" />
            </svg>
            <span>
              {t("replyingTo", { name: replyingTo.user?.displayName || replyingTo.user?.username })}
              <span className="ml-1.5 text-discord-text-muted/70">
                {replyingTo.content.length > 60
                  ? replyingTo.content.slice(0, 60) + "…"
                  : replyingTo.content}
              </span>
            </span>
            <button
              onClick={() => setReplyingTo(null)}
              className="ml-auto text-discord-text-muted hover:text-discord-text shrink-0"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Message input */}
      <div className={`px-4 pb-4 ${(replyingTo || privateTo) && canPost ? "pt-0" : "pt-2"} bg-discord-bg shrink-0`}>
        {!canPost ? (
          <div className="p-3 bg-discord-bg-dark rounded-lg text-center text-sm text-discord-text-muted border border-discord-border">
            <span className="mr-1.5">🔒</span>
            {!hasTagAccess
              ? t("tagRequired")
              : t("noPermission")}
          </div>
        ) : (
          <form onSubmit={handleSend} className="flex gap-2">
            <div className="relative flex-1">
              {/* @ Mention autocomplete dropdown */}
              {mentionQuery !== null && mentionResults.length > 0 && (
                <div className="absolute bottom-full left-0 right-0 mb-1 bg-discord-bg-dark border border-discord-border rounded-lg shadow-xl overflow-hidden z-50 max-h-64 overflow-y-auto">
                  {mentionResults.map((u, i) => (
                    <div
                      key={u.id}
                      className={`flex items-center gap-2 px-3 py-2 ${i === mentionIndex ? "bg-discord-bg-hover" : ""}`}
                    >
                      {/* User info */}
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {u.avatarUrl ? (
                          <img src={u.avatarUrl} alt="" className="w-6 h-6 rounded-full shrink-0" />
                        ) : (
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${ROLE_AVATAR_COLOR[u.role] ?? "bg-discord-accent"}`}>
                            {(u.displayName || u.username).slice(0, 1).toUpperCase()}
                          </div>
                        )}
                        <span className="text-sm text-discord-text truncate">
                          {u.displayName || u.username}
                        </span>
                        <span className="text-xs text-discord-text-muted truncate">@{u.username}</span>
                        <RoleTag role={u.role} small />
                      </div>
                      {/* Action buttons */}
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => insertMention(u.username)}
                          className="text-xs px-2 py-1 rounded bg-discord-accent/20 text-discord-accent hover:bg-discord-accent/30 font-medium"
                        >
                          {t("mention")}
                        </button>
                        <button
                          type="button"
                          onClick={() => startPrivateFromMention(u)}
                          className="text-xs px-2 py-1 rounded bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 font-medium flex items-center gap-1"
                        >
                          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                          </svg>
                          {t("private")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                ref={inputRef}
                value={newMessage}
                onChange={handleInputChange}
                onKeyDown={(e) => {
                  // Keyboard navigation for mention dropdown
                  if (mentionQuery !== null && mentionResults.length > 0) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setMentionIndex((prev) => Math.min(prev + 1, mentionResults.length - 1));
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setMentionIndex((prev) => Math.max(prev - 1, 0));
                    } else if (e.key === "Tab" || (e.key === "Enter" && mentionResults.length > 0)) {
                      e.preventDefault();
                      insertMention(mentionResults[mentionIndex].username);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setMentionQuery(null);
                      setMentionResults([]);
                    }
                  } else if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (newMessage.trim() && !sending) {
                      handleSend(e as unknown as React.FormEvent);
                    }
                  }
                }}
                maxLength={2000}
                rows={1}
                placeholder={
                  privateTo
                    ? t("privateMessagePlaceholder", { name: privateTo.displayName || privateTo.username })
                    : replyingTo
                      ? t("replyToPlaceholder", { name: replyingTo.user?.displayName || replyingTo.user?.username })
                      : t("messageChannel", { channel: channel?.name || slug })
                }
                className={`w-full p-3 bg-discord-bg-hover text-sm text-discord-text placeholder-discord-text-muted focus:outline-none pr-16 resize-none overflow-y-auto ${replyingTo || privateTo ? "rounded-b-lg rounded-t-none" : "rounded-lg"
                  }`}
                style={{ maxHeight: 150 }}
              />
              {newMessage.length > 1800 && (
                <span className={`absolute right-2 top-1/2 -translate-y-1/2 text-xs font-mono ${newMessage.length >= 2000 ? "text-discord-red" : "text-discord-text-muted"}`}>
                  {newMessage.length}/2000
                </span>
              )}
            </div>
            <button
              type="submit"
              disabled={sending || !newMessage.trim()}
              className={`px-4 py-3 bg-discord-accent text-white text-sm font-medium hover:bg-discord-accent/80 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer shrink-0 ${replyingTo || privateTo ? "rounded-b-lg rounded-t-none" : "rounded-lg"
                }`}
            >
              {sending && <Spinner />}
              {t("send")}
            </button>
          </form>
        )}
      </div>
    </>
  );
}
