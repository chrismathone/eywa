"use client";

import { useActionState, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Tag, Trash2, X } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { OUTCOME_OPTIONS } from "@/features/enrollment/outcome-meta";
import {
  deleteEnrollmentConsultation,
  setEnrollmentOutcome,
  type DeleteConsultationState,
  type SetOutcomeState,
} from "@/features/enrollment/server/actions";

// 🔴 라벨을 여기서 따로 정의하지 말 것 — 예전엔 정본과 같은 이름의 로컬 배열이라 import된 것처럼
// 보였는데 실은 하드코딩이었다. 그래서 정본을 바꾸면 **이 모달에서 고른 라벨과 보드에 찍히는 라벨이
// 달라진다**(가장 찾기 어려운 분열). 값을 실제로 DB에 쓰는 유일한 UI라 특히 정본을 따라야 한다.

// 상세 상단 '상태 변경' 버튼. (수정은 전체 편집 페이지 /enrollment/[id]/edit 하나로 통일 — 모달 quick-edit 제거.)
export type ConsultValues = { id: string; outcome: string };

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="bg-background border-border w-full max-w-md rounded-xl border p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-3 flex items-start justify-between gap-2">
          <h2 className="text-foreground text-base font-bold">{title}</h2>
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
  // '재원생 등록'으로 처리된 상담은 이전 단계로 되돌릴 수 없다 — 유지 또는 '거절'만 허용(서버도 이중 방어).
  // ⚠️ 문구에 "배정 완료"를 쓰지 말 것 — 판정은 outcome='enrolled'인데 화면의 "반 배정 완료"는
  //    수강 여부라는 **다른 기준**이라, 반 배정이 없는 건에도 "배정 완료"라는 거짓 안내가 뜬다.
  const isConverted = current === "enrolled";
  const allowed = (v: string) => !isConverted || v === "enrolled" || v === "declined";
  return (
    <Modal title="상태 변경" onClose={onClose}>
      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="outcome" value={selected} />
        <div className="flex flex-wrap gap-2">
          {OUTCOME_OPTIONS.map((o) => {
            const disabled = !allowed(o.value);
            return (
              <button
                key={o.value}
                type="button"
                disabled={disabled}
                onClick={() => setSelected(o.value)}
                title={disabled ? "‘재원생 등록’으로 처리된 상담은 이전 단계로 되돌릴 수 없습니다" : undefined}
                className={`rounded-full border px-2.5 py-1 text-xs transition ${
                  disabled
                    ? "border-line text-text-faint cursor-not-allowed opacity-40"
                    : selected === o.value
                      ? "border-primary bg-primary text-primary-foreground font-medium"
                      : "border-line text-text-dim hover:bg-bg-soft"
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
        {isConverted ? (
          <p className="text-text-dim text-[11px]">
            ‘재원생 등록’으로 처리된 상담은 대기·예약 등 이전 단계로 되돌릴 수 없습니다. 취소는 ‘거절’로 처리하세요.
          </p>
        ) : null}
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

function DeleteSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" size="sm" disabled={pending}>
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
      삭제 확인
    </Button>
  );
}

/**
 * 등록상담 완전 삭제 — 2단계 인라인 확인(MeetingDeleteButton 패턴). 성공 시 서버가 /enrollment로 redirect.
 * cascade로 AI 분석도 함께 삭제. makeedu 동기화 상담은 다음 동기화에 다시 추가될 수 있음(자체 테스트 카드는 영구).
 */
export function ConsultationDeleteButton({ id }: { id: string }) {
  const [armed, setArmed] = useState(false);
  const [state, action] = useActionState<DeleteConsultationState, FormData>(
    deleteEnrollmentConsultation,
    undefined,
  );

  if (!armed) {
    return (
      <Button variant="outline" size="sm" onClick={() => setArmed(true)}>
        <Trash2 className="size-3.5" />
        삭제
      </Button>
    );
  }

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="redirectTo" value="/enrollment" />
      <DeleteSubmit />
      <Button type="button" variant="ghost" size="sm" onClick={() => setArmed(false)}>
        취소
      </Button>
      {state?.error ? <span className="text-chart-4 text-xs">{state.error}</span> : null}
    </form>
  );
}
