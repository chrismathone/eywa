"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, Loader2, Pencil } from "@/components/icons/eywa-icon-compat";
import { saveTeacherComp, type SaveCompState } from "@/features/payroll/server/comp-actions";
import type { SalaryType } from "@/features/payroll/settlement";

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
}: {
  userId: string;
  salaryType: SalaryType | null;
  commissionRate: number | null;
  monthlyBase: number;
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

  const summary =
    salaryType === null
      ? "미설정"
      : salaryType === "fixed"
        ? `급여제 ${monthlyBase.toLocaleString("ko-KR")}원`
        : salaryType === "hybrid"
          ? `혼합 ${monthlyBase.toLocaleString("ko-KR")}원+${commissionRate ?? "?"}%`
          : `비율제 ${commissionRate ?? "?"}%`;

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
      {state?.error ? <span className="text-danger w-full text-[11px]">{state.error}</span> : null}
    </form>
  );
}
