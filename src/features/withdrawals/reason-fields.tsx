"use client";

import { useEffect, useRef, useState } from "react";
import { REASON_LABEL, type WithdrawalReason } from "./types";
import { REASON_DETAILS, detailFor, memoRequired } from "./reason-detail";

const REASON_OPTIONS = (Object.entries(REASON_LABEL) as [WithdrawalReason, string][]).map(([value, label]) => ({ value, label }));

/**
 * 퇴원·수강 종료 사유 입력 한 벌 — 대분류(`reason`) · 세부(`detail`, 선택) · 메모(`memo`, 기타는 필수).
 * 학생 상태 전환 창(퇴원·부분 종료)과 퇴원 상세의 사유 카드가 같은 부품을 쓴다(두 벌이면 한쪽만 고쳐진다 — #77).
 * 서버도 같은 규칙으로 다시 본다(`checkReasonInput`) — 여기 `required`는 도움일 뿐 게이트가 아니다.
 * 세부는 대분류를 바꾸면 비운다(다른 대분류의 세부가 남지 않게 — `key`로 다시 마운트).
 * ⚠️ `<form action>` 폼은 제출하면 React가 폼을 처음 값으로 되돌린다(#83) — 고른 대분류(state)도 폼의 `reset`을 듣고 함께
 *    되돌린다(안 그러면 화면은 '고르세요'인데 세부 칸은 옛 대분류의 것이 남는다).
 */
export function ReasonFields({
  reasonLabel,
  initialReason,
  initialDetail,
  initialMemo,
  memoPlaceholder,
  labelClassName,
  controlClassName,
}: {
  reasonLabel: string;
  /** null = 아직 안 고름(고르세요 칸에서 시작 — 첫 항목이 저절로 골라져 한쪽 사유로 쏠리지 않게). */
  initialReason: WithdrawalReason | null;
  initialDetail?: string | null;
  initialMemo?: string | null;
  memoPlaceholder: string;
  labelClassName: string;
  controlClassName: string;
}) {
  const [reason, setReason] = useState<WithdrawalReason | null>(initialReason);
  const selectRef = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    const form = selectRef.current?.form;
    if (!form) return;
    const onReset = () => setReason(initialReason);
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [initialReason]);
  const details = reason ? REASON_DETAILS[reason] : [];
  const needsMemo = reason ? memoRequired(reason) : false;
  return (
    <>
      <div className="space-y-1.5">
        <label htmlFor="withdrawal-reason" className={labelClassName}>
          {reasonLabel}
        </label>
        <select
          ref={selectRef}
          id="withdrawal-reason"
          name="reason"
          required
          defaultValue={initialReason ?? ""}
          onChange={(e) => setReason((e.target.value || null) as WithdrawalReason | null)}
          className={controlClassName}
        >
          {initialReason ? null : (
            <option value="" disabled>
              사유를 고르세요
            </option>
          )}
          {REASON_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {details.length ? (
        <div className="space-y-1.5">
          <label htmlFor="withdrawal-detail" className={labelClassName}>
            세부 사유 <span className="text-text-faint font-normal">(선택)</span>
          </label>
          <select
            key={reason}
            id="withdrawal-detail"
            name="detail"
            defaultValue={detailFor(reason, initialDetail) ?? ""}
            className={controlClassName}
          >
            <option value="">고르지 않음</option>
            {details.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="space-y-1.5">
        <label htmlFor="withdrawal-memo" className={labelClassName}>
          {needsMemo ? "메모 (필수 — 실제 사유)" : "상세 메모"}
        </label>
        <textarea
          id="withdrawal-memo"
          name="memo"
          rows={3}
          required={needsMemo}
          defaultValue={initialMemo ?? ""}
          placeholder={needsMemo ? `'${REASON_LABEL.other}'는 실제 사유를 적어 주세요` : memoPlaceholder}
          className={controlClassName}
        />
      </div>
    </>
  );
}
