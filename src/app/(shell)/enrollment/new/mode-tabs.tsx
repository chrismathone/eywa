"use client";

import Link from "next/link";
import { Keyboard, Mic } from "lucide-react";

const TABS = [
  { id: "manual", label: "수동 입력", icon: Keyboard, href: "/enrollment/new" },
  { id: "recording", label: "녹음 업로드", icon: Mic, href: "/enrollment/new?mode=recording" },
] as const;

type Mode = "manual" | "recording";

export function ModeTabs({
  active,
  onSelect,
}: {
  active: Mode;
  onSelect?: (mode: Mode) => void;
}) {
  return (
    <div className="border-border inline-flex rounded-md border p-1 text-sm">
      {TABS.map((t) => {
        const Icon = t.icon;
        const isActive = t.id === active;
        const className = `inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 transition ${
          isActive
            ? "bg-foreground text-background font-medium"
            : "text-muted-foreground hover:text-foreground"
        }`;
        // Sheet (state-driven) — button + onSelect
        if (onSelect) {
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t.id)}
              className={className}
            >
              <Icon className="size-3.5" />
              {t.label}
            </button>
          );
        }
        // Standalone route — Link + href navigation
        return (
          <Link key={t.id} href={t.href} className={className}>
            <Icon className="size-3.5" />
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
