"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, Loader2, Pencil } from "@/components/icons/aywa-icon-compat";
import { saveTeacherComp, type SaveCompState } from "@/features/payroll/server/comp-actions";
import type { SalaryType } from "@/features/payroll/settlement";
import { SALARY_GROUPS, type GroupRates } from "@/features/payroll/salary-group";
import { teacherCompSummary } from "./teacher-comp-summary";

const TYPE_LABEL: Record<SalaryType, string> = {
  commission: "비율제",
  fixed: "급여제",
  hybrid: "혼합",
};

function SaveBtn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-primary text-primary-foreground inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold transition disabled:opacity-40"
    >
      {pending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
      저장
    </button>
  );
}

/**
 * 강사 급여 정책 인라인 편집(master 전용). 접힘 = 현재 방식 요약, 펼침 = 방식·배분율·기본급 폼.
 * 저장 성공 시 부모(정산 화면)가 revalidate로 재산정 — 폼은 접힌다.
 */
export function TeacherCompEditor({
  userId,
  salaryType,
  commissionRate,
  monthlyBase,
  groupRates,
  canEdit,
}: {
  userId: string;
  salaryType: SalaryType | null;
  commissionRate: number | null;
  monthlyBase: number;
  /** 과정별 배분율(초·중·고·수능·특강). 비면 기본 비율만 쓴다. */
  groupRates?: GroupRates | null;
  /**
   * 급여 정책 쓰기(`canManageSalary` — 서버 saveTeacherComp와 같은 판정). false면 요약 글만 보이고
   * 편집 폼을 여는 단추를 그리지 않는다(원장 2026-11-05 읽기 권한 규칙, write-lock.ts).
   */
  canEdit: boolean;
}) {
  const [state, formAction] = useActionState<SaveCompState, FormData>(saveTeacherComp, undefined);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<SalaryType | "">(salaryType ?? "");
  // 저장 성공(nonce 신규) 시 폼을 접는다 — useEffect 없이 렌더 중 조정(#25 setState-in-effect 회피).
  const [seenNonce, setSeenNonce] = useState(0);
  if (state?.ok && state.nonce && state.nonce !== seenNonce) {
    setSeenNonce(state.nonce);
    if (open) setOpen(false);
  }

  const { text: summary, groupSpan } = teacherCompSummary({
    salaryType,
    commissionRate,
    monthlyBase,
    groupRates,
  });

  if (!canEdit) {
    // 읽기 권한 — 지금 방식 요약만(비활성 단추로 남겨 두지 않는다).
    return (
      <span className="text-text-dim inline-flex items-center gap-1 px-2 py-1 text-xs">
        {summary}
        {groupSpan ? <span className="text-text-faint">{groupSpan}</span> : null}
      </span>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-line text-text-dim hover:text-foreground inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition"
        title="급여 정책 설정"
      >
        <Pencil className="size-3" />
        {summary}
        {groupSpan ? <span className="text-text-faint">{groupSpan}</span> : null}
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="userId" value={userId} />
      <select
        name="salaryType"
        value={type}
        onChange={(e) => setType(e.target.value as SalaryType | "")}
        className="border-line bg-card text-foreground rounded-md border px-1.5 py-1 text-xs"
      >
        <option value="">미설정</option>
        {(["commission", "fixed", "hybrid"] as SalaryType[]).map((t) => (
          <option key={t} value={t}>
            {TYPE_LABEL[t]}
          </option>
        ))}
      </select>
      {type === "commission" || type === "hybrid" ? (
        <label className="text-text-dim inline-flex items-center gap-0.5 text-xs">
          <input
            name="commissionRate"
            defaultValue={commissionRate ?? ""}
            inputMode="decimal"
            placeholder="배분율"
            className="border-line bg-card text-foreground w-14 rounded-md border px-1.5 py-1 text-xs"
          />
          %
        </label>
      ) : (
        <input type="hidden" name="commissionRate" value={commissionRate ?? ""} />
      )}
      {type === "commission" || type === "hybrid" ? (
        <div className="border-line flex w-full flex-wrap items-center gap-1.5 rounded-md border border-dashed px-2 py-1.5">
          <span className="text-text-faint text-xs">과정별</span>
          {SALARY_GROUPS.map((g) => (
            <label key={g} className="text-text-dim inline-flex items-center gap-0.5 text-xs">
              {g}
              <input
                name={`rate_${g}`}
                defaultValue={groupRates?.[g] ?? ""}
                inputMode="decimal"
                placeholder="—"
                className="border-line bg-card text-foreground w-11 rounded-md border px-1 py-0.5 text-xs"
              />
              %
            </label>
          ))}
          <span className="text-text-faint text-xs">비우면 위 기본 배분율 적용</span>
        </div>
      ) : null}
      {type === "fixed" || type === "hybrid" ? (
        <label className="text-text-dim inline-flex items-center gap-0.5 text-xs">
          <input
            name="monthlyBase"
            defaultValue={monthlyBase || ""}
            inputMode="numeric"
            placeholder="기본급"
            className="border-line bg-card text-foreground w-24 rounded-md border px-1.5 py-1 text-xs"
          />
          원
        </label>
      ) : (
        <input type="hidden" name="monthlyBase" value={monthlyBase || ""} />
      )}
      <SaveBtn />
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-text-dim hover:text-foreground px-1 text-xs"
      >
        취소
      </button>
      {state?.error ? <span className="text-danger w-full text-xs">{state.error}</span> : null}
    </form>
  );
}
