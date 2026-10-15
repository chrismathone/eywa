"use client";

import { useState, useTransition } from "react";

import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { ParentRideActionState } from "../../ride-change/server/parent-ride-state";

const REASON_MAX = 100;

/**
 * 사유를 받아 저장하는 확인 창 — 학부모 '등원만/하원만 타지 않기'·'결석'이 같이 쓴다(사용자 2026-09-29
 * "사유를 짧게라도 받게"). 사유는 필수 · 100자, 직원 화면(학부모 등하원 · 변경 내역)에서 보인다.
 * 서버가 사유·날짜·마감을 다시 확인한다 — 여기의 빈칸 막기는 안내일 뿐이다([[#77]]).
 */
export function ReasonDialog({
  trigger,
  triggerClassName,
  title,
  description,
  confirmLabel,
  placeholder,
  extra,
  onSubmit,
}: {
  trigger: React.ReactNode;
  triggerClassName: string;
  title: string;
  description: string;
  confirmLabel: string;
  placeholder: string;
  /** 사유 칸 위에 더 받을 것(여러 자녀면 누구인지 등). */
  extra?: React.ReactNode;
  onSubmit: (reason: string) => Promise<ParentRideActionState>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await onSubmit(reason);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setReason("");
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) setError(null); }}>
      <DialogTrigger className={triggerClassName}>{trigger}</DialogTrigger>
      <DialogContent className="gap-3">
        <DialogHeader className="pr-8">
          <DialogTitle className="text-base font-bold">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {extra}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-bold">
            이유 <span className="text-danger">*</span>
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={REASON_MAX}
            rows={3}
            placeholder={placeholder}
            className="border-line bg-card rounded-lg border px-3 py-2 text-sm"
          />
          <span className="num text-text-dim self-end text-xs">
            {reason.trim().length}/{REASON_MAX}
          </span>
        </label>
        {error ? (
          <p role="alert" className="text-danger text-sm font-bold break-keep">
            {error}
          </p>
        ) : null}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={pending || !reason.trim()}
            className="bg-danger flex h-11 w-full items-center justify-center rounded-lg text-sm font-bold text-white disabled:opacity-40"
          >
            {pending ? "저장하는 중…" : confirmLabel}
          </button>
          <DialogClose className="bg-card border-line flex h-11 w-full items-center justify-center rounded-lg border text-sm font-bold">
            취소
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
