import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getUserPermMatrix } from "@/lib/auth/perm-matrix";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { kstToday } from "@/lib/date-kst";
import { isModuleEnabled } from "@/lib/modules";
import { canAccess, MENU_KEYS } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { reportError } from "@/lib/observability/report-error";
import { getTenantSettings } from "@/features/owner/server/queries";
import { subjectLabelRecord } from "@/features/owner/subjects";
import { getReviewPrivileges } from "@/features/class-review/server/queries";
import { loadViewerBundle } from "@/features/dashboard/layout/viewer-server";
import { loadPlan, placedOf, resolveView } from "@/features/dashboard/layout/view";
import { EMPTY_DASHBOARD } from "@/features/dashboard/layout/types";
import { monthKeys } from "@/features/dashboard/overview/model";
import { earlyExitNames, loadMonthlyChanges, loadProgramComposition, monthEarlyExits } from "@/features/dashboard/overview/server";
import { loadBillingMonths } from "@/features/dashboard/overview/billing-months-server";
import { getRecentEnrollmentStats } from "@/features/enrollment/server/stats-queries";
import { loadCourseTrendDetail } from "@/features/dashboard/overview/course-trend-server";
import { loadEnrolledTrendDetail } from "@/features/dashboard/overview/enrolled-trend-server";
import { loadRecordCoverage } from "@/features/dashboard/overview/record-coverage";
import { loadTeacherWork } from "@/features/dashboard/overview/teacher-work-server";
import { withStaffTasks } from "@/features/staff-tasks/server/teacher-work";
import { getWithdrawalsInWindow } from "@/features/withdrawals/server/window";
import { withSheetWithdrawals } from "@/features/withdrawals/server/sheet-withdrawals";
import { programSubjectsOf } from "@/features/students/enrollment/program";
import { loadAttendanceBySubject } from "./attendance-server";
import { loadAbsenceLines, loadTaskBoard } from "./check-server";
import { loadConsultExtras } from "./consult-server";
import { NO_EXTRAS, type ExtrasKey, type ExtrasReply, type MonthValues } from "./extras-types";
import { courseLabel, programKeyOf } from "./labels";
import { loadReportExtras } from "./report-server";
import { loadStudentRoster } from "./roster-server";

type Part = <T>(keys: ExtrasKey[], load: () => Promise<T>) => Promise<T | null>;
/** 실패한 칸은 비우고 `failed`에 적는다 — 화면은 그 칸만 이전 값을 그대로 둔다(`mergeExtras`). 카드 숫자는 스냅샷에서 이미 나왔다. */
function parts(): { part: Part; failed: ExtrasKey[] } {
  const failed: ExtrasKey[] = [];
  const part: Part = async (keys, load) => {
    try {
      return await load();
    } catch (error) {
      reportError(error, { scope: `dashboard.instruments.${keys[0]}` });
      failed.push(...keys);
      return null;
    }
  };
  return { part, failed };
}

/** 상세의 '전체'가 보는 달 수(원생 통계와 같다). 과목별 청구는 줄 항목을 읽어 무거우니 1년까지. */
const LONG_MONTHS = 36;
const SUBJECT_BILLING_MONTHS = 12;

const keyed = (points: readonly { key: string; count: number }[]): MonthValues => Object.fromEntries(points.map((p) => [p.key, p.count]));
const hasValue = (values: MonthValues) => Object.values(values).some((v) => v > 0);

/**
 * 과목 탭 값과 강사별 업무. 게이트는 운영실 스냅샷과 같다 — 같은 배치(`resolveView`)·같은 조회 계획(`loadPlan`)이라 카드가 없는 값은 읽지 않는다.
 * 🔴 강사 범위·과목 관리자 화면은 과목 탭을 만들지 않는다(원생 통계처럼 학원 전체 값이 섞인다).
 */
export async function loadInstrumentExtras({ checksOnly = false }: { checksOnly?: boolean } = {}): Promise<ExtrasReply | null> {
  // '다른 강사 뷰'면 대상 직원의 운영실이다 — 배치(묶음·담당 과목)·메뉴 판정이 대상 기준(권한 매트릭스가 대상 값을 쓰는 것과 같은 축).
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return null;
  const matrix = await getUserPermMatrix();
  if (!canAccess(user.systemRole, "dashboard", matrix)) return null;
  const allowed = MENU_KEYS.filter((key) => canAccess(user.systemRole, key, matrix));
  const [settings, viewer, teacherId, privileges] = await Promise.all([
    getTenantSettings(), loadViewerBundle(user), effectiveTeacherId(),
    allowed.includes("class_review") ? getReviewPrivileges().catch(() => null) : Promise.resolve(null),
  ]);
  const labels = subjectLabelRecord(settings.operations.subjects);
  const view = resolveView({
    stored: "degraded" in viewer && viewer.degraded ? EMPTY_DASHBOARD : settings.dashboard,
    bundle: viewer.bundle,
    subjectScoped: viewer.subjectScoped,
    menus: new Set(allowed),
    subjectLabels: viewer.subjects.flatMap((k) => (labels[k] ? [labels[k]] : [])),
  });
  const today = kstToday();
  const subjects = programSubjectsOf(labels);
  const eieOn = isModuleEnabled(settings.modules.disabled, "eie");
  const keyOf = (subject: string | null | undefined, track: string | null | undefined) => programKeyOf(subject, track, subjects, eieOn);
  const seeWork = privileges?.seePortfolio === true && !teacherId;
  // `checksOnly`(스냅샷 갱신 때) = 확인할 일 · 업무 비서에 드는 칸과 3개월 내 퇴원 명단만 — 긴 추이 · 청구 · 구성 · 강사별 업무는 열 때와 [새로 고침]만.
  const full = !checksOnly;
  const { part, failed } = parts();
  const reply = () => ({ failed: [...new Set(failed)] });
  // 서로 기다릴 일이 없다 — 먼저 띄우고 아래 조회와 함께 받는다(B4).
  const teacherWorkP = full && seeWork ? part(["teacherWork"], () => withStaffTasks(loadTeacherWork(user.tenantId, today, null, settings, keyOf))) : Promise.resolve(null);
  const rosterP = allowed.includes("students") ? part(["roster"], () => loadStudentRoster(user.tenantId, today, (s, t) => courseLabel(keyOf(s, t) ?? "", labels, subjects, eieOn))) : Promise.resolve(null);
  const placed = new Set(placedOf(view));
  // 상담의 과목 칸은 키도 라벨도 적혀 있다(자유 입력·이관분) — 키로 맞춰 묻는다.
  const toKey = (s: string | null) => Object.entries(labels).find(([k, l]) => k === s || l === s)?.[0] ?? s;
  const consultP = !view.subjectScoped && allowed.includes("consultations") && placed.has("panel:studentConsult")
    ? part(["consult"], () => loadConsultExtras(teacherId ? null : (s, t) => keyOf(toKey(s), t)))
    : Promise.resolve(null);
  if (teacherId || view.subjectScoped) {
    const [teacherWork, roster, consult] = await Promise.all([teacherWorkP, rosterP, consultP]);
    return full ? { ...NO_EXTRAS, teacherWork, roster, consult, ...reply() } : { roster, consult, ...reply() };
  }
  const months = monthKeys(today);
  const longMonths = monthKeys(today, LONG_MONTHS);

  const needed = loadPlan(view, new Set(allowed));

  // 🔴 등록 후 3개월 내 퇴원은 이제 배치 카드다 — 배치에 놓였을 때만 읽는다(원장이 빼면 읽지 않는다 · 리뷰 2026-11-09).
  //    월별 값은 스냅샷 영역이 이미 싣는 경우(`needed`)엔 다시 읽지 않는다. 지난 달 명단은 카드가 있으면 싣는다
  //    (스냅샷엔 이번 달 명단뿐이라 상세의 '6개월 합계'와 명단의 범위가 갈렸다).
  const earlyPlaced = allowed.includes("withdrawals") && placed.has("panel:earlyExits");
  const wantsEarly = earlyPlaced && !needed.has("earlyExits");
  const wantsEarlyNames = earlyPlaced;
  const longWindow = full && needed.has("changes");
  // 운영실과 같은 퇴원 줄(2026-10까지는 퇴원생 관리 차트 · `withSheetWithdrawals`).
  const withdrawalsFrom = `${(longWindow ? longMonths : months)[0]}-01`;
  const withdrawals = wantsEarlyNames || longWindow ? withSheetWithdrawals(getWithdrawalsInWindow(withdrawalsFrom, today), user.tenantId, today, withdrawalsFrom) : null;
  const billingOn = full && needed.has("billing") && view.amounts && placed.has("panel:billing6");
  void withdrawals?.catch(() => undefined); // 실패는 아래 `part`가 받는다
  const [enrolledDetail, courseDetail, changeRows, billingRows, longBillingRows, eieClasses, earlyExits, earlyNames, composition, teacherWork, roster, consult, report, admissions, attendance, absenceLines, taskBoard] = await Promise.all([
    full && needed.has("enrolledTrend") ? part(["enrolled", "subjects", "changes", "billing"], () => loadEnrolledTrendDetail(user.tenantId, today, subjects, undefined, null, eieOn)) : null,
    full && needed.has("courseTrend") ? part(["courses", "subjects", "changes", "billing"], () => loadCourseTrendDetail(user.tenantId, today, subjects, undefined, eieOn)) : null,
    longWindow ? part(["changes", "longChanges"], () => {
      const coverage = loadRecordCoverage(user.tenantId, today).catch(() => null);
      return loadMonthlyChanges(today, null, withdrawals!, true, LONG_MONTHS, false, coverage, keyOf);
    }) : null,
    // 금액을 가린 역할에겐 과목별 금액도 만들지 않는다(운영실 `shape.ts`와 같은 판정).
    billingOn ? part(["billing"], () => loadBillingMonths(user.tenantId, monthKeys(today, SUBJECT_BILLING_MONTHS), true, keyOf)) : null,
    billingOn ? part(["longBilling"], () => loadBillingMonths(user.tenantId, longMonths, false)) : null,
    full && eieOn ? part(["eieClassIds"], async () => {
      const db = await createClient();
      return fetchAllPaged<{ id: string }>((from, to) => db.from("classes").select("id").eq("english_track", "eie").order("id").range(from, to));
    }) : null,
    wantsEarly ? part(["earlyExits"], () => monthEarlyExits(withdrawals!, today)) : null,
    wantsEarlyNames ? part(["earlyNames"], () => earlyExitNames(withdrawals!, today)) : null,
    full && needed.has("students") ? part(["composition"], () => loadProgramComposition(settings)) : null,
    teacherWorkP,
    rosterP,
    consultP,
    placed.has("panel:reports") && needed.has("homework")
      ? part(["report"], () => loadReportExtras(today, settings, { classnoteOn: isModuleEnabled(settings.modules.disabled, "classnote"), withNames: allowed.includes("students") }))
      : null,
    full && needed.has("admissions") ? part(["longAdmissions"], async () => (await getRecentEnrollmentStats(today, LONG_MONTHS)).months) : null,
    full && (needed.has("attendance") || needed.has("attendanceTrend")) ? part(["attendance"], () => loadAttendanceBySubject(today, keyOf)) : null,
    needed.has("absences") ? part(["absenceLines"], () => loadAbsenceLines(user.tenantId)) : null,
    part(["taskBoard"], loadTaskBoard),
  ]);
  const checks = { roster, consult, report, absenceLines, taskBoard, earlyExits, earlyNames, settingSubjects: settings.operations.subjects };
  if (!full) return { ...checks, ...reply() };

  const enrolled = enrolledDetail ? Object.fromEntries(enrolledDetail.bySubject.map((s) => [s.key, keyed(s.monthly)]).filter(([, v]) => hasValue(v as MonthValues))) as Record<string, MonthValues> : null;
  const courses = courseDetail ? Object.fromEntries(courseDetail.bySubject.map((s) => [s.key, keyed(s.monthly)]).filter(([, v]) => hasValue(v as MonthValues))) as Record<string, MonthValues> : null;
  const keys = [...new Set([...Object.keys(courses ?? {}), ...Object.keys(enrolled ?? {})])];
  const inKey = (key: string) => (subject: string | null | undefined) => subject === key;
  // 🔴 정확히 셀 수 없는 달은 넣지 않는다(원생 통계와 같은 경계) — 학원 전체 = 퇴원 기록이 시작된 달부터, 과목별 = 수강 종료가 기록된 달부터.
  const six = new Set(months);
  const recordsFrom = enrolledDetail?.recordsFrom ?? null;
  const breakdownFrom = enrolledDetail?.breakdownFrom ?? null;
  const inRecords = (month: string) => (enrolledDetail ? !recordsFrom || month >= recordsFrom : six.has(month));
  const inBreakdown = (month: string) => inRecords(month) && (!breakdownFrom || month >= breakdownFrom);
  const longChanges = changeRows ? changeRows(null).filter((r) => inRecords(r.month)) : null;
  const firstChange = longChanges?.findIndex((r) => r.enrolled > 0 || r.withdrawn > 0) ?? -1;
  const longBilling = longBillingRows ? longBillingRows(null).filter((r) => r.totalCount > 0) : null;
  const changes = changeRows
    ? Object.fromEntries(keys.map((key) => {
        const rows = changeRows(inKey(key)).filter((r) => inBreakdown(r.month));
        return [key, { enrolled: Object.fromEntries(rows.map((r) => [r.month, r.enrolled])), withdrawn: Object.fromEntries(rows.map((r) => [r.month, r.withdrawn])) }];
      }))
    : null;
  const billing = billingRows
    ? Object.fromEntries(keys.map((key) => [key, Object.fromEntries(billingRows(inKey(key)).map((r) => [r.period, r.totalBilled - r.totalDiscount]))]))
    : null;
  return {
    subjects: keys.map((key) => ({ key, label: courseLabel(key, labels, subjects, eieOn) })),
    enrolled, courses, changes, billing,
    longChanges: longChanges ? longChanges.slice(Math.max(0, firstChange)) : null,
    longBilling,
    longAdmissions: admissions,
    eieClassIds: (eieClasses ?? []).map((c) => c.id),
    composition,
    teacherWork,
    attendance,
    ...checks,
    ...reply(),
  };
}
