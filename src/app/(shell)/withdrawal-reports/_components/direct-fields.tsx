"use client";
import type { RefObject } from "react";
import { ReasonFields } from "@/features/withdrawals/reason-fields";

const control = "w-full rounded-md border bg-background px-3 py-2 text-sm";

/**
 * 요청 창의 **관리자 바로 처리**(강사 작성 없이) 칸 — 원장 2026-10-23 *"관리자가 어느 학생에 대해 퇴원보고서 카드에서 '강사 작성 없이 바로
 * 퇴원(수강종료)' 가능하게"*. 사유는 다른 곳과 같은 부품(`ReasonFields` — 대분류 · 세부 · '기타'면 메모 필수)이고, 서버가 같은 규칙으로 다시 본다.
 * 창 전체는 폼이 아니라서 사유 칸만 작은 폼으로 감싸 값을 읽는다(`formRef`).
 */
export function DirectFields({ formRef, future, noCourses }: { formRef: RefObject<HTMLFormElement | null>; future: boolean; noCourses: boolean }) {
  return <form ref={formRef} className="space-y-3" onSubmit={e => e.preventDefault()}>
    {noCourses && <p className="text-sm">지금 다니는 반이 없는 원생이라 퇴원으로 처리합니다.</p>}
    <ReasonFields reasonLabel="퇴원·종료 사유" initialReason={null} memoPlaceholder="배경 정보 (선택)" labelClassName="block text-sm" controlClassName={control} idPrefix="direct-withdrawal" />
    <p className="text-xs text-muted-foreground">
      강사 작성과 승인 없이 처리합니다. 처리한 사람·날짜·사유는 퇴원보고서 기록으로 남습니다.
      {future ? " 처리일이 오늘 이후라 그날 처리하고, 그 전까지는 지금 수강 상태를 유지합니다." : ""}
    </p>
  </form>;
}
