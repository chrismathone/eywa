"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Check, Loader2 } from "@/components/icons/eywa-icon-compat";
import { saveClassSalary, type SaveClassSalaryState } from "@/features/payroll/server/class-salary-actions";
import { SALARY_GROUPS } from "@/features/payroll/salary-group";
import type { ClassSalaryRow } from "@/features/payroll/server/class-salary-queries";

function SaveBtn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="border-line text-text-dim hover:text-foreground inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition disabled:opacity-40"
    >
      {pending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
      저장
    </button>
  );
}

/**
 * 반 1개의 급여 설정 행(원장 전용) — 과정(수동) + 배분율(수동).
 * 자동 판정된 과정은 회색으로 보여주고, 비워두면 그대로 자동 판정을 쓴다.
 */
export function ClassSalaryRowForm({ row }: { row: ClassSalaryRow }) {
  const [state, formAction] = useActionState<SaveClassSalaryState, FormData>(saveClassSalary, undefined);
  // ⚠️ select를 controlled state로 두면 저장 후 화면이 거짓말을 한다: React 19는 `<form action>` 제출마다
  // 폼을 자동 리셋하는데, state는 그대로라 "저장했는데 선택이 풀린" 꼴이 된다(#83·폼 자동리셋 계열).
  // 그래서 값은 DOM(defaultValue=서버 값)에 맡기고, 표시도 **서버 값**만 쓴다 — 저장하면 revalidate로 갱신된다.
  const effective = row.manualGroup ?? row.autoGroup ?? null;

  return (
    <tr className="border-line/60 border-b last:border-0">
      <td className="text-foreground px-3 py-2 text-[12px] font-medium whitespace-nowrap">{row.className}</td>
      <td className="text-text-dim px-3 py-2 text-[11px] whitespace-nowrap">{row.teacherName ?? "—"}</td>
      <td className="px-3 py-2">
        {effective ? (
          <span className="text-text-dim text-[11px]">
            {effective}
            {!row.manualGroup && row.autoGroup ? <span className="text-text-faint"> (이름 자동)</span> : null}
          </span>
        ) : (
          // ⚠️ 추정하지 않는다(원장 결정) — 영어 코드명 반은 사람이 지정할 때까지 미분류로 둔다.
          <span className="text-amber-700 text-[11px]">미분류</span>
        )}
      </td>
      <td className="px-3 py-2">
        <form action={formAction} className="flex flex-wrap items-center gap-1.5">
          <input type="hidden" name="classId" value={row.classId} />
          <select
            name="salaryGroup"
            defaultValue={row.manualGroup ?? ""}
            className="border-line bg-card text-foreground rounded-md border px-1.5 py-1 text-[11px]"
          >
            <option value="">자동(이름)</option>
            {SALARY_GROUPS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <label className="text-text-dim inline-flex items-center gap-0.5 text-[11px]">
            <input
              name="commissionRate"
              defaultValue={row.commissionRate ?? ""}
              inputMode="decimal"
              placeholder="비율"
              className="border-line bg-card text-foreground w-14 rounded-md border px-1.5 py-1 text-[11px]"
            />
            %
          </label>
          <SaveBtn />
          {state?.error ? <span className="text-danger text-[11px]">{state.error}</span> : null}
          {state?.ok ? <span className="text-text-faint text-[11px]">저장됨</span> : null}
        </form>
      </td>
    </tr>
  );
}
