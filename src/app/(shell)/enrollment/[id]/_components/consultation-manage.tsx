"use client";

import { useActionState, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Pencil, Tag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  setEnrollmentOutcome,
  updateEnrollmentConsultation,
  type SetOutcomeState,
  type UpdateConsultationState,
} from "@/features/enrollment/server/actions";

const INPUT = "border-border bg-card text-foreground w-full rounded-md border px-2.5 py-1.5 text-sm";

const OUTCOME_OPTIONS = [
  { value: "pending", label: "대기" },
  { value: "scheduled", label: "예약" },
  { value: "consulted", label: "상담완료" },
  { value: "ai_done", label: "AI 완료" },
  { value: "enrolled", label: "등록" },
  { value: "declined", label: "거절" },
  { value: "no_show", label: "노쇼" },
];

export type ConsultValues = {
  id: string;
  prospectName: string;
  prospectGrade: string | null;
  prospectSchool: string | null;
  parentName: string | null;
  parentPhone: string | null;
  parentRequest: string | null;
  prevAcademy: string | null;
  lastScore: string | null;
  outcome: string;
};

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

function Footer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <footer className="flex items-center justify-end gap-2 pt-1">
      <Button type="button" variant="ghost" size="sm" onClick={onClose}>
        취소
      </Button>
      {children}
    </footer>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-text-dim text-xs">{label}</span>
      {children}
    </label>
  );
}

function EditDialog({ v, onClose }: { v: ConsultValues; onClose: () => void }) {
  const [state, action] = useActionState<UpdateConsultationState, FormData>(
    updateEnrollmentConsultation,
    undefined,
  );
  if (state?.ok) queueMicrotask(onClose);
  return (
    <Modal title="상담 수정" onClose={onClose}>
      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={v.id} />
        <Labeled label="학생 이름 *">
          <input name="prospectName" required defaultValue={v.prospectName} className={INPUT} />
        </Labeled>
        <div className="grid grid-cols-2 gap-2">
          <Labeled label="학년">
            <input name="prospectGrade" defaultValue={v.prospectGrade ?? ""} className={INPUT} />
          </Labeled>
          <Labeled label="학교">
            <input name="prospectSchool" defaultValue={v.prospectSchool ?? ""} className={INPUT} />
          </Labeled>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Labeled label="학부모 성함">
            <input name="parentName" defaultValue={v.parentName ?? ""} className={INPUT} />
          </Labeled>
          <Labeled label="연락처">
            <input name="parentPhone" defaultValue={v.parentPhone ?? ""} className={`num ${INPUT}`} />
          </Labeled>
        </div>
        <Labeled label="학부모 요구사항">
          <textarea name="parentRequest" rows={3} defaultValue={v.parentRequest ?? ""} className={INPUT} />
        </Labeled>
        <div className="grid grid-cols-2 gap-2">
          <Labeled label="이전 학원">
            <input name="prevAcademy" defaultValue={v.prevAcademy ?? ""} className={INPUT} />
          </Labeled>
          <Labeled label="최근 성적">
            <input name="lastScore" defaultValue={v.lastScore ?? ""} className={INPUT} />
          </Labeled>
        </div>
        {state?.error ? <p className="text-chart-4 text-xs">{state.error}</p> : null}
        <Footer onClose={onClose}>
          <SubmitBtn label="저장" />
        </Footer>
      </form>
    </Modal>
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
        <Footer onClose={onClose}>
          <SubmitBtn label="변경" />
        </Footer>
      </form>
    </Modal>
  );
}

export function ConsultationManageButtons({ values }: { values: ConsultValues }) {
  const [open, setOpen] = useState<"edit" | "outcome" | null>(null);
  const close = () => setOpen(null);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen("edit")}>
        <Pencil className="size-3.5" />
        수정
      </Button>
      <Button variant="outline" size="sm" onClick={() => setOpen("outcome")}>
        <Tag className="size-3.5" />
        상태 변경
      </Button>
      {open === "edit" ? <EditDialog v={values} onClose={close} /> : null}
      {open === "outcome" ? <OutcomeDialog id={values.id} current={values.outcome} onClose={close} /> : null}
    </>
  );
}
