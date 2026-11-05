"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Save } from "@/components/icons/aywa-icon-compat";
import { saveTeacherSplits, type SaveSplitsState } from "@/features/billing/session-terms/server/splits-actions";
import type { SplitsSnapshotStatus } from "@/features/billing/session-terms/server/splits-queries";
import type { SplitTotals } from "@/features/billing/session-terms/splits";

export type LiveSplits = SplitTotals & { fingerprint: string };

const fmtWon = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const fmtKst = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" });

function SaveButton({ disabled, label }: { disabled?: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="bg-primary text-primary-foreground inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition disabled:opacity-40"
    >
      {pending ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
      {label}
    </button>
  );
}

/**
 * 강사 분배 스냅샷 패널 — 저장 이력·현재 집계와의 드리프트 표시 + 저장 버튼(그 달 전체, 과목 필터 무관).
 * 기록 전용: 청구서(invoices)는 절대 변경하지 않는다(N2).
 */
export function SplitsSnapshotPanel({
  period,
  live,
  saved,
  canWrite,
}: {
  period: string;
  live: LiveSplits;
  saved: SplitsSnapshotStatus | null;
  /** 저장 단추를 세울지 — saveTeacherSplits와 같은 canWriteTenant(billing). 읽기 권한이면 기록 상태만 보여 준다(원장 2026-11-05). */
  canWrite: boolean;
}) {
  const [state, formAction] = useActionState<SaveSplitsState, FormData>(saveTeacherSplits, undefined);

  // 지문 비교 — 합계가 상쇄되는 변경(강사 재배정 등)까지 드리프트로 잡는다(적대 리뷰 픽스).
  const drift = saved !== null && saved.fingerprint !== live.fingerprint;
  // 스냅샷이 있으면 확정 0이어도 저장(=비우기) 가능해야 stale 기록을 정리할 수 있다.
  const canSave = live.rowCount > 0 || saved !== null;

  return (
    <div className="bg-bg-soft/40 flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <div className="text-xs leading-relaxed">
        {saved ? (
          <span className="text-text-dim">
            저장된 청구 분배 기록: <b className="num text-foreground">{saved.rowCount}</b>행 · 청구 기준{" "}
            <b className="num text-foreground">{fmtWon(saved.confirmedAmount)}</b> · 실측 기준{" "}
            <b className="num text-foreground">{fmtWon(saved.actualAmount)}</b> ·{" "}
            <span className="num">{fmtKst(saved.savedAt)}</span> 저장
            {drift ? (
              <span className="ml-1.5 rounded-full border border-amber/30 bg-amber-soft px-2 py-0.5 text-amber">
                {canWrite ? "현재 집계와 다릅니다 — 다시 저장하세요" : "현재 집계와 다릅니다"}
              </span>
            ) : (
              <span className="ml-1.5 rounded-full border border-green/30 bg-green-soft px-2 py-0.5 text-green">
                현재 집계와 일치
              </span>
            )}
          </span>
        ) : (
          <span className="text-text-dim">
            저장된 청구 분배 기록이 없습니다.
            {canWrite ? (
              <>
                {" "}확정 행(현재 <b className="num">{live.rowCount}</b>행)의 강사 분배를 기록으로 남기려면 저장하세요.
              </>
            ) : null}
          </span>
        )}
        {state && "saved" in state && state.saved !== undefined ? (
          <span className="text-green ml-1.5">
            저장 완료: {state.saved}행{state.skipped ? ` (미확정 ${state.skipped}행 제외)` : ""}
          </span>
        ) : null}
        {state?.error ? <span className="text-danger ml-1.5">{state.error}</span> : null}
      </div>
      <p className="text-text-dim text-xs">청구 기준 참고 기록입니다. 실제 급여는 출석부 기준으로 계산합니다.</p>

      {canWrite ? (
        <form action={formAction} className="flex items-center gap-2">
          <input type="hidden" name="period" value={period} />
          <span className="text-text-faint text-xs">그 달 전체 저장 · 청구서는 변경되지 않음</span>
          <SaveButton
            disabled={!canSave}
            label={live.rowCount === 0 && saved !== null ? "분배 기록 비우기(확정 0)" : "청구 분배 기록 저장"}
          />
        </form>
      ) : null}
    </div>
  );
}
