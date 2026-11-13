"use client";

import { useActionState, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Tag, Trash2, X } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import {
  BOARD_STAGE_OPTIONS,
  ASSIGNED_DRAG_BLOCKED,
  ENROLLED_REVERT_BLOCKED,
  outcomeForDrop,
  stageOfCard,
  type BoardStageKey,
} from "@/features/enrollment/board-stages";
import {
  deleteEnrollmentConsultation,
  setEnrollmentOutcome,
  type DeleteConsultationState,
  type SetOutcomeState,
} from "@/features/enrollment/server/actions";

// 🔴 라벨을 여기서 따로 정의하지 말 것 — 예전엔 정본과 같은 이름의 로컬 배열이라 import된 것처럼
// 보였는데 실은 하드코딩이었다. 그래서 정본을 바꾸면 **이 모달에서 고른 라벨과 보드에 찍히는 라벨이
// 달라진다**(가장 찾기 어려운 분열). 값을 실제로 DB에 쓰는 유일한 UI라 특히 정본을 따라야 한다.
// (2026-09-01: 정본이 outcome 7종 → 칸 4단계로 바뀌었다 — board-stages.BOARD_STAGE_OPTIONS.)

// 상세 상단 '상태 변경' 버튼. (수정은 전체 편집 페이지 /enrollment/[id]/edit 하나로 통일 — 모달 quick-edit 제거.)
export type ConsultValues = { id: string; outcome: string; assignedClassCount?: number };

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

/**
 * 상태 변경 — 🔴 **칸반과 같은 4단계**(원장 2026-09-01 *"상태변경 수정은 안했나본데"*).
 *
 * 고르는 건 칸이고 저장되는 건 outcome 원값이다: 대표값 규칙(`outcomeForDrop`)이 드래그와 **같은
 * 함수**라, 원래 값이 그 칸 안이면 유지된다(예약→상담 전을 고르면 '예약'인 채로 남는다).
 * ⚠️ 그래서 **'예약'·'노쇼'를 새로 지정하는 길은 없다**(있던 값만 보존). 필요해지면 칸을 늘리는 게
 *    아니라 이 화면에 원값 선택을 되살릴 것 — 칸반과 라벨이 갈리지 않게.
 */
function OutcomeDialog({ id, current, assignedClassCount, onClose }: { id: string; current: string; assignedClassCount: number; onClose: () => void }) {
  const [selected, setSelected] = useState<BoardStageKey>(() => stageOfCard({ outcome: current, assignedClassCount }));
  const [state, action] = useActionState<SetOutcomeState, FormData>(setEnrollmentOutcome, undefined);
  if (state?.ok) queueMicrotask(onClose);
  // '등록 완료'로 처리된 상담은 이전 단계로 되돌릴 수 없다 — 유지 또는 '미등록'만 허용(서버도 이중 방어).
  // ⚠️ 문구에 "반 배정 완료"를 쓰지 말 것 — 판정은 outcome='enrolled'인데 화면의 "반 배정 완료"는
  //    수강 여부라는 **다른 기준**이라, 반 배정이 없는 건에도 거짓 안내가 뜬다.
  const isConverted = current === "enrolled";
  const allowed = (v: BoardStageKey) => assignedClassCount > 0 ? v === "enrolled" : !isConverted || v === "enrolled" || v === "unregistered";
  return (
    <Modal title="상태 변경" onClose={onClose}>
      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={id} />
        {/* 실제로 저장되는 값은 칸이 아니라 **대표 outcome**(드래그와 같은 규칙). */}
        <input type="hidden" name="outcome" value={outcomeForDrop(selected, current)} />
        <div className="flex flex-wrap gap-2">
          {BOARD_STAGE_OPTIONS.map((o) => {
            const disabled = !allowed(o.value);
            return (
              <button
                key={o.value}
                type="button"
                disabled={disabled}
                onClick={() => setSelected(o.value)}
                title={disabled ? (assignedClassCount > 0 ? ASSIGNED_DRAG_BLOCKED : ENROLLED_REVERT_BLOCKED) : undefined}
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
        {assignedClassCount > 0 ? <p className="text-text-dim text-xs">{ASSIGNED_DRAG_BLOCKED}</p> : isConverted ? (
          // 🔴 서버가 던지는 문장과 **같은 상수** — 한쪽만 고치면 안내가 갈린다.
          <p className="text-text-dim text-xs">{ENROLLED_REVERT_BLOCKED}</p>
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
      {/* 🔴 헤더 액션은 공용 `<Button>` **기본 크기**로 통일한다(디자인 규칙, 원장 2026-09-01
          *"제각각인 버튼 크기 통일시켜"*) — 옆의 '상담 수정'·'인쇄 미리보기'·'학생 정보 보기'가
          전부 기본 크기라 여기만 sm이면 한 줄에서 키가 안 맞는다. 아이콘도 size-4로 맞춘다. */}
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Tag className="size-4" />
        상태 변경
      </Button>
      {open ? <OutcomeDialog id={values.id} current={values.outcome} assignedClassCount={values.assignedClassCount ?? 0} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function DeleteSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
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
      <Button variant="outline" onClick={() => setArmed(true)}>
        <Trash2 className="size-4" />
        삭제
      </Button>
    );
  }

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="redirectTo" value="/enrollment?list=1" />
      <DeleteSubmit />
      <Button type="button" variant="ghost" onClick={() => setArmed(false)}>
        취소
      </Button>
      {state?.error ? <span className="text-chart-4 text-xs">{state.error}</span> : null}
    </form>
  );
}
