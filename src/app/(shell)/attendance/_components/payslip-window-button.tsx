"use client";

import { PrintWindowButton } from "@/components/workspace/print-window";

/**
 * 급여명세서 열기 — 출석부 '강사 전체 보기' 툴바(원장 전용).
 *
 * 이 화면 하단의 '정산액'과 **같은 계산**(0199a 티어 정산)을 쓰는 문서라 진입점을 여기 둔다.
 * 창 id는 `print/payslip/<강사>/<월>` — `print/payslip` prefix로 ROUTE_WINDOW_SIZE의 A4 크기를 받고,
 * 뒤 두 조각이 달라야 강사·월별로 **다른 창**이 열린다(같은 id면 앞서 연 창을 재사용해 버린다).
 *
 * 🔴 과목 칩이 걸려 있으면 **화면 정산액은 그 과목만**, 명세서는 **전 과목**이라 두 숫자가 다르다.
 *    급여는 전 과목이 맞으므로 명세서를 좁히지 않고, 대신 그 사실을 라벨·툴팁으로 밝힌다
 *    (조용히 다르면 원장이 화면 숫자로 검산하다 조정 필드로 "맞추려" 들어 과소지급이 난다 — 적대 리뷰).
 */
export function PayslipWindowButton({
  teacherId,
  period,
  subjectFiltered,
}: {
  teacherId: string;
  period: string;
  /** 과목 칩이 걸려 화면 정산액이 좁혀져 있는가. */
  subjectFiltered?: boolean;
}) {
  return (
    <PrintWindowButton
      id={`print/payslip/${teacherId}/${period}`}
      href={`/payroll/${teacherId}/payslip?period=${period}`}
      title={
        subjectFiltered
          ? "급여명세서는 전 과목 기준입니다 — 과목 칩으로 좁힌 위 정산액보다 큽니다."
          : `급여명세서 ${period}`
      }
      variant="outline"
      className="h-8 rounded-lg px-2.5 text-xs"
    >
      급여명세서{subjectFiltered ? " (전 과목)" : ""}
    </PrintWindowButton>
  );
}
