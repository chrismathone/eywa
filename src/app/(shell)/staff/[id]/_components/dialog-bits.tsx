"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, X } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";

/** 계정 관리 소형 다이얼로그 공통 골격 — account-actions·deactivate-button 공용. */
export function Modal({
  title,
  desc,
  onClose,
  width = "sm",
  children,
}: {
  title: string;
  desc?: string;
  onClose: () => void;
  /** 기본 sm. 목록·선택지가 함께 들어가는 다이얼로그(퇴사 인계 등)만 md. */
  width?: "sm" | "md";
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className={`bg-background border-border w-full rounded-lg border p-5 shadow-lg ${
          width === "md" ? "max-w-md" : "max-w-sm"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h2 className="text-foreground text-base font-bold">{title}</h2>
            {desc ? <p className="text-text-dim mt-0.5 text-xs">{desc}</p> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="text-text-dim hover:text-foreground">
            <X className="size-4" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function SubmitBtn({ label, variant }: { label: string; variant?: "default" | "destructive" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending}>
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
      {label}
    </Button>
  );
}

export function Footer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <footer className="flex items-center justify-end gap-2 pt-1">
      <Button type="button" variant="ghost" size="sm" onClick={onClose}>
        취소
      </Button>
      {children}
    </footer>
  );
}
