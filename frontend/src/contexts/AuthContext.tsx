"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { connectRealtime, disconnectRealtime } from "@/lib/realtime";

interface UserTag {
  id: string;
  name: string;
  nameCn: string | null;
  color: string;
}

interface User {
  id: string;
  email: string;
  username: string;
  role: "creator" | "supercreator" | "mod" | "supermod" | "admin";
  status: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  currency: "usd" | "rmb" | null;
  locale: string;
  onboardingCompleted: boolean;
  createdAt: string;
  tags: UserTag[];
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  /** True only after mount; use to avoid hydration mismatch when rendering auth-dependent UI */
  mounted: boolean;
  login: (email: string, password: string) => Promise<{ error?: string }>;
  signup: (data: { email: string; username: string; password: string; inviteCode: string }) => Promise<{ error?: string; devVerifyUrl?: string }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        // Sync locale cookie with user's DB preference
        if (data.user?.locale) {
          const currentCookie = document.cookie.match(/NEXT_LOCALE=([^;]+)/)?.[1];
          if (currentCookie !== data.user.locale) {
            document.cookie = `NEXT_LOCALE=${data.user.locale};path=/;max-age=${365 * 24 * 60 * 60};samesite=lax`;
          }
        }
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  // Connect to WebSocket server when user is authenticated
  useEffect(() => {
    if (!user) {
      disconnectRealtime();
      return;
    }

    // Fetch the JWT token (httpOnly cookie, so we need the endpoint)
    // WS server auto-joins user:${userId} room from JWT payload on connect
    fetch("/api/auth/ws-token")
      .then((r) => r.json())
      .then((data) => {
        if (data.token) {
          connectRealtime(data.token);
        }
      })
      .catch(() => {
        // WS connection is best-effort — don't block the app
      });

    return () => {
      disconnectRealtime();
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const login = async (email: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error };
    setUser(data.user);
    return {};
  };

  const signup = async (params: {
    email: string;
    username: string;
    password: string;
    inviteCode: string;
  }) => {
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error };
    return { devVerifyUrl: data.devVerifyUrl };
  };

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Network error — clear cookie client-side as fallback
      document.cookie = "auth_token=; path=/; max-age=0";
    }
    setUser(null);
    // Hard redirect ensures clean state even if caller unmounts
    window.location.href = "/login";
  };

  return (
    <AuthContext.Provider value={{ user, loading, mounted, login, signup, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
