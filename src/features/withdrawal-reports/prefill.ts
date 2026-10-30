import { effectiveAttendanceRecords, type EffectiveAttendanceRecord } from "@/features/attendance/effective-records";
import { attendanceStatusLabel } from "@/features/attendance/intake/absence-intake";
import { invoiceOutstanding, type InvoiceSummaryInput } from "@/features/billing/calc";
import { KIND_LEGACY_LABEL, type RefundPrefillLine } from "@/features/billing/refund-prefill";
import type { CourseSnapshot, ReportBody } from "./model";

export type AttendancePrefillRow = EffectiveAttendanceRecord & { status: string };
export type InvoicePrefillRow = InvoiceSummaryInput & { period: string; category: string; lines?: RefundPrefillLine[] };

export function attendancePrefill(rows: AttendancePrefillRow[], courses: CourseSnapshot[], from: string, to: string): string {
  const effective = effectiveAttendanceRecords(rows.filter(row => row.session_date >= from && row.session_date <= to && courses.some(c => c.classId === row.class_id && c.startDate <= row.session_date && (!c.endDate || c.endDate >= row.session_date))));
  if (!effective.length) return `${from} ~ ${to} 등록된 출결 기록 없음`;
  const counts = ["present", "late", "absent", "excused", "makeup", "early_leave"].flatMap((key, i) => {
    const count = effective.filter(r => r.status === key).length;
    return i < 3 || count ? [`${attendanceStatusLabel(key)} ${count}회`] : [];
  });
  return `${from} ~ ${to} 전체 ${effective.length}회 / ${counts.join(" / ")}`;
}

export const INVOICE_CATEGORY_LABEL: Record<string, string> = { tuition: "수강료", material: "교재", exam: "시험", other: "기타" };

const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;

/** 수납 청구 줄 한 줄 — 수납 화면의 구분·수납명·청구·할인·납부·미납을 그대로. */
function lineText(l: RefundPrefillLine, unpaidOnly = false): string {
  const head = [KIND_LEGACY_LABEL[l.kind] ?? l.kind, l.description.trim()].filter(Boolean).join(" ");
  if (unpaidOnly) return `${head} 미납 ${won(l.unpaid ?? 0)}`;
  return [`${head} ${won(l.amount)}${l.discount ? `(할인 ${won(l.discount)})` : ""}`, l.paid !== undefined && `납부 ${won(l.paid)}`, l.unpaid ? `미납 ${won(l.unpaid)}` : ""].filter(Boolean).join(" · ");
}

/** 줄 목록을 칸 상한 안에 — 넘치면 남은 줄 수만 적는다. */
function capLines(head: string, lines: string[], max: number): string {
  const out = [head];
  for (let i = 0; i < lines.length; i++) {
    const next = `· ${lines[i]}`;
    if ([...out, next].join("\n").length > max - 20) { out.push(`· 외 ${lines.length - i}건`); break; }
    out.push(next);
  }
  return out.join("\n");
}

/**
 * 원비·미납 — 원장 2026-10-29 *"원비도 세부 내역을 보여줄것. 수납에서 가져올 수 있으니까 그대로"* ·
 * *"미납여부 그냥 미납 없음 한마디로 끝. 있을때만 어떤건인지 수납에서 해당건을 그대로 가져와서"*.
 * - 원비: 퇴원월 수강료 청구 합계 줄 + 청구 줄(구분·수납명·청구·할인·납부·미납).
 * - 미납 없음 → 메모 없이 '미납 없음'만. 있으면 미납 줄을 달·구분·수납명·미납액으로(줄 기록이 없는 청구는 청구 단위).
 * - 첫 줄의 '청구 X원 · 미수 Y원' / '미수 Y원'은 제출 뒤 장부 비교(liveBillingForSubmitted)가 읽는다.
 */
export function billingPrefill(rows: InvoicePrefillRow[], month: string): Partial<ReportBody> {
  const active = rows.filter(r => r.period <= month && !["void", "refunded"].includes(r.status));
  const tuition = active.filter(r => r.period === month && r.category === "tuition");
  const billed = tuition.reduce((sum, r) => sum + Math.max(0, r.amountTotal - r.amountDiscount), 0);
  const outstanding = active.reduce((sum, r) => sum + invoiceOutstanding(r), 0);
  const unpaid: string[] = [];
  for (const r of [...active].sort((a, b) => a.period.localeCompare(b.period))) {
    const left = invoiceOutstanding(r);
    if (left <= 0) continue;
    const label = `${r.period} ${INVOICE_CATEGORY_LABEL[r.category] ?? "기타"}`;
    const lines = (r.lines ?? []).filter(l => (l.unpaid ?? 0) > 0);
    // 줄 미납 합이 청구 미수와 같을 때만 줄로 적는다(아니면 일부만 보이니 청구 단위로).
    if (lines.length && lines.reduce((s, l) => s + (l.unpaid ?? 0), 0) === left) unpaid.push(...lines.map(l => `${r.period} ${lineText(l, true)}`));
    else unpaid.push(`${label} 미납 ${won(left)}`);
  }
  return {
    tuition: tuition.length
      ? capLines(`${month} 수강료 청구 ${won(billed)} · 미수 ${won(tuition.reduce((sum, r) => sum + invoiceOutstanding(r), 0))}`, tuition.flatMap(r => (r.lines ?? []).map(l => lineText(l))), 1000)
      : `${month} 수강료 청구 기록 없음`,
    arrears: active.length ? outstanding > 0 ? "yes" : "no" : "unknown",
    arrearsNote: outstanding > 0 ? capLines(`미수 ${won(outstanding)}`, unpaid, 1000) : "",
  };
}

/**
 * 제출한 보고서도 수납은 **지금 장부**로 보인다 — 원장 2026-10-29 *"같은 곳을 가르켜야하는데"*(김소은: 제출 10-26엔 미수 19,000원,
 * 10-29 메이크에듀 동기화로 그 청구가 완납으로 바뀌었는데 결재 화면은 제출 때 값을 보였고 수납 탭은 0원).
 * 제출 때와 달라졌으면 그 값을 한 줄로 덧붙인다(무엇을 보고 결재했는지 남게). 날짜 머리('YYYY-MM-DD 조회 · ')만 다른 것은 같은 값이다.
 */
export function liveBillingForSubmitted(stored: ReportBody, live: Partial<ReportBody>): Partial<ReportBody> {
  // 문구 형식은 바뀔 수 있다(이번 변경 전 저장본은 '…까지 등록된 학생 전체 청구 기준 미수 X원') — **미납 여부·미수 총액·원비 문구**만 비교한다(리뷰).
  // 2026-10-29 문구가 줄 단위 세부 내역으로 바뀌었다 — 원비는 첫 줄의 청구·미수 금액, 미납은 미납 여부·총액으로만 비교.
  const owed = (note: string, arrears: ReportBody["arrears"] | undefined) => {
    if (arrears === "no") return 0;
    const hit = /미수 ([\d,]+)원/.exec(note);
    return hit ? Number(hit[1].replace(/,/g, "")) : /미수 없음/.test(note) ? 0 : null;
  };
  const amounts = (tuition: string) => (tuition.split("\n")[0].match(/[\d,]+원/g) ?? []).join("/") || tuition;
  const tuitionChanged = !!stored.tuition && amounts(stored.tuition) !== amounts(live.tuition ?? "");
  const arrearsChanged = stored.arrears !== live.arrears || owed(stored.arrearsNote, stored.arrears) !== owed(live.arrearsNote ?? "", live.arrears);
  if (!tuitionChanged && !arrearsChanged) return live;
  const before = [stored.tuition && `원비 ${stored.tuition.split("\n")[0]}`, stored.arrearsNote && `미납 ${stored.arrearsNote.split("\n")[0]}`, !stored.arrearsNote && stored.arrears === "no" && "미납 없음"].filter(Boolean).join(" · ");
  return { ...live, arrearsNote: [live.arrearsNote, `(제출 때: ${before})`].filter(Boolean).join("\n") };
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
