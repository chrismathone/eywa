"use client";
import { useTransition } from "react";
import { Loader2 } from "@/components/icons/eywa-icon-compat";
import { confirmSelectedTerms, type SelectedTermInput } from "@/features/billing/session-terms/server/selected-confirm-actions";
import { validSessionQuantity } from "@/features/billing/session-pricing";
import { isUntouchedScaledSessions } from "@/features/billing/session-terms/last-month-suggestion";
import type { SessionTermRow } from "@/features/billing/session-terms/server/queries";
import { useSessionTermsState } from "./session-terms-state";

export type TermDraft = { sessions: string; price: string };

/** 이름 목록을 짧게 — `김지우, 박경현 외 3명`. */
const namesText = (names: string[]) => `${names.slice(0, 2).join(", ")}${names.length > 2 ? ` 외 ${names.length - 2}명` : ""}`;

/** 선택 일괄 확정 전 확인 문구 — 지난 달 비율로 예정과 다르게 채운 시수(최대 5명 나열). */
export function scaledConfirmText(rows: SessionTermRow[]): string {
  const lines = rows.slice(0, 5).map((r) => `· ${r.studentName}: 예정 ${r.plannedSessions ?? 0} → ${r.lastMonth?.sessions}시수`);
  if (rows.length > 5) lines.push(`외 ${rows.length - 5}명`);
  return ["지난 달 비율로 예정과 다르게 채운 시수가 있습니다.", ...lines, "", "이대로 확정할까요?"].join("\n");
}

/**
 * 선택한 미확정 행을 **각 행에 보이는 값**(시수 칸 × 단가 칸, EiE는 월 금액)으로 확정할 입력으로 바꾼다 — 순수.
 * 빈 칸·잘못된 값이 하나라도 있으면 그 학생 이름을 돌려준다(일부만 조용히 확정하지 않는다).
 */
export function selectedTermInputs(
  rows: SessionTermRow[],
  draftOf: (row: SessionTermRow) => TermDraft,
): { items: SelectedTermInput[]; invalid: string[] } {
  const items: SelectedTermInput[] = [];
  const invalid: string[] = [];
  for (const row of rows) {
    const draft = draftOf(row);
    const sessions = draft.sessions.trim() === "" ? NaN : Number(draft.sessions);
    const monthly = row.monthlyPrice !== null;
    const priceText = draft.price.replace(/[,\s]/g, "");
    const unitPrice = monthly ? row.monthlyPrice! : priceText === "" ? NaN : Number(priceText);
    if (!validSessionQuantity(sessions) || !Number.isFinite(unitPrice) || unitPrice < 0) invalid.push(row.studentName);
    else items.push({ id: row.id, sessions, unitPrice, monthly });
  }
  return { items, invalid };
}

/**
 * '선택 일괄 확정' — 반 머리 줄의 '단가 일괄 입력' 오른쪽(원장 2026-09-17). 체크한 미확정 학생을 한 번에 확정한다.
 * 흐름: 단가 일괄 입력(칸 채움) → 확정할 학생만 체크 → 선택 일괄 확정.
 * 알림 문구는 반 머리 줄 둘째 줄에 선다(`onMessage`) — 버튼 옆에 붙이면 고정 영역이 넓어져 반 정보를 덮는다.
 */
export function SelectedConfirmButton({
  period,
  classId,
  rows,
  draftOf,
  onConfirmed,
  onMessage,
}: {
  period: string;
  classId: string;
  /** 이 반에서 체크된 **미확정** 행. */
  rows: SessionTermRow[];
  draftOf: (row: SessionTermRow) => TermDraft;
  onConfirmed: (ids: string[]) => void;
  onMessage: (message: string | null) => void;
}) {
  const { apply } = useSessionTermsState();
  const [pending, start] = useTransition();

  function run() {
    const { items, invalid } = selectedTermInputs(rows, draftOf);
    if (invalid.length) {
      onMessage(`시수·단가를 확인해 주세요: ${namesText(invalid)}`);
      return;
    }
    if (items.length === 0) return;
    // 🔴 지난 달 비율로 **예정과 다르게** 채운 시수가 손대지 않은 채 섞여 있으면 한 번 묻는다 — 한 달만 휴원·결석으로 줄였던 학생도
    //    같은 모양으로 채워져 화면만으로는 구분이 안 된다(적대적 리뷰 2026-09-17). 단가만 옮긴 칸은 묻지 않는다.
    const scaled = rows.filter((r) => isUntouchedScaledSessions(r, draftOf(r).sessions));
    if (scaled.length > 0 && !window.confirm(scaledConfirmText(scaled))) return;
    onMessage(null);
    const nameOf = new Map(rows.map((r) => [r.id, r.studentName]));
    start(async () => {
      try {
        const res = await confirmSelectedTerms(period, classId, items);
        if (res.terms?.length) {
          apply(res.terms);
          onConfirmed(res.terms.map((t) => t.id));
        }
        const failedNames = (res.failedIds ?? []).map((id) => nameOf.get(id)).filter((n): n is string => !!n);
        if (res.error) onMessage(`${failedNames.length ? `${res.error} (${namesText(failedNames)})` : res.error}${res.skipped ? ` · 이미 확정된 ${res.skipped}명은 건너뜀` : ""}`);
        else if (res.skipped) onMessage(`이미 확정된 ${res.skipped}명은 건너뛰었습니다`);
      } catch {
        onMessage("확정하지 못했습니다. 다시 시도해 주세요");
      }
    });
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={pending || rows.length === 0}
      title={rows.length === 0 ? "확정할 학생을 왼쪽 체크박스로 고르세요" : undefined}
      className="border-primary text-primary hover:bg-primary-soft inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-bold transition disabled:opacity-50"
    >
      {pending ? <Loader2 className="size-3 animate-spin" /> : null}
      선택 일괄 확정{rows.length ? ` (${rows.length})` : ""}
    </button>
  );
}
