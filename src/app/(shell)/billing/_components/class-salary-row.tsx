"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Check, Loader2 } from "@/components/icons/aywa-icon-compat";
import { saveClassSalary, type SaveClassSalaryState } from "@/features/payroll/server/class-salary-actions";
import { SALARY_GROUPS } from "@/features/payroll/salary-group";
import { formatDowKeys } from "@/features/payroll/apportion";

/** 요일 체크박스 — 아무것도 안 고르면 '전 요일'(안분 없음). 주말만 비율제인 반에서 토·일만 체크한다. */
const DOWS: { key: string; label: string }[] = [
  { key: "mon", label: "월" },
  { key: "tue", label: "화" },
  { key: "wed", label: "수" },
  { key: "thu", label: "목" },
  { key: "fri", label: "금" },
  { key: "sat", label: "토" },
  { key: "sun", label: "일" },
];
import type { ClassSalaryRow } from "@/features/payroll/server/class-salary-queries";

function SaveBtn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="border-line text-text-dim hover:text-foreground inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition disabled:opacity-40"
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
export function ClassSalaryRowForm({
  row,
  canEdit,
}: {
  row: ClassSalaryRow;
  /**
   * 급여 정책 쓰기(`canManageSalary` — 서버 saveClassSalary와 같은 판정). false면 '저장'을 그리지 않는다
   * (칸은 부모의 비활성 fieldset이 잠근다 — 원장 2026-11-05 읽기 권한 규칙, write-lock.ts).
   */
  canEdit: boolean;
}) {
  const [state, formAction] = useActionState<SaveClassSalaryState, FormData>(saveClassSalary, undefined);
  // ⚠️ select를 controlled state로 두면 저장 후 화면이 거짓말을 한다: React 19는 `<form action>` 제출마다
  // 폼을 자동 리셋하는데, state는 그대로라 "저장했는데 선택이 풀린" 꼴이 된다(#83·폼 자동리셋 계열).
  // 그래서 값은 DOM(defaultValue=서버 값)에 맡기고, 표시도 **서버 값**만 쓴다 — 저장하면 revalidate로 갱신된다.
  const effective = row.manualGroup ?? row.autoGroup ?? null;

  return (
    <tr className="border-line/60 border-b last:border-0">
      <td className="text-foreground px-3 py-2 text-xs font-medium whitespace-nowrap">{row.className}</td>
      <td className="text-text-dim px-3 py-2 text-xs whitespace-nowrap">{row.teacherName ?? "—"}</td>
      <td className="px-3 py-2">
        {effective ? (
          <span className="text-text-dim text-xs">
            {effective}
            {!row.manualGroup && row.autoGroup ? <span className="text-text-faint"> (이름 자동)</span> : null}
          </span>
        ) : (
          // ⚠️ 추정하지 않는다(원장 결정) — 영어 코드명 반은 사람이 지정할 때까지 미분류로 둔다.
          <span className="text-amber-700 text-xs">미분류</span>
        )}
        {row.appliesDows?.length ? (
          <span
            className="text-text-faint ml-1.5 text-xs"
            title="이 요일 수업분만 비율제로 계산합니다(나머지 요일은 제외)"
          >
            {formatDowKeys(row.appliesDows)}만
          </span>
        ) : null}
      </td>
      <td className="px-3 py-2">
        <form action={formAction} className="flex flex-wrap items-center gap-1.5">
          <input type="hidden" name="classId" value={row.classId} />
          <select
            name="salaryGroup"
            defaultValue={row.manualGroup ?? ""}
            className="border-line bg-card text-foreground rounded-md border px-1.5 py-1 text-xs"
          >
            <option value="">자동(이름)</option>
            {SALARY_GROUPS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          {/* 🔴 반별 배분율(%) 입력은 걷었다(원장 2026-09-28 "급여는 출석부 기준") — 급여명세서·정산 면의 산식
              (tier-rows·computeTierSettlement)은 과정·적용 요일만 읽고 반별 %는 안 읽어 "저장됨"이 거짓 약속이었다.
              저장된 값은 hidden으로 그대로 보낸다(과정·요일만 고쳐도 지우지 않게). */}
          <input type="hidden" name="commissionRate" value={row.commissionRate ?? ""} />
          {/* 적용 요일 — 반 하나에 주말·평일이 섞인 경우(예: 토+수) 주말분만 비율제로 인정한다.
              전부 비우면 전 요일(안분 없음). 그 달 시수 기록이 없으면 화면이 '산정 보류'로 밝힌다. */}
          <span className="text-text-faint text-xs" title="비율제를 적용할 요일 — 비우면 전 요일">
            요일
          </span>
          {DOWS.map((d) => (
            <label key={d.key} className="text-text-dim inline-flex items-center gap-0.5 text-xs">
              <input
                type="checkbox"
                name={`dow_${d.key}`}
                defaultChecked={row.appliesDows?.includes(d.key) ?? false}
                className="size-3"
              />
              {d.label}
            </label>
          ))}
          {canEdit ? <SaveBtn /> : null}
          {state?.error ? <span className="text-danger text-xs">{state.error}</span> : null}
          {state?.ok ? <span className="text-text-faint text-xs">저장됨</span> : null}
        </form>
      </td>
    </tr>
  );
}
