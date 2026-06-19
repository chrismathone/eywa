"use client";

import { Button } from "@/components/ui/button";

// 디자인 톤 확인 다이얼로그 — 네이티브 confirm()의 OS 박스(폭/줄바꿈 제어 불가, "다." 외톨이 줄)를 대체.
// 컨트롤드: 호출부가 open 상태 + onConfirm/onCancel를 소유. 메시지는 어절 단위(keep-all 전역)로 깔끔히 접힘.
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "확인",
  cancelLabel = "취소",
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="bg-background border-line w-full max-w-sm rounded-lg border p-5 shadow-lg"
        role="alertdialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {title ? <h2 className="text-foreground mb-1.5 text-sm font-bold">{title}</h2> : null}
        <p className="text-text-dim text-sm leading-relaxed">{message}</p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={danger ? "destructive" : "default"}
            size="sm"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
