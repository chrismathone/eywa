"use client";

import { isDirectEditClick } from "@/lib/direct-edit";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { notifyTermPlansChanged } from "@/features/billing/session-terms/plan-change-signal";
import { Check, Loader2, TriangleAlert, X } from "@/components/icons/aywa-icon-compat";
import {
  updateEnrollmentDates,
  type EnrollmentDateConfirm,
  type UpdateEnrollmentDatesState,
} from "@/features/enrollments/server/actions";

/**
 * 수강 시작/종료일 더블클릭 인라인 수정 (owner 전용 — 노출은 호출부가 게이트).
 * 학생 상세 수업 탭 + 반 상세 명단 + 퇴원 상세 공용. 종료는 비워서 저장하면 "재원중"으로 복귀.
 * 성공 시 1회만 닫고 배경 갱신(#67: state 객체 동일성 가드 — 매 제출이 새 객체라
 * 재오픈해도 stale 성공이 다시 발화하지 않음).
 *
 * 🔴 **기간을 줄여 이미 찍힌 출결을 밖으로 밀어내면 서버가 확인을 요구한다**(2026-09-10).
 *    이 컴포넌트는 그 확인창을 그릴 뿐이고 **판정과 게이트는 서버**다([[#77]]) — 여기서 확인을
 *    건너뛰어도 서명이 없으면 저장되지 않는다. 확인 재제출은 **입력칸이 아니라 서버가 돌려준 값**을
 *    싣는다(React 19가 제출마다 폼을 리셋해 입력칸이 비기 때문 — [[#83]]).
 */
export function EditableDateCell({
  enrollmentId,
  field,
  value,
  emptyLabel,
}: {
  enrollmentId: string;
  field: "start" | "end";
  value: string | null;
  /**
   * 종료일이 비었을 때 보여 줄 말(기본 `재원중`). 호출부가 이미 쓰던 문구가 있으면 넘긴다 —
   * 편집을 여는 것과 **라벨을 바꾸는 것은 다른 일**이고, 안 쓰던 말이 명단 전 줄에 새로 서면
   * 원장이 요청하지 않은 화면 변화가 된다(작업 선호: "이름 변경 = 라벨 문자열만").
   * 반 상세는 `~ 현재`(강사뷰 영어 전환 대상)를 그대로 유지하려고 이 구멍을 쓴다.
   */
  emptyLabel?: ReactNode;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState<UpdateEnrollmentDatesState, FormData>(
    updateEnrollmentDates,
    undefined,
  );
  const handled = useRef<unknown>(null);
  // 확인창을 '취소'로 물린 응답. **state 객체 자체**를 기억한다 — 같은 날짜를 다시 저장하면 새 응답
  // 객체가 오므로 확인창이 다시 뜬다(토큰으로 기억하면 두 번째 시도가 조용히 아무 일도 안 한다).
  const [dismissed, setDismissed] = useState<unknown>(null);
  useEffect(() => {
    if (state?.ok && handled.current !== state) {
      handled.current = state;
      setEditing(false);
      notifyTermPlansChanged();
      router.refresh();
    }
  }, [state, router]);

  const confirm = state?.confirm && state !== dismissed ? state.confirm : null;
  /**
   * 확인을 받으러 갔다 온 뒤 입력칸에 되살릴 값 — React 19가 제출마다 폼을 리셋해([[#83]]) 그냥 두면
   * '취소'로 물러난 순간 **원래 날짜**가 돌아와 사용자가 처음부터 다시 골라야 한다.
   * ⚠️ `key`로 remount해야 uncontrolled 입력의 `defaultValue`가 실제로 갈린다.
   */
  const attempted = state?.confirm?.value ?? null;

  if (!editing) {
    return (
      <button
        type="button"
        onDoubleClick={() => setEditing(true)}
        onClick={(event) => { if (isDirectEditClick(event)) setEditing(true); }}
        title="터치 또는 더블클릭하여 수정"
        className="hover:bg-bg-soft -mx-1 cursor-text rounded px-1 py-0.5 text-left transition"
      >
        {field === "start" ? (
          <span className="text-text-dim num">{value}</span>
        ) : value ? (
          <span className="text-amber num font-medium">~{value}</span>
        ) : (
          (emptyLabel ?? <span className="text-primary font-medium">재원중</span>)
        )}
      </button>
    );
  }

  return (
    <>
      <form action={formAction} className="inline-flex items-center gap-1">
        <input type="hidden" name="enrollmentId" value={enrollmentId} />
        <input type="hidden" name="field" value={field} />
        <input
          key={attempted ?? "original"}
          type="date"
          name="value"
          defaultValue={attempted ?? value ?? ""}
          autoFocus
          required={field === "start"}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(false);
          }}
          className="border-border bg-card text-foreground num rounded border px-1.5 py-0.5 text-xs"
        />
        <button
          type="submit"
          disabled={pending}
          title="저장"
          className="text-primary hover:bg-primary/10 rounded p-1 transition disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          title="취소"
          className="text-text-faint hover:bg-bg-soft rounded p-1 transition"
        >
          <X className="size-3.5" />
        </button>
        {field === "end" ? (
          <span className="text-text-faint ml-0.5 text-xs whitespace-nowrap">비우면 재원중</span>
        ) : null}
        {state?.error ? <span className="text-danger ml-0.5 text-xs">{state.error}</span> : null}
      </form>
      {confirm ? (
        <DateEditConfirmDialog
          enrollmentId={enrollmentId}
          confirm={confirm}
          pending={pending}
          formAction={formAction}
          onCancel={() => setDismissed(state)}
        />
      ) : null}
    </>
  );
}

/**
 * 저장하면 **조용히 깨지는 것**이 있을 때의 확인 — 막지 않고 한 번 더 묻는다(이유·문구는
 * [`date-edit.ts`](../date-edit.ts)가 단일 소스). 제목·본문 **둘 다 서버가 만든 문자열**이다.
 *
 * ⚠️ 인라인 패널이 아니라 창으로 띄운다 — 이 칸은 명단 한 줄 안이라 문장을 그 자리에 펼치면 행이
 *    통째로 밀리고, 카드가 `overflow`를 자르면 아예 안 보인다([[#128]]).
 */
function DateEditConfirmDialog({
  enrollmentId,
  confirm,
  pending,
  formAction,
  onCancel,
}: {
  enrollmentId: string;
  confirm: EnrollmentDateConfirm;
  pending: boolean;
  formAction: (formData: FormData) => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="수강 기간 정정 확인"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <div className="bg-background border-border w-full max-w-md rounded-2xl border p-6 shadow-lg">
        <header className="mb-3 flex items-start gap-2">
          <TriangleAlert className="text-amber mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="eyebrow">수강 기간 정정</p>
            {/* 🔴 제목을 여기 고정하지 말 것 — 걸린 위험에 따라 갈리므로 **서버가** 정해 내려보낸다.
                (출결이 한 건도 안 밀려나는데 "출결이 기간 밖이 됩니다"라고 쓰던 것을 고친 자리다.) */}
            <h2 className="text-foreground mt-0.5 text-base font-bold">{confirm.title}</h2>
          </div>
        </header>
        {/* 위험이 둘이면 서버가 빈 줄로 나눠 보낸다 — `pre-line`이라야 그 줄바꿈이 살아난다. */}
        <p className="text-text-dim text-sm leading-relaxed break-keep whitespace-pre-line">
          {confirm.message}
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          {pending ? <Loader2 className="text-text-faint size-4 animate-spin" /> : null}
          {/* ⚠️ autoFocus는 **취소**에 둔다 — 이 창은 사용자가 부른 게 아니라 저장을 누르자 끼어든
              경고다. 확인 버튼에 초점을 주면 습관적인 Enter 한 번이 그대로 저장이 된다(반대로
              여기 있으면 Enter·Esc 둘 다 안전하게 물러난다). */}
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            autoFocus
            className="text-text-dim hover:text-foreground px-3 py-1.5 text-sm disabled:opacity-50"
          >
            취소
          </button>
          {/* 확인 재제출 — 값은 서버가 돌려준 것을 그대로 싣는다(입력칸은 이미 리셋됐다, [[#83]]). */}
          <form action={formAction}>
            <input type="hidden" name="enrollmentId" value={enrollmentId} />
            <input type="hidden" name="field" value={confirm.field} />
            <input type="hidden" name="value" value={confirm.value ?? ""} />
            <input type="hidden" name="confirm" value={confirm.token} />
            <button
              type="submit"
              disabled={pending}
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-60"
            >
              그대로 저장
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
