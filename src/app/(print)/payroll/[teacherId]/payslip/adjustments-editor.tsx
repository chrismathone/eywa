"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  issuePayslip,
  savePayslipAdjustments,
  unissuePayslip,
  type SavePayslipState,
} from "@/features/payroll/server/payslip-actions";
import { BLOG_PENALTY_POINTS } from "@/features/payroll/payslip";
import type { PayslipAdjustments } from "@/features/payroll/payslip-view";

/**
 * 명세서 월별 조정 입력 — **화면에만** 뜨고 종이에는 안 찍힌다(print:hidden).
 *
 * ⚠️ 입력은 uncontrolled(defaultValue)이고 저장된 값 + 거부된 제출값으로 `key`를 만든다 —
 *    React 19는 서버액션 폼을 제출할 때마다 자동 리셋하는데([[#83]]) 리셋 후엔 직전 렌더의
 *    defaultValue로 돌아간다. 저장 성공이면 갱신값이, **거부면 방금 친 값이** 다시 들어와야 한다.
 */
export function AdjustmentsEditor({
  teacherId,
  period,
  adjustments,
  canIssue,
}: {
  teacherId: string;
  period: string;
  adjustments: PayslipAdjustments;
  /** 산정이 끝나 발행 가능한 상태인가(수업료를 못 냈으면 발행 금지). */
  canIssue: boolean;
}) {
  const [state, action, pending] = useActionState<SavePayslipState, FormData>(savePayslipAdjustments, undefined);
  const [issueState, issueAction, issuing] = useActionState<SavePayslipState, FormData>(
    adjustments.status === "issued" ? unissuePayslip : issuePayslip,
    undefined,
  );

  const a = adjustments;
  const issued = a.status === "issued";
  // 거부된 제출값이 있으면 그것을 우선 — 없으면 저장값.
  const v = state?.values;
  const dv = {
    incentive: v?.incentive ?? (a.incentive || ""),
    otherDeduction: v?.otherDeduction ?? (a.otherDeduction || ""),
    blogWrittenOn: v?.blogWrittenOn ?? (a.blogWrittenOn ?? ""),
    ratePenaltyPoints: v?.ratePenaltyPoints ?? (a.ratePenaltyPoints || ""),
    memo: v?.memo ?? (a.memo ?? ""),
    penaltyOn: v ? v.blogPenalty === "on" : a.ratePenaltyPoints > 0,
  };
  const formKey = `${state?.nonce ?? 0}|${a.incentive}|${a.otherDeduction}|${a.blogWrittenOn ?? ""}|${a.ratePenaltyPoints}|${a.memo ?? ""}`;

  // 🔴 체크박스가 1차 컨트롤이다(서버도 같은 순서) — 풀면 숫자 칸을 함께 비워 화면과 저장값이 어긋나지 않게.
  const [penaltyOn, setPenaltyOn] = useState(dv.penaltyOn);
  const [penaltyPoints, setPenaltyPoints] = useState(String(dv.ratePenaltyPoints));

  return (
    <div className="print:hidden mb-6 space-y-3">
      <form key={formKey} action={action} className="border-line bg-bg-soft rounded-2xl border p-4 text-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">명세서 입력값</h2>
          <p className="text-text-dim text-xs">
            수업료 총액·수업인원·퇴원생은 출결에서 자동 계산됩니다. 여기서는 시트에서 손으로 채우던 칸만 입력합니다.
          </p>
        </div>

        <input type="hidden" name="teacherId" value={teacherId} />
        <input type="hidden" name="period" value={period} />

        <fieldset disabled={issued || pending} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="인센티브" hint="지급총액에 더해짐">
            <input
              name="incentive"
              defaultValue={dv.incentive}
              inputMode="numeric"
              placeholder="0"
              className="num border-line w-full rounded-lg border px-2 py-1.5 text-right"
            />
          </Field>
          <Field label="기타공제" hint="과세표준에서 먼저 뺌">
            <input
              name="otherDeduction"
              defaultValue={dv.otherDeduction}
              inputMode="numeric"
              placeholder="0"
              className="num border-line w-full rounded-lg border px-2 py-1.5 text-right"
            />
          </Field>
          {/* ⚠️ 힌트를 붙이면 라벨이 두 줄로 접혀 옆 칸들과 높이가 어긋난다(원장 지적) — 안내는 placeholder로. */}
          <Field label="내신분석(블로그) 작성일">
            <input
              name="blogWrittenOn"
              defaultValue={dv.blogWrittenOn}
              placeholder="7/1 또는 2026-07-01"
              className="border-line w-full rounded-lg border px-2 py-1.5"
            />
          </Field>
          <Field label="배분율 차감" hint={`체크 = −${BLOG_PENALTY_POINTS}%p`}>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  name="blogPenalty"
                  checked={penaltyOn}
                  onChange={(e) => {
                    setPenaltyOn(e.target.checked);
                    if (!e.target.checked) setPenaltyPoints(""); // 풀면 숫자도 비운다
                  }}
                  className="size-4"
                />
                <span className="text-xs">미작성</span>
              </label>
              <input
                name="ratePenaltyPoints"
                value={penaltyPoints}
                onChange={(e) => setPenaltyPoints(e.target.value)}
                disabled={!penaltyOn}
                inputMode="decimal"
                placeholder="자동"
                title={`체크했을 때만 적용됩니다. 비우면 −${BLOG_PENALTY_POINTS}%p, 값을 넣으면 그 값.`}
                className="num border-line w-16 rounded-lg border px-2 py-1.5 text-right disabled:opacity-40"
              />
            </div>
          </Field>
          <div className="sm:col-span-2 lg:col-span-4">
            <Field label="메모" hint="명세서에는 인쇄되지 않음">
              <input
                name="memo"
                defaultValue={dv.memo}
                className="border-line w-full rounded-lg border px-2 py-1.5"
              />
            </Field>
          </div>
        </fieldset>

        <div className="mt-3 flex items-center justify-between gap-3">
          <p aria-live="polite" className="text-xs">
            {issued ? (
              <span className="text-text-dim">
                발행 완료라 값이 잠겨 있습니다{a.issuedAt ? ` (${a.issuedAt.slice(0, 10)})` : ""}. 바꾸려면 아래에서
                발행을 취소하세요.
              </span>
            ) : state?.error ? (
              <span className="text-red-700">{state.error}</span>
            ) : state?.ok ? (
              <span className="text-emerald-700">저장했습니다.</span>
            ) : null}
          </p>
          <Button type="submit" disabled={issued || pending}>
            {pending ? "저장 중…" : "저장"}
          </Button>
        </div>
      </form>

      {/* 발행 — 그 시점 금액을 동결한다. 이게 있어야 "서명한 종이와 화면이 갈리지 않는다"가 성립한다. */}
      <form action={issueAction} className="border-line flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm">
        <input type="hidden" name="teacherId" value={teacherId} />
        <input type="hidden" name="period" value={period} />
        <p className="text-text-dim text-xs">
          {issued
            ? "발행되어 금액이 동결됐습니다 — 출결을 고쳐도 이 명세서는 바뀌지 않습니다."
            : "발행하면 지금 금액이 그대로 동결됩니다(이후 출결 수정에도 안 바뀜)."}
          {issueState?.error ? <span className="ml-2 text-red-700">{issueState.error}</span> : null}
        </p>
        <Button type="submit" variant={issued ? "outline" : "default"} disabled={issuing || (!issued && !canIssue)}>
          {issuing ? "처리 중…" : issued ? "발행 취소" : "발행(금액 동결)"}
        </Button>
      </form>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-text-dim mb-1 block text-xs">
        {label}
        {hint ? <span className="text-text-faint"> · {hint}</span> : null}
      </span>
      {children}
    </label>
  );
}
