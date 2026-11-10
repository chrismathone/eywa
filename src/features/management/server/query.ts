import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { unstable_rethrow } from "next/navigation";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { logDbError } from "@/lib/supabase/db-error";
import { kstToday } from "@/lib/date-kst";
import { isMergedStudent } from "@/features/students/status/merged";
import { isEnrollmentActiveOn, isEnrollmentOnRosterOn } from "@/features/enrollments/eligibility";
import { getWithdrawalsInWindow } from "@/features/withdrawals/server/window";
import { getTenantSettings } from "@/features/owner/server/queries";
import { managementAccess } from "./access";
import { loadSourceReviews } from "./reviews";
import { buildMetrics } from "../metrics";
import { reportedFinancialView } from "../reported-financials";
import { ManagementInputError } from "../errors";
import { accountingSchema, accountingTotals, periodBounds, revenueBridge, type ManagementSnapshot, type ReportIndexRow, type StoredReport } from "../model";
import { invoiceMetrics, type ClassRow, type Enrollment, type Invoice } from "../invoice-metrics";

export type ManagementData = { snapshot: ManagementSnapshot; reportIndex: ReportIndexRow[] };
type ReportRow = { id: string; version: number; document: unknown; updated_at: string };
const REPORT_COLUMNS = "id,version,document,updated_at";

/**
 * 경영 분석 조회 — 그 달 화면에 필요한 집계만 읽는다(B2·B4·B7).
 * 수강 = 기준일·월초에 걸친 줄만 · 학생 = 테스트·병합 표식만 · 회계 자료 본문 = 그 달에 걸친 기간 + 최근 12개(나머지는 버전 색인만).
 * 퇴원 수·퇴원율은 퇴원관리·운영실과 같은 함수(`getWithdrawalsInWindow` — 장부 정리 제외 · 퇴원월 = 수강료를 낸 마지막 달).
 * 그 조회만 실패하면 퇴원 지표를 '자료 필요'(null)로 두고 나머지 화면은 그린다(0으로 삼키지 않는다).
 */
export async function loadManagement(month: string): Promise<ManagementData> {
  const user = await managementAccess();
  const bounds = periodBounds(month), today = kstToday();
  if (month > today.slice(0, 7)) throw new ManagementInputError("미래 월은 아직 분석할 수 없습니다");
  const asOf = bounds.end < today ? bounds.end : today, observedAt = new Date().toISOString();
  const db = createAdminClient(), tenant = user.tenantId;
  const reports = () => db.from("management_accounting_reports").select(REPORT_COLUMNS).eq("tenant_id", tenant);
  const [excluded, enrollments, classes, invoices, monthReports, overlapReports, recentReports, index, sync, intakes, reviewBatches, withdrawals, settings, staff] = await Promise.all([
    fetchAllPaged<{ id: string; is_test: boolean | null; notes: string | null }>((f, t) => db.from("students").select("id,is_test,notes").eq("tenant_id", tenant).or("is_test.eq.true,notes.ilike.%중복 병합%").order("id").range(f, t)),
    fetchAllPaged<Enrollment>((f, t) => db.from("enrollments").select("id,student_id,class_id,start_date,end_date,on_hold,is_transferred").eq("tenant_id", tenant).lte("start_date", asOf).or(`end_date.is.null,end_date.gte.${bounds.start}`).order("id").range(f, t)),
    fetchAllPaged<ClassRow>((f, t) => db.from("classes").select("id,class_name,subject,teacher_id,is_makeup_pool").eq("tenant_id", tenant).order("id").range(f, t)),
    fetchAllPaged<Invoice>((f, t) => db.from("invoices").select("id,student_id,period,amount_total,amount_paid,amount_discount,status,category,updated_at").eq("tenant_id", tenant).in("period", [month, bounds.previous]).order("id").range(f, t)),
    // 그 달 자료(월 손익 · 월 원장 — 종류마다 한 줄)는 따로 읽는다: 아래 겹침 조회의 상한에 밀려 그 달 손익 계산에서 빠지지 않게.
    reports().eq("period_start", bounds.start).eq("period_end", bounds.end).returns<ReportRow[]>(),
    // 그 달에 걸친 기간(그 달을 품은 연간·누적 보고서 · 부분 월 원장) — 오래된 연간 보고서도 그 해의 달을 고르면 다시 열린다.
    reports().lte("period_start", bounds.end).gte("period_end", bounds.start).order("period_end", { ascending: false }).order("id").limit(60).returns<ReportRow[]>(),
    reports().order("period_end", { ascending: false }).order("id").limit(12).returns<ReportRow[]>(),
    fetchAllPaged<{ period_start: string; period_end: string; source_kind: string; version: number }>((f, t) => db.from("management_accounting_reports").select("period_start,period_end,source_kind,version").eq("tenant_id", tenant).order("period_end", { ascending: false }).order("id").range(f, t)),
    db.from("makeedu_sync_state").select("domain,synced_at").eq("tenant_id", tenant),
    fetchAllPaged<{ id: string; student_id: string | null; consultation_path: string | null }>((f, t) => db.from("enrollment_consultations").select("id,student_id,consultation_path").eq("tenant_id", tenant).gte("received_date", bounds.start).lte("received_date", asOf).order("id").range(f, t)),
    loadSourceReviews(month),
    getWithdrawalsInWindow(bounds.start, asOf).catch((e: unknown) => { unstable_rethrow(e); console.error("[management.load] 퇴원 조회 실패 — 퇴원 지표만 비운다", e); return null; }),
    getTenantSettings(),
    // 강사 이름 — 직원 표는 작다(반 조회 뒤에 따로 읽으면 왕복이 하나 늘어난다, B4). 담당 반이 있는 사람만 아래에서 고른다.
    fetchAllPaged<{ id: string; display_name: string }>((f, t) => db.from("users").select("id,display_name").eq("tenant_id", tenant).order("id").range(f, t)),
  ]);
  const failed = monthReports.error ?? overlapReports.error ?? recentReports.error ?? sync.error;
  if (failed) { logDbError(failed, "management.load"); throw new ManagementInputError("경영 분석 자료를 불러오지 못했습니다"); }

  const skip = new Set(excluded.filter((s) => s.is_test || isMergedStudent(s.notes)).map((s) => s.id));
  const classMap = new Map(classes.filter((c) => !c.is_makeup_pool).map((c) => [c.id, c]));
  const validInvoices = invoices.filter((r) => !skip.has(r.student_id));
  const current = invoiceMetrics(validInvoices.filter((r) => r.period === month)), previous = invoiceMetrics(validInvoices.filter((r) => r.period === bounds.previous));
  const usable = enrollments.filter((e) => !skip.has(e.student_id) && classMap.has(e.class_id) && e.start_date);
  const active = usable.filter((e) => isEnrollmentActiveOn({ startDate: e.start_date!, endDate: e.end_date, onHold: e.on_hold, isTransferred: e.is_transferred }, asOf));
  const subjectsByStudent = new Map<string, Set<string>>();
  for (const e of active) (subjectsByStudent.get(e.student_id) ?? subjectsByStudent.set(e.student_id, new Set()).get(e.student_id)!).add(classMap.get(e.class_id)!.subject);
  const starting = new Set(usable.filter((e) => e.start_date! < bounds.start && isEnrollmentOnRosterOn({ startDate: e.start_date!, endDate: e.end_date, isTransferred: e.is_transferred }, bounds.start)).map((e) => e.student_id));
  // 퇴원 = 퇴원관리·운영실과 같은 함수의 결과 그대로(여기서 다시 거르지 않는다 — 두 화면 숫자가 같아야 한다). null = 조회 실패.
  const exits = withdrawals;

  const byId = new Map<string, StoredReport>();
  for (const r of [...(monthReports.data ?? []), ...(overlapReports.data ?? []), ...(recentReports.data ?? [])]) byId.set(r.id, { id: r.id, version: r.version, updated_at: r.updated_at, document: accountingSchema.parse(r.document) });
  const stored = [...byId.values()].sort((a, b) => b.document.end.localeCompare(a.document.end) || a.id.localeCompare(b.id));
  // 같은 달에 손익계산서와 원장이 함께 있으면 손익계산서가 그 달의 손익 근거다(원장 집계는 늘 검토 대기).
  const inMonth = stored.filter((r) => r.document.start === bounds.start && r.document.end === bounds.end);
  const monthly = inMonth.find((r) => r.document.sourceKind !== "ledger") ?? inMonth[0];
  const accounting = monthly ? accountingTotals(monthly.document) : null;
  const reportedFinancials = reportedFinancialView(reviewBatches, month);

  const teacherIds = new Set([...classMap.values()].flatMap((c) => (c.teacher_id ? [c.teacher_id] : [])));
  const teachers = staff.filter((t) => teacherIds.has(t.id)).map((t) => {
    const mine = active.filter((e) => classMap.get(e.class_id)?.teacher_id === t.id);
    return { id: t.id, label: t.display_name, students: new Set(mine.map((e) => e.student_id)).size, courses: mine.length };
  }).sort((a, b) => b.students - a.students || a.label.localeCompare(b.label, "ko"));
  const channels = new Map<string, { label: string; inquiries: number; registered: number }>();
  for (const i of intakes) {
    const label = i.consultation_path?.trim() || "유입경로 미기재", v = channels.get(label) ?? { label, inquiries: 0, registered: 0 };
    v.inquiries++; if (i.student_id && !skip.has(i.student_id)) v.registered++;
    channels.set(label, v);
  }
  const metrics = buildMetrics({
    month, asOf, current, activeStudents: subjectsByStudent.size, activeCourses: active.length,
    dual: [...subjectsByStudent.values()].filter((s) => s.has("english") && s.has("math")).length,
    subjects: settings.operations.subjects, withdrawals: exits ? exits.length : null, cohort: starting.size, cohortWithdrawals: exits ? exits.filter((w) => starting.has(w.id)).length : null,
    reportedFinancials, accounting,
  });
  const pending = index.filter((r) => r.source_kind === "ledger").length;
  const snapshot: ManagementSnapshot = {
    month, asOf, observedAt, metrics, current, previous, bridge: revenueBridge(previous, current), reports: stored, accounting, reportedFinancials,
    teachers, channels: [...channels.values()], reviewBatches,
    sources: [
      { name: "MakeEdu", state: "이관 자료 조회", updatedAt: (sync.data ?? []).find((s) => s.domain === "invoices")?.synced_at ?? null, note: "연동 PC가 동기화한 청구 원장 기준. 표시 시각은 마지막으로 수집된 시각이며 실시간 동기화가 아님" },
      { name: "ECOUNT", state: index.length ? `${index.length}개 기간 · 그중 원장 집계(검토 대기) ${pending}개` : "손익 파일 필요", updatedAt: stored[0]?.updated_at ?? null, note: "손익 엑셀·원장 CSV의 파일명·기간·해시·계정 금액 보관. 원장 내부 검산과 회계 마감을 구분하며 미확정 자료는 확정 수익률 계산에서 제외" },
      { name: "에이와 수업·상담", state: "현재 DB 조회", updatedAt: observedAt, note: "기존 업무 기록과 원본 ID로 연결" },
    ],
  };
  return { snapshot, reportIndex: index.map((r) => ({ start: r.period_start, end: r.period_end, kind: r.source_kind === "ledger" ? "ledger" : "profit_loss", version: r.version })) };
}
