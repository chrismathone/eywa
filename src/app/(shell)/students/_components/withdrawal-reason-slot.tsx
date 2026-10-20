"use client";

import { useEffect, useState, type RefObject } from "react";
import { kstToday } from "@/lib/date-kst";
import { formWithdrawalNeedsReason, planFormWithdrawal } from "@/features/students/withdrawal-plan";
import { ReasonFields } from "@/features/withdrawals/reason-fields";

/**
 * 학생 폼(등록·수정)의 퇴원 사유 칸 — 이 저장이 **새로** 퇴원·퇴원 예약을 걸 때만 뜬다(원장 2026-10-15 *"기타는 모든 곳을
 * 일치하게"* — 예전엔 이 폼이 사유 없이 '기타'를 박았다). 칸은 상태 전환 창과 같은 부품(`ReasonFields`).
 *
 * 🔑 판정 = 서버와 **같은 함수**(`planFormWithdrawal` → `formWithdrawalNeedsReason`) — 칸을 띄운 저장만 서버가 사유를 요구한다.
 * 폼은 비제어라 상태·퇴원일 칸의 변경 이벤트를 듣는다. 폼이 되돌려지면(`reset`) 처음 값으로.
 */
export function WithdrawalReasonSlot({
  formRef,
  prevStatus,
  prevWithdrawnAt,
  initialStatus,
  initialWithdrawnAt,
  controlClassName,
}: {
  formRef: RefObject<HTMLFormElement | null>;
  /** 저장돼 있던 상태 — 등록 폼은 null. */
  prevStatus: string | null;
  prevWithdrawnAt: string | null;
  initialStatus: string;
  initialWithdrawnAt: string | null;
  /** 폼의 다른 칸과 같은 입력 모양. */
  controlClassName: string;
}) {
  const [values, setValues] = useState({ status: initialStatus, withdrawnAt: initialWithdrawnAt ?? "" });

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const read = (name: string) => {
      const el = form.elements.namedItem(name);
      return el instanceof HTMLSelectElement || el instanceof HTMLInputElement ? el.value : null;
    };
    const onChange = (e: Event) => {
      const name = (e.target as HTMLInputElement | null)?.name;
      if (name !== "status" && name !== "withdrawnAt") return;
      setValues({ status: read("status") ?? initialStatus, withdrawnAt: read("withdrawnAt") ?? "" });
    };
    const onReset = () => setValues({ status: initialStatus, withdrawnAt: initialWithdrawnAt ?? "" });
    form.addEventListener("input", onChange);
    form.addEventListener("change", onChange);
    form.addEventListener("reset", onReset);
    return () => {
      form.removeEventListener("input", onChange);
      form.removeEventListener("change", onChange);
      form.removeEventListener("reset", onReset);
    };
  }, [formRef, initialStatus, initialWithdrawnAt]);

  const plan = planFormWithdrawal({
    prevStatus,
    prevWithdrawnAt,
    status: values.status,
    withdrawnAt: values.withdrawnAt || null,
    today: kstToday(),
  });
  if (plan.error || !formWithdrawalNeedsReason({ prevStatus, prevWithdrawnAt, kind: plan.kind })) return null;
  return (
    <div className="space-y-3 sm:col-span-2 lg:col-span-3">
      <ReasonFields
        reasonLabel={plan.kind === "schedule" ? "퇴원 사유 (예약)" : "퇴원 사유"}
        initialReason={null}
        memoPlaceholder="배경 정보 (선택)"
        labelClassName="text-foreground block text-sm font-medium"
        controlClassName={controlClassName}
        idPrefix="student-form-withdrawal"
      />
    </div>
  );
}
