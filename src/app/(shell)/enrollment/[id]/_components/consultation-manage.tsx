"use client";

import { useActionState, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Tag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setEnrollmentOutcome, type SetOutcomeState } from "@/features/enrollment/server/actions";

const OUTCOME_OPTIONS = [
  { value: "pending", label: "대기" },
  { value: "scheduled", label: "예약" },
  { value: "consulted", label: "상담완료" },
  { value: "ai_done", label: "AI 완료" },
  { value: "enrolled", label: "등록" },
  { value: "declined", label: "거절" },
  { value: "no_show", label: "노쇼" },
];

// 상세 상단 '상태 변경' 버튼. (수정은 전체 편집 페이지 /enrollment/[id]/edit 하나로 통일 — 모달 quick-edit 제거.)
export type ConsultValues = { id: string; outcome: string };

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="bg-background border-border w-full max-w-md rounded-lg border p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-3 flex items-start justify-between gap-2">
          <h2 className="text-foreground text-base font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="닫기" className="text-text-dim hover:text-foreground">
            <X className="size-4" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function SubmitBtn({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
      {label}
    </Button>
  );
}

function OutcomeDialog({ id, current, onClose }: { id: string; current: string; onClose: () => void }) {
  const [selected, setSelected] = useState(current);
  const [state, action] = useActionState<SetOutcomeState, FormData>(setEnrollmentOutcome, undefined);
  if (state?.ok) queueMicrotask(onClose);
  return (
    <Modal title="상태 변경" onClose={onClose}>
      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="outcome" value={selected} />
        <div className="flex flex-wrap gap-2">
          {OUTCOME_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setSelected(o.value)}
              className={`rounded-sm border px-2.5 py-1 text-xs transition ${
                selected === o.value
                  ? "border-primary bg-primary text-primary-foreground font-medium"
                  : "border-line text-text-dim hover:bg-bg-soft"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        {state?.error ? <p className="text-chart-4 text-xs">{state.error}</p> : null}
        <footer className="flex items-center justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            취소
          </Button>
          <SubmitBtn label="변경" />
        </footer>
      </form>
    </Modal>
  );
}

export function ConsultationManageButtons({ values }: { values: ConsultValues }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Tag className="size-3.5" />
        상태 변경
      </Button>
      {open ? <OutcomeDialog id={values.id} current={values.outcome} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
