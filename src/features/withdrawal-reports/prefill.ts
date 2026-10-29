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

const INVOICE_CATEGORY_LABEL: Record<string, string> = { tuition: "수강료", material: "교재", exam: "시험", other: "기타" };

export function billingPrefill(rows: InvoicePrefillRow[], month: string, checkedOn: string): Partial<ReportBody> {
  const active = rows.filter(r => r.period <= month && !["void", "refunded"].includes(r.status));
  const tuition = active.filter(r => r.period === month && r.category === "tuition");
  const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;
  const billed = tuition.reduce((sum, r) => sum + Math.max(0, r.amountTotal - r.amountDiscount), 0);
  const outstanding = active.reduce((sum, r) => sum + invoiceOutstanding(r), 0);
  // 🔑 어느 청구가 미수인지 — 원장 2026-10-29 *"어떤 건에 대해 미납인지 자세하게… 까지가 아니라 정확하게 언제껀지"*.
  //    같은 달·같은 항목은 합친다(반이 여럿이면 청구가 여러 줄). 오래된 달부터.
  const items = new Map<string, number>();
  for (const r of active) {
    const left = invoiceOutstanding(r);
    if (left <= 0) continue;
    const key = `${r.period} ${INVOICE_CATEGORY_LABEL[r.category] ?? "기타"}`;
    items.set(key, (items.get(key) ?? 0) + left);
  }
  // 칸 상한(1,000자) 안에 들게 12건까지만 적고 나머지는 건수로(리뷰 2026-10-29).
  const listed = [...items].sort(([a], [b]) => a.localeCompare(b));
  const detail = listed.slice(0, 12).map(([key, left]) => `${key} ${won(left)}`).join(", ") + (listed.length > 12 ? ` 외 ${listed.length - 12}건` : "");
  return {
    tuition: tuition.length ? `${month} 학생 전체 수강료 청구 ${won(billed)} · 미수 ${won(tuition.reduce((sum, r) => sum + invoiceOutstanding(r), 0))}` : `${month} 수강료 청구 기록 없음`,
    arrears: active.length ? outstanding > 0 ? "yes" : "no" : "unknown",
    arrearsNote: !active.length ? `${checkedOn} 조회 · ${month}까지 유효한 청구 기록 없음`
      : outstanding > 0 ? `${checkedOn} 조회 · 미수 ${won(outstanding)} — ${detail}`
      : `${checkedOn} 조회 · ${month}까지 학생 전체 청구 미수 없음`,
  };
}

/**
 * 제출한 보고서도 수납은 **지금 장부**로 보인다 — 원장 2026-10-29 *"같은 곳을 가르켜야하는데"*(김소은: 제출 10-26엔 미수 19,000원,
 * 10-29 메이크에듀 동기화로 그 청구가 완납으로 바뀌었는데 결재 화면은 제출 때 값을 보였고 수납 탭은 0원).
 * 제출 때와 달라졌으면 그 값을 한 줄로 덧붙인다(무엇을 보고 결재했는지 남게). 날짜 머리('YYYY-MM-DD 조회 · ')만 다른 것은 같은 값이다.
 */
export function liveBillingForSubmitted(stored: ReportBody, live: Partial<ReportBody>): Partial<ReportBody> {
  // 문구 형식은 바뀔 수 있다(이번 변경 전 저장본은 '…까지 등록된 학생 전체 청구 기준 미수 X원') — **미납 여부·미수 총액·원비 문구**만 비교한다(리뷰).
  const owed = (note: string) => {
    const hit = /미수 ([\d,]+)원/.exec(note);
    return hit ? Number(hit[1].replace(/,/g, "")) : /미수 없음/.test(note) ? 0 : null;
  };
  const tuitionChanged = !!stored.tuition && stored.tuition !== live.tuition;
  const arrearsChanged = stored.arrears !== live.arrears || owed(stored.arrearsNote) !== owed(live.arrearsNote ?? "");
  if (!tuitionChanged && !arrearsChanged) return live;
  const before = [stored.tuition && `원비 ${stored.tuition}`, stored.arrearsNote && `미납 ${stored.arrearsNote}`].filter(Boolean).join(" · ");
  return { ...live, arrearsNote: `${live.arrearsNote ?? ""}\n(제출 때: ${before})` };
}

/** 저장·제출 입력에서 수납 칸을 비운다 — 서버가 장부로 다시 채우니, 화면에 보인 긴 장부 문구가 입력 상한에 걸려 저장을 막지 않게(리뷰). */
export function withoutBillingFields(input: unknown): unknown {
  return input && typeof input === "object" ? { ...(input as Record<string, unknown>), tuition: "", arrears: "unknown", arrearsNote: "" } : input;
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
