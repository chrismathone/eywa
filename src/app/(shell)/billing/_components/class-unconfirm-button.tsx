"use client";
import { useState, useTransition } from "react";
import { Loader2 } from "@/components/icons/eywa-icon-compat";
import { unconfirmClassTerms } from "@/features/billing/session-terms/server/class-unconfirm-actions";
import { isVirtualTermId } from "@/features/billing/session-terms/month-roster";
import type { SessionTermRow } from "@/features/billing/session-terms/server/queries";
import { useSessionTermsState } from "./session-terms-state";

/** 이름 목록을 짧게 — `김지우, 박경현 외 3명`. */
const namesText = (names: string[]) => `${names.slice(0, 2).join(", ")}${names.length > 2 ? ` 외 ${names.length - 2}명` : ""}`;

/**
 * '전체 확정 해제' — 반의 (보이는) 반 일괄 대상(예정 있는 줄)이 **전부 확정**됐을 때 반 머리 줄의 입력칸·'단가 일괄 입력'·'선택 일괄 확정' 자리에 선다
 * (원장 2026-09-17 *"반전체가 확정이 된 경우는 '전체 확정 해제' 버튼으로 대체"* · *"하나만 해제해도 이전으로 돌아가도록"*).
 * 어느 쪽을 세울지는 부모가 **화면에 반영된 확정 상태**로 매번 판정한다 — 행 하나를 해제하면 곧바로 입력칸이 돌아온다.
 * 돈이 걸린 값을 여러 명 한꺼번에 지우므로 누르기 전에 한 번 묻는다.
 */
const KRW = new Intl.NumberFormat("ko-KR");

export function ClassUnconfirmButton({
  period,
  classId,
  className,
  /**
   * 이 반에 **보이는 확정된 실 행** — 해제 전 값. 반 일괄 대상(예정 있는 줄)이 전부 확정이면 이 버튼이 서므로, 예정 없는 줄(보강 방문)이
   * 미확정으로 섞여 있을 수 있다 — 그 줄은 해제할 확정이 없어 보내지 않는다(가상 줄도 마찬가지).
   */
  rows: allRows,
  /** EiE 월 정액 반이면 지금 설정의 월 금액 — 입력칸 자리에 서던 표시를 유지한다(설정이 바뀌었는지 보이게). */
  monthlyPrice,
  /** 해제된 행(해제 전 값) — 부모가 입력칸을 그 값으로 되채우고 체크 선택을 푼다(개별 해제와 같게). */
  onReleased,
}: {
  period: string;
  classId: string;
  className: string;
  rows: SessionTermRow[];
  monthlyPrice: number | null;
  onReleased: (rows: SessionTermRow[]) => void;
}) {
  const { apply } = useSessionTermsState();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  // 전체 해제는 확정된 실 행만 — 가상 id(회차 행 없음)·미확정 줄은 해제할 확정이 없다(부모도 거르지만 한 번 더 — 확인 창의 인원이 거짓이 된다).
  const rows = allRows.filter((r) => r.confirmedSessions !== null && !isVirtualTermId(r.id));

  function run() {
    if (rows.length === 0) return;
    if (!confirm(`${className} ${rows.length}명의 확정을 모두 해제할까요?\n확정 시수·단가·금액이 지워지고 미확정으로 돌아갑니다(예정 시수는 그대로).`)) return;
    setMessage(null);
    const nameOf = new Map(rows.map((r) => [r.id, r.studentName]));
    start(async () => {
      try {
        const res = await unconfirmClassTerms(period, classId, rows.map((r) => r.id));
        if (res.terms?.length) {
          const releasedIds = new Set(res.terms.map((t) => t.id));
          onReleased(rows.filter((r) => releasedIds.has(r.id)));
          apply(res.terms);
        }
        const failedNames = (res.failedIds ?? []).map((id) => nameOf.get(id)).filter((n): n is string => !!n);
        if (res.error) {
          const text = failedNames.length ? `${res.error} (${namesText(failedNames)})` : res.error;
          // 일부라도 해제되면 반이 '전부 확정'이 아니게 되어 이 버튼(과 문구)이 곧바로 입력칸으로 바뀐다 — 문구가 사라지지 않게 창으로 알린다.
          if (res.terms?.length) alert(text);
          else setMessage(text);
        }
      } catch {
        setMessage("해제하지 못했습니다. 다시 시도해 주세요");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
      {monthlyPrice !== null ? <span className="text-primary text-sm font-bold">EiE 월 {KRW.format(monthlyPrice)}원</span> : null}
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="border-line text-foreground hover:bg-bg-soft inline-flex items-center gap-1 rounded-lg border bg-card px-2.5 py-1 text-xs font-bold transition disabled:opacity-50"
      >
        {pending ? <Loader2 className="size-3 animate-spin" /> : null}
        {pending ? "해제 중…" : "전체 확정 해제"}
      </button>
      </div>
      {message ? (
        <p role="alert" className="text-danger max-w-[36rem] text-right text-xs whitespace-normal">
          {message}
        </p>
      ) : null}
    </div>
  );
}
