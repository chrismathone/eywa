"use client";

import { PrintWindowButton } from "@/components/workspace/print-window";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";

/**
 * 반별 월간 출석부 **A4 인쇄**(감사 N1) — 자리 월간 인쇄(`seat/[seat]/month/_components/print-button.tsx`)를 본뜬다.
 * 인쇄는 플로팅 창 + A4(디자인 규약) — 서식은 급여 별지와 같은 `AttendanceAppendix`(읽기 전용).
 * 🔑 화면과 같은 표를 찍도록 **지금 보는 조건**(날짜축·강사 렌즈)을 주소에 실어 보낸다 — 인쇄 페이지가 다시 판정한다.
 */
export function ClassMonthPrintButton({
  classId,
  className,
  month,
  periodMode,
  lens,
  since,
}: {
  classId: string;
  className: string;
  month: string;
  periodMode: "month" | "session";
  /** 강사 계정의 반별 보기 렌즈(그 강사 교시만) — 관리자 반별 보기는 null. */
  lens: string | null;
  since: string | null;
}) {
  const t = useSheetT();
  const tf = useSheetTf();
  const qs = new URLSearchParams({ month, period: periodMode });
  if (lens) qs.set("lens", lens);
  if (since) qs.set("since", since);
  return (
    <PrintWindowButton
      id={`print/class-month/${classId}/${month}`}
      href={`/attendance/class/${classId}/month/print?${qs.toString()}`}
      title={tf("att.print.title", { class: className })}
      variant="outline"
    >
      {t("att.print")}
    </PrintWindowButton>
  );
}
