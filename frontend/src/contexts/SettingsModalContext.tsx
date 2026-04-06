"use client";

import { createContext, useContext, useState, useCallback } from "react";

type SettingsSection =
  | "my-account"
  | "profile"
  | "admin-overview"
  | "admin-users"
  | "admin-invites"
  | "admin-tags"
  | "admin-tasks"
  | "admin-templates"
  | "admin-channels"
  | "admin-audit"
  | "admin-training"
  | "admin-training-editor"
  | "admin-upload-reviews";

interface SettingsModalContextValue {
  isOpen: boolean;
  initialSection: SettingsSection;
  /** Counter that increments on every navigateTo call to force section changes */
  navTick: number;
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  /** Navigate to a section while the modal is already open */
  navigateTo: (section: SettingsSection) => void;
}

const SettingsModalContext = createContext<SettingsModalContextValue>({
  isOpen: false,
  initialSection: "my-account",
  navTick: 0,
  openSettings: () => {},
  closeSettings: () => {},
  navigateTo: () => {},
});

export function SettingsModalProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [initialSection, setInitialSection] = useState<SettingsSection>("my-account");
  const [navTick, setNavTick] = useState(0);

  const openSettings = useCallback((section?: SettingsSection) => {
    setInitialSection(section || "my-account");
    setIsOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    setIsOpen(false);
  }, []);

  const navigateTo = useCallback((section: SettingsSection) => {
    setInitialSection(section);
    setNavTick((t) => t + 1);
  }, []);

  return (
    <SettingsModalContext.Provider value={{ isOpen, initialSection, navTick, openSettings, closeSettings, navigateTo }}>
      {children}
    </SettingsModalContext.Provider>
  );
}

export function useSettingsModal() {
  return useContext(SettingsModalContext);
}

export type { SettingsSection };
