"use client";

import { AlertCircle, X } from "@/components/icons/aywa-icon-compat";

// 데이터베이스(서식 저장소) 다이얼로그 공통 부품 — 업로드·새 문서·링크·분류 관리가 같은 껍데기를 쓴다.
// (조건부 마운트 전제: 닫히면 언마운트돼 내부 state가 리셋된다 — 항상 마운트 다이얼로그의 #67 함정 회피.)

export const inputCls =
  "border-line bg-background text-foreground placeholder:text-text-faint w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40";

export function DialogShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="bg-background border-line max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border p-6 shadow-lg">
        <header className="mb-4 flex items-start justify-between">
          <div>
            <p className="eyebrow">데이터베이스</p>
            <h2 className="text-foreground mt-1 text-lg font-bold">{title}</h2>
          </div>
          <button type="button" onClick={onClose} className="text-text-dim hover:text-foreground" aria-label="닫기">
            <X className="size-4" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export { Field } from "@/components/form-field";

export function ErrorNote({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <p className="text-danger bg-danger-soft border-danger/20 inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm">
      <AlertCircle className="size-4 shrink-0" /> {msg}
    </p>
  );
}
