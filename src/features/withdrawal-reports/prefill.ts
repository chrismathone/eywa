import { effectiveAttendanceRecords, type EffectiveAttendanceRecord } from "@/features/attendance/effective-records";
import { attendanceStatusLabel } from "@/features/attendance/intake/absence-intake";
import { invoiceOutstanding, type InvoiceSummaryInput } from "@/features/billing/calc";
import type { CourseSnapshot, ReportBody } from "./model";

export type AttendancePrefillRow = EffectiveAttendanceRecord & { status: string };
export type InvoicePrefillRow = InvoiceSummaryInput & { period: string; category: string };

export function attendancePrefill(rows: AttendancePrefillRow[], courses: CourseSnapshot[], from: string, to: string): string {
  const effective = effectiveAttendanceRecords(rows.filter(row => row.session_date >= from && row.session_date <= to && courses.some(c => c.classId === row.class_id && c.startDate <= row.session_date && (!c.endDate || c.endDate >= row.session_date))));
  if (!effective.length) return "등록된 출결 기록 없음";
  const counts = ["present", "late", "absent", "excused", "makeup", "early_leave"].flatMap((key, i) => {
    const count = effective.filter(r => r.status === key).length;
    return i < 3 || count ? [`${attendanceStatusLabel(key)} ${count}회`] : [];
  });
  return `전체 ${effective.length}회 / ${counts.join(" / ")}`;
}

export function billingPrefill(rows: InvoicePrefillRow[], month: string, checkedOn: string): Partial<ReportBody> {
  const active = rows.filter(r => r.period <= month && !["void", "refunded"].includes(r.status));
  const tuition = active.filter(r => r.period === month && r.category === "tuition");
  const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;
  const billed = tuition.reduce((sum, r) => sum + Math.max(0, r.amountTotal - r.amountDiscount), 0);
  const outstanding = active.reduce((sum, r) => sum + invoiceOutstanding(r), 0);
  return {
    tuition: tuition.length ? `${month} 학생 전체 수강료 청구 ${won(billed)} · 미수 ${won(tuition.reduce((sum, r) => sum + invoiceOutstanding(r), 0))}` : `${month} 수강료 청구 기록 없음`,
    arrears: active.length ? outstanding > 0 ? "yes" : "no" : "unknown",
    arrearsNote: active.length ? `${checkedOn} 조회 · ${month}까지 등록된 학생 전체 청구 기준 미수 ${won(outstanding)}` : `${checkedOn} 조회 · ${month}까지 유효한 청구 기록 없음`,
  };
}

/** 수납은 장부 조회 결과를 사용하고, 작성한 상담·사유는 보존한다. */
export function fillEmptyReportFields(body: ReportBody, prefill: Partial<ReportBody>): ReportBody {
  return { ...body,
    attendance: body.attendance || prefill.attendance || "",
    tuition: prefill.tuition ?? body.tuition,
    arrears: prefill.arrears ?? body.arrears,
    arrearsNote: prefill.arrearsNote ?? body.arrearsNote,
  };
}
