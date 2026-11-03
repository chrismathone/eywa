import "server-only";
import { isModuleEnabled } from "@/lib/modules";
import { requireAccess } from "@/lib/auth/require-access";
import { getUserPermMatrix } from "@/lib/auth/perm-matrix";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { getTeacherScope, type TeacherScope } from "@/lib/auth/teacher-scope";
import { canAccess, MENU_KEYS, type MenuKey } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { kstTimeOf, kstToday } from "@/lib/date-kst";
import { previousDayRange } from "./previous-day";
import {
  countEnrolledStudents,
  fetchActiveEnrolledEnrollments,
  fetchEndingEnrolledEnrollments,
  fetchEnrolledStudents,
} from "@/features/students/server/enrolled-programs";
import { summarizeCourses } from "@/features/students/enrollment/course-count";
import { loadStudentHistory } from "@/features/students/stats/server/history";
import { withCourseHistory } from "./course-history";
import {
  composeEnrolled,
  notYetStartedStudentIds,
  enrolledSubjectCounts,
  gradeSplit,
  schoolLevelLabel,
  summarizePrograms,
} from "@/features/students/enrollment/enrolled-composition";
import { getWithdrawalsInWindow, type WindowWithdrawal } from "@/features/withdrawals/server/window";
import { getSubjectEndedStudents } from "@/features/withdrawals/server/queries";
import { monthWithdrawalRows } from "./monthly-exits";
import { tenureDays } from "@/features/withdrawals/early-exit";
import { loadTeacherWork } from "./teacher-work-server";
import { withStaffTasks } from "@/features/staff-tasks/server/teacher-work";
import { selectSubjectView } from "../layout/subject-view";
import { AREA_MENUS, RETIRED_AREAS } from "@/features/dashboard/layout/registry";
import {
  inWithdrawalWindow,
  exitReportMonth,
  withdrawalMonthWindow,
} from "@/features/withdrawals/window";
import { isMergedStudent } from "@/features/students/status/merged";
import { bookkeepingOnlyIds } from "@/features/withdrawals/server/bookkeeping";
import { getIntakeOnDay } from "@/features/enrollment/server/intake-day";
import { getFirstClassStudents } from "@/features/dashboard/server/day-arrivals-query";
import { getEnrolledRecent } from "@/features/dashboard/server/enrolled-today";
import { loadEnrolledTrend, loadEnrolledTrendSlicer, type EnrolledTrend } from "./enrolled-trend-server";
import { getScopedRecentAbsences } from "@/features/dashboard/server/recent-absences";
import { recentAbsenceRange } from "./kpi-links";
import { loadUpcomingMakeup } from "@/features/dashboard/server/makeup-upcoming";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { getRecentAnnouncements } from "@/features/dashboard/server/queries";
import { getDailyProcessingStatus } from "@/features/attendance/server/queries";
// 휴원일 판정(학원설정 휴일 목록만 — 처리 현황과 같은 함수)과 그날 실제 입력(분모 없는 사실만).
import { holidayNameOrNull } from "@/features/attendance/server/holiday";
import { getHolidayDayActivity } from "@/features/attendance/server/holiday-activity";
import { holidayActivityCounts } from "@/features/attendance/holiday-activity";
import {
  effectiveAttendanceRecords,
  type EffectiveAttendanceRecord,
} from "@/features/attendance/effective-records";
import { attendanceOverview, attendanceWindowStart } from "./attendance-day";
import { loadBillingMonths } from "./billing-months-server";
import type { SubjectBillingSummary } from "./billing-subject";
import { getRecentConsultationRows, getRecentEnrollmentStats } from "@/features/enrollment/server/stats-queries";
import { summarizeRecentEnrollment } from "@/features/enrollment/recent-stats";
import { getStudentConsultationCounts } from "@/features/consultations/server/queries";
import { getNewcomers } from "@/features/newcomers/server/queries";
import { shiftDate } from "@/features/newcomers/onboarding-items";
import {
  getUnreadReports,
  loadHomeworkRisk,
} from "@/features/dashboard/onescreen/server/queries";
import { getTodaySchedule } from "@/features/timetable/server/queries";
import { mergeContinuousClasses } from "./continuous-classes";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isChinsanTenant } from "@/features/owner/preset";
import { subjectLabelRecord } from "@/features/owner/subjects";
import { getApprovalBoxes } from "@/features/approvals/server/queries";
import { getInventoryCounts } from "@/features/inventory/server/queries";
import { getDateRangeEvents } from "@/features/calendar/server/queries";
import { getSheetLanding } from "@/features/class-sheets/server/queries";
import { getMathSheetLanding } from "@/features/math-sheets/server/landing";
import { OVERVIEW_BUDGET_MS, remainingMs, settleWithin } from "./deadline";
import {
  getExpensesForMonth,
  summarizeExpenses,
} from "@/features/billing/server/expense-queries";
import {
  getAbsenceRiskStudents,
  getAbsenceRiskAnchor,
  getAbsenceBreakdown,
} from "@/features/dashboard/server/queries";
import { unexplainedAbsences } from "@/features/dashboard/absence-reasons";
import { schoolsByLevel, levelSubjectSplit } from "./student-composition";
import { buildCareSummary } from "./newcomer-care";
import {
  matchFirstClass,
  matchFirstClassSchedule,
} from "./admissions-class-link";
import {
  admissionsConsultationCandidates,
  firstClassCandidates,
  firstClassScheduleCandidates,
  homonymFamilies,
} from "./admissions-links-server";
import {
  CONSULTATION_LINK_WINDOW_DAYS,
  canonicalEventTitle,
  consultationBasesInTitles,
  matchAdmissionsConsultation,
} from "./admissions-consultation-link";
import { reportError } from "@/lib/observability/report-error";
import { loadViewerBundle } from "@/features/dashboard/layout/viewer-server";
import { loadPlan, resolveView, type ResolvedView } from "@/features/dashboard/layout/view";
import { shapeSections } from "@/features/dashboard/layout/shape";
import { inSliceAny, sliceGroupOf, sliceGroupsOf, sliceKey, slicePredicate, subjectsNamedIn, type SlicePredicate, type SliceTable } from "@/features/dashboard/layout/slices";
import { EMPTY_DASHBOARD } from "@/features/dashboard/layout/types";
import { ENGLISH_PROGRAM_KEYS, isEnglishProgramKey, programOf, programSubjectsOf, subjectGroupOf } from "@/features/students/enrollment/program";
import {
  admissionsEventBaseKind,
  admissionsEventKind,
  staffDisplayRole,
  upcomingAdmissionsEvents,
} from "./display";
import { isCancelledEventTitle } from "@/features/calendar/cancelled";
import { monthAheadWindow } from "./upcoming-window";
import { consultProgressData, consultProgressList } from "./consultation-progress-server";
import { staffComposition } from "./staff-subjects";
import { loadRecordCoverage, type RecordCoverage } from "./record-coverage";
import {
  distribution,
  monthlyChanges,
  monthKeys,
  type Area,
  type MonthChange,
  type CareSummary,
  type OperationCount,
  type OverviewData,
  type OverviewSnapshot,
  type Section,
  type Sections,
} from "./model";

type Settings = Awaited<ReturnType<typeof getTenantSettings>>;

/** 재원생 명단 + 활성 수강 — '재원생'·'강좌수' 칸이 **같은 조회 한 벌**을 나눠 쓴다(`loadOverview`가 한 번만 부른다). */
type EnrolledRows = [Awaited<ReturnType<typeof fetchEnrolledStudents>>, Awaited<ReturnType<typeof fetchActiveEnrolledEnrollments>>];
async function loadEnrolledRows(): Promise<EnrolledRows> {
  const db = await createClient();
  return Promise.all([fetchEnrolledStudents(db), fetchActiveEnrolledEnrollments(db)]);
}

/**
 * 상단 '강좌수'(원장 2026-10-20 *"대시보드에 강좌수도 볼 수 있으면 좋을듯 … 한 학생이 여러 강좌를 들을 수도 있기 때문에 듣는 모든 강좌를
 * 체크"*) — '재원생' 칸과 같은 조회(`enrolledRows`)·같은 줄 판정(`activeRows` — 이미 시작 · 휴원 아님 · 스코프)에 **종료일이 오늘 이후로
 * 적힌 수강**(특강 기간 · 반이동 예약 전의 원래 반)을 더해 재원생의 오늘 수강을 학생·과목마다 한 번 센다(`summarizeCourses`). 과목 관리자는 그 과목 반만(`pred`).
 */
async function courses(
  scope: TeacherScope | null,
  settingsPromise: Promise<Settings>,
  enrolledRows: Promise<EnrolledRows>,
): Promise<(pred: SlicePredicate | null) => OverviewData["courses"]> {
  const today = kstToday();
  const db = await createClient();
  const [[, open], ending, settings] = await Promise.all([enrolledRows, fetchEndingEnrolledEnrollments(db, today), settingsPromise]);
  const rows = [...open, ...ending];
  const subjects = settings.operations.subjects;
  // 영어 = 인재원 영어 · EiE 따로(원장 2026-10-30) — EiE 모듈이 켜진 지점만(꺼진 지점은 영어 반이 전부 한 갈래).
  const splitEnglish = isModuleEnabled(settings.modules.disabled, "eie");
  return (pred) => summarizeCourses({ rows, scope, subjects, today, splitEnglish, ...(pred ? { inSubject: pred } : {}) });
}

/** '강좌수 추이' 카드가 따로 읽으므로 '재원생 추이' 영역엔 강좌수를 싣지 않는다(스냅샷을 가볍게). */
function withoutCourses(t: EnrolledTrend): EnrolledTrend {
  return { monthly: t.monthly, yearly: t.yearly, recordsFrom: t.recordsFrom, trustFrom: t.trustFrom, monthlyFrom: t.monthlyFrom };
}

/**
 * 재원생 — KPI '재원생' 카드·팝업, 동시 수강, 학년별 재원생, 구성 패널.
 * 🔑 카드 숫자는 원생목록과 **같은 count(head)**(`countEnrolledStudents`), 과목별·프로그램·학년 분해는 원생목록과
 *    **같은 순수 집계**(`enrolledSubjectCounts`·`composeEnrolled` — 원생목록 `program=` 필터도 composeEnrolled를 지난다).
 * 🔑 B1: 운영실 갱신(서버 액션)은 React cache가 조회를 묶지 않는다 — 활성 수강·재원생 명단·재원 수를 **여기서 한 번씩**
 *    받아 두 집계에 넘기고, 강사 스코프·학원설정은 loadOverview가 한 번 푼 것을 받는다(다시 부르면 호출마다 users를 읽는다).
 */
async function students(
  scope: TeacherScope | null,
  settingsPromise: Promise<Settings>,
  enrolledRows: Promise<EnrolledRows>,
): Promise<(pred: SlicePredicate | null) => OverviewData["students"]> {
  const db = await createClient();
  const today = kstToday();
  const [[studentRows, rows], settings] = await Promise.all([enrolledRows, settingsPromise]);
  // '실시간 재원생'(원장 2026-09-16) — 아직 한 과목도 시작 안 한 학생은 총원·과목·학년 분해에서 함께 빠진다.
  // 🔴 `countEnrolledStudents`가 이 행들을 다시 받지 않게 **같은 rows에서** 집합을 만든다(운영실 30초 갱신은
  //    서버 액션이라 React cache가 조회를 묶지 않는다 — 여기서 한 번 받은 것을 넘긴다는 이 함수의 규약 그대로).
  const notStarted = notYetStartedStudentIds(rows, today);
  const enrolled = await countEnrolledStudents(db, scope, notStarted);
  const subjects = settings.operations.subjects;
  // `total` = 카드 숫자 — 학원 전체는 원생목록과 같은 count(head), 과목 관리자는 명단 길이(null).
  // `comboRows` = 과목 수강 조합을 셀 줄(과목 관리자는 담당 학생의 **전체** 수강 — 영어 관리자에게도 '영어·수학'이 선다).
  const build = (list: typeof studentRows, countRows: typeof rows, total: number | null, comboRows: typeof rows = countRows) => {
    const composition = composeEnrolled({ students: list, rows, scope, subjects, today });
    const counts = enrolledSubjectCounts(countRows, scope, today);
    const visible = composition.students;
    const programs = summarizePrograms(
      visible.map((r) => r.id),
      composition.programs,
      composition.active,
    );
    return {
      enrolled: total ?? visible.length,
      subjects: Object.entries(counts.bySubject)
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value),
      levels: distribution(visible.map((r) => schoolLevelLabel(r.grade))),
      schools: distribution(visible.map((r) => r.school)),
      schoolGroups: schoolsByLevel(visible, composition.programs, composition.active),
      // 동시 수강 = 영어 + 수학(원장 2026-09-11 재정의) — gradeSplit 보라 합계와 같은 subjectMixOf 판정.
      concurrent: programs.both,
      subjectCombinations: comboRows === countRows ? counts.combinations : enrolledSubjectCounts(comboRows, scope, today).combinations,
      // 강사 화면은 담당 과목 축으로 좁혀 '반이 없는 학생'이 다른 과목 수강생과 섞인다 — 각주를 싣지 않는다.
      ...(scope ? {} : { subjectStudents: counts.students }),
      programs,
      gradeSplit: gradeSplit(visible, composition.programs, settings.operations.gradeLevels),
      levelSplit: levelSubjectSplit(visible, composition.programs),
    };
  };
  return (pred) => {
    if (!pred) return build(studentRows, rows, enrolled);
    // 과목 관리자(원장 2026-10-14 2단계) — 그 과목 반에서 **이미 수업을 시작한** 학생 + 아직 반이 없는 학생(모름 = 모두에게).
    // 두 과목 학생은 양쪽 관리자 모두에게 든다. 동시 수강·학년별 막대의 영어/수학 구분은 그 학생의 **전체 수강**으로 판정한다.
    const subjectOfRow = (r: (typeof rows)[number]) => (Array.isArray(r.class) ? r.class[0] : r.class)?.subject ?? null;
    const started = (r: (typeof rows)[number]) => !r.start_date || r.start_date.slice(0, 10) <= today;
    const sliceRows = rows.filter((r) => pred(subjectOfRow(r)));
    const hasRow = new Set(rows.map((r) => r.student_id));
    const members = new Set(sliceRows.filter(started).map((r) => r.student_id));
    const list = studentRows.filter((s) => members.has(s.id) || !hasRow.has(s.id));
    const value = build(list, sliceRows.filter((r) => members.has(r.student_id)), null, rows.filter((r) => members.has(r.student_id)));
    // 담당 묶음이 아닌 프로그램 칸은 비운다(영어 관리자 화면에 '수학 N'이 서지 않게 — 동시 수강 칸은 남는다).
    const englishIn = subjects.some((s) => { const p = programOf({ subject: s.key }, subjects); return (p === "eie" || p === "injaewon") && pred(s.key); });
    const mathIn = subjects.some((s) => programOf({ subject: s.key }, subjects) === "math" && pred(s.key));
    const p = value.programs;
    return {
      ...value,
      programs: { ...p, eie: englishIn ? p.eie : 0, injaewon: englishIn ? p.injaewon : 0, math: mathIn ? p.math : 0, both: englishIn || mathIn ? p.both : 0 },
      concurrent: englishIn || mathIn ? value.concurrent : 0,
    };
  };
}

/**
 * KPI '퇴원&수업종료' — 보여 줄 달(`exitReportMonth` — 1~10일은 지난달, 11일부터 이번 달 · 원장 2026-11-03) 1일 ~ min(말일, 오늘)(KST)로
 * **센**(수업료를 낸 마지막 달 기준) 줄 + 같은 창에 퇴원·종료했지만 앞 달로 센 줄
 * (`carried`, 원장 2026-11-03 — 숫자엔 들지 않고 팝업이 밝힌다). 조립은 `monthWithdrawalRows`(순수 함수 — 시험이 잠근다).
 * 퇴원관리의 과목 전체 종료 기준을 더하고 종료된 과목마다 한 번 센다. 반이동·특강 종료는 제외한다.
 */
async function monthWithdrawals(
  rowsPromise: Promise<WindowWithdrawal[]>,
  today: string,
  settingsPromise: Promise<Settings>,
): Promise<OverviewData["withdrawals"]> {
  const month = exitReportMonth(today);
  const win = withdrawalMonthWindow(month, today);
  const [rows, settings, ended] = await Promise.all([rowsPromise, settingsPromise, getSubjectEndedStudents({ countFrom: win.from })]);
  return { month, ...monthWithdrawalRows(rows, ended, win, settings.operations.subjects, (school, grade) => schoolGradeLabel(school, grade) || null) };
}

/**
 * '등록 후 3개월 내 퇴원'(원장 2026-10-15) — KPI '퇴원&수업종료'의 퇴원 행과 **같은 행**, 창은 **달력 이번 달**(1일 ~ 오늘 — KPI는 1~10일에 지난달을 보여
 * 주지만 이 카드는 '이번 달 퇴원'이라 적힌 그대로 달력 기준, 원장 2026-11-03)의 퇴원 전부에 등록 후 일수를 붙인다.
 * 30·60·90일 판정은 카드가 `early-exit.ts`로 한다(퇴원관리 '등록 후' 필터와 같은 함수). 수강종료는 싣지 않는다(퇴원만 판정).
 * 지난 달들(등록·퇴원 추이와 같은 6개월 조회)은 이름 없이 달·일수·과목만 싣는다 — 카드가 달마다 센다.
 */
async function monthEarlyExits(
  rowsPromise: Promise<WindowWithdrawal[]>,
  today: string,
): Promise<OverviewData["earlyExits"]> {
  const month = today.slice(0, 7);
  const months = monthKeys(today);
  const win = withdrawalMonthWindow(month, today);
  const rows = await rowsPromise;
  // 과목을 못 모으면 마지막 반 과목 — 둘 다 없으면 빈 목록(모든 과목 관리자에게, narrow.ts).
  const subjectsOf = (row: WindowWithdrawal) =>
    row.exitClasses.length ? row.exitClasses.map((c) => c.subject) : row.lastClassSubject ? [row.lastClassSubject] : [];
  const inMonth = (row: WindowWithdrawal) =>
    inWithdrawalWindow({ withdrawnAt: row.exitDate, systemBulk: false }, win.from, win.to);
  return {
    month,
    months,
    rows: rows.filter(inMonth).map((row) => ({
      id: row.id,
      name: row.name,
      schoolGrade: schoolGradeLabel(row.school, row.grade) || null,
      enrolledAt: row.enrolledAt,
      withdrawnAt: row.withdrawnAt,
      days: tenureDays(row.enrolledAt, row.withdrawnAt),
      subjects: subjectsOf(row),
    })),
    // 달마다 줄은 '등록·퇴원 추이'의 퇴원 막대와 같은 모집단 — 사유 없는 단체 장부 정리는 뺀다(원장 2026-10-20 · 3개월 내 퇴원 ⊆ 그 달 퇴원).
    history: rows
      .filter((row) => !row.cleanup && row.exitDate < win.from && months.includes(row.exitDate.slice(0, 7)))
      .map((row) => ({
        month: row.exitDate.slice(0, 7),
        days: tenureDays(row.enrolledAt, row.withdrawnAt),
        subjects: subjectsOf(row),
      })),
  };
}

/** KPI '오늘첫수업' — 원생목록 `first=`와 같은 함수 + 같은 강사 스코프(원생목록은 스코프 화이트리스트를 건다). */
async function firstClasses(
  today: string,
  scope: TeacherScope | null,
  settingsPromise: Promise<Settings>,
): Promise<OverviewData["firstClass"]> {
  const settings = await settingsPromise;
  const list = await getFirstClassStudents(today, settings.operations.subjects);
  const ids = scope ? new Set(scope.studentIds) : null;
  return ids ? list.filter((s) => ids.has(s.studentId)) : list;
}

/**
 * 등록·퇴원 추이(최근 6개월).
 * 퇴원 칸은 실제 퇴원만 센다(getWithdrawalsInWindow: status=withdrawn · 시스템 정리 제외).
 * 과목 종료 후 재원 중인 학생은 인원 감소가 아니므로 추이에 더하지 않는다. 등록 칸은 강사 스코프를 건다.
 */
export async function loadMonthlyChanges(
  today: string,
  scope: TeacherScope | null,
  withdrawalRows: Promise<WindowWithdrawal[]>,
  /** 과목별 값을 만들 때만(과목 관리자·미리보기 원본) 등록 학생의 수강 과목을 함께 읽는다. */
  withSubjects: boolean,
  /** 몇 달 — 운영실 카드 6 · 원생 통계 화면은 더 길게. `withdrawalRows`도 같은 창으로 받아 와야 한다. */
  months = 6,
  /**
   * 과목을 모르는 등록·퇴원(반 배정 전 등록 · 끝난 수강이 없는 옛 퇴원)을 과목별 값에 넣나 — 운영실 과목 관리자 카드는 넣는다
   * (모름은 모두에게, 원장 2026-10-14). 원생 통계(과거 흐름)는 **빼고** 센다 — 옛 퇴원생 대부분이 수강 행이 없어 모든 과목 퇴원으로
   * 들어가면 과목 흐름이 학원 전체 퇴원과 같아진다(리뷰 2026-10-20: 2025년 퇴원 226건 전부가 '모름').
   */
  unknownToAll = true,
  /**
   * 기록 범위(`loadRecordCoverage`) — 있으면 등록 칸에 **수업을 시작한 등록만** 센다(원장 2026-10-20 *"신규원생이 그냥 등록상담만 했는데
   * 등록했을 수도 있음"*): 판정 창(청구가 덮은 달) 안에 등록한 학생은 등록 뒤 수업료 청구·출석·시작한 반 수강 중 하나가 있어야 든다
   * (`startedRegistration` — '지난 기록'과 한 벌). 그 전 등록은 가를 수 없어 그대로 센다 · 재료가 없으면(실패) 종전대로 · 퇴원 칸은 그대로.
   */
  coverage: Promise<RecordCoverage | null> = Promise.resolve(null),
): Promise<(pred: SlicePredicate | null) => MonthChange[]> {
  const db = await createClient();
  const fromDate = `${monthKeys(today, months)[0]}-01`;
  const ids = scope ? new Set(scope.studentIds) : null;
  // 🔴 이 조회는 **status를 보지 않는다**(퇴원했다 복구된 학생의 그 달 등록을 살리려고) — 그래서 중복 병합된
  //    학생도 그대로 등록으로 세고 있었다(원장 2026-09-13). 퇴원 칸은 `withdrawalRows`가 이미 걸러 온다.
  // 수업 기록 없는 장부 정리(단체 정리)도 등록으로 세지 않는다 — 퇴원 칸이 이미 빼므로 한쪽만 남으면 증감이 기운다(원장 2026-10-15).
  // 장부 정리 확인은 등록 행만 있으면 되므로 퇴원·기록 범위를 기다리지 않고 바로 이어 띄운다(B4 · 2026-10-21 실측 — 퇴원 체인 뒤에
  // 줄 서 있던 40~90ms를 겹친다).
  const countedP = fetchAllPaged<{ id: string; enrolled_at: string; notes: string | null; withdrawal_metadata: unknown }>((from, to) =>
    db
      .from("students")
      .select("id,enrolled_at,notes,withdrawal_metadata")
      .gte("enrolled_at", fromDate)
      .order("id")
      .range(from, to),
  ).then((enrolled) => enrolled.filter((r) => (!ids || ids.has(r.id)) && !isMergedStudent(r.notes)));
  const [counted, bookkeeping, withdrawn, range] = await Promise.all([
    countedP,
    countedP.then((rows) => bookkeepingOnlyIds(db, rows)),
    withdrawalRows,
    coverage,
  ]);
  const started = range?.billingFrom ? new Set(range.started) : null;
  const isStarted = (id: string, enrolledAt: string | null) => !started || !enrolledAt || enrolledAt.slice(0, 7) < range!.billingFrom! || started.has(id);
  const joined = counted.filter((r) => !bookkeeping.has(r.id) && isStarted(r.id, r.enrolled_at));
  // 과목 관리자(원장 2026-10-14 2단계) — 등록은 그 학생이 들은(듣는) 반의 과목, 퇴원은 퇴원 무렵 끝난 과목(없으면 마지막 반).
  // 수강 기록이 없는 등록 학생(반 배정 전)은 '모름'이라 모든 과목 관리자에게 든다 · 두 과목이면 양쪽 모두.
  const subjectsOf = new Map<string, string[]>();
  if (withSubjects && joined.length) {
    const rows = await fetchAllPagedInChunks<{ student_id: string; class: { subject: string | null } | { subject: string | null }[] | null }>(
      joined.map((r) => r.id),
      (chunk, from, to) =>
        db.from("enrollments").select("student_id, class:class_id ( subject )").in("student_id", chunk).order("id").range(from, to),
    );
    for (const r of rows) {
      const subject = (Array.isArray(r.class) ? r.class[0] : r.class)?.subject;
      if (subject) subjectsOf.set(r.student_id, [...(subjectsOf.get(r.student_id) ?? []), subject]);
    }
  }
  const exitSubjects = (r: WindowWithdrawal) =>
    r.exitClasses.length ? r.exitClasses.map((c) => c.subject) : r.lastClassSubject ? [r.lastClassSubject] : [];
  const inSlice = (pred: SlicePredicate, subjects: readonly (string | null | undefined)[]) =>
    unknownToAll ? inSliceAny(pred, subjects) : subjects.some((subject) => !!subject?.trim() && pred(subject));
  // 사유 없는 단체 장부 정리는 퇴원 칸에 넣지 않는다 — 퇴원일이 장부 날짜라 그 달 퇴원이 몰려 보인다(원장 2026-10-20 *"퇴원 이유를 보고
  // 넣어야할건에 대해서만 넣을것"*). 그 학생은 재원생 추이에서 청구가 살아 있는 달까지만 센다(`billedOn`). '수업을 시작한 등록만'은 등록 칸에만
  // 건다(원장 결정 범위 — 퇴원 칸까지 걸면 퇴원관리 '월별 추이'와 숫자가 갈린다, 적대 리뷰 2026-10-20).
  const exits = withdrawn.filter((r) => !r.cleanup);
  const startedFrom = started ? range!.billingFrom! : null;
  return (pred) =>
    monthlyChanges(
      today,
      joined.filter((r) => !pred || inSlice(pred, subjectsOf.get(r.id) ?? [])).map((r) => r.enrolled_at),
      // 퇴원 막대의 달 = 퇴원월(수강료를 낸 마지막 달 — `exitDate`, 원장 2026-10-29).
      exits.filter((r) => !pred || inSlice(pred, exitSubjects(r))).map((r) => r.exitDate),
      months,
    ).map((r) => (startedFrom && r.month >= startedFrom ? { ...r, startedOnly: true } : r));
}

async function attendanceHistory(today: string, withSubjects: boolean) {
  const db = await createClient();
  const rows = await fetchAllPaged<
    EffectiveAttendanceRecord & { status: string }
  >((from, to) =>
    db
      .from("attendance_records")
      .select(
        "id,student_id,class_id,session_date,slot_start,status,recorded_at",
      )
      .gte("session_date", attendanceWindowStart(today))
      .lte("session_date", today)
      .order("id")
      .range(from, to),
  );
  // Attendance cells keep separate lesson periods; corrections replace only the same cell.
  // '출결 현황' 도넛은 오늘 칸만, 출석률 추이는 14일 — 판정은 attendance-day.ts 한 곳(원장 2026-09-13).
  // ⚠️ 도넛은 **찍힌 기록 전건**(명단·반 필터 없음 — 자리 칸·테스트 학생 기록 포함)이라 같은 카드의
  //    '예정학생 미처리·입력 중 N반'(`getDailyProcessingStatus` = 예정 명단 기준, 테스트 학생 제외 — 2026-09-14)과
  //    기준이 다르다. 기록은 사실이라 여기선 거르지 않는다(원장 요청 범위 = 오늘 출결·처리현황).
  const cells = effectiveAttendanceRecords(rows);
  // 과목 관리자(원장 2026-10-14 2단계) — 출결 칸의 반 과목으로 가른다. 반 과목은 과목 값이 필요할 때만 읽는다(B3 청크).
  const subjectOf = new Map<string, string | null>();
  if (withSubjects) {
    const ids = [...new Set(cells.map((c) => c.class_id).filter(Boolean))];
    const classes = await fetchInChunks<{ id: string; subject: string | null }>(ids, (chunk) => db.from("classes").select("id,subject").in("id", chunk));
    for (const c of classes) subjectOf.set(c.id, c.subject);
  }
  // '출결 현황'·'출석률 추이' 두 영역이 같은 집계를 쓴다 — 묶음(`groups`)마다 한 번만 계산한다(학원 전체 = 빈 키).
  const memo = new Map<string, ReturnType<typeof attendanceOverview>>();
  return (pred: SlicePredicate | null, groups?: readonly string[]) => {
    const key = pred ? (groups ? sliceKey(groups) : null) : "";
    const hit = key === null ? undefined : memo.get(key);
    if (hit) return hit;
    const value = attendanceOverview(pred ? cells.filter((c) => pred(subjectOf.get(c.class_id) ?? null)) : cells, today);
    if (key !== null) memo.set(key, value);
    return value;
  };
}

/** 최근 6개월(원장 2026-09-13 "청구 6개월로 바꾸자. 다시 돌려" — 12개월로 넓혔더니 청구서가 2026-01부터라 앞 석 달이 빈 칸이었다). 계산은 수납 통계와 한 벌(`billing-months-server.ts`). */
function billing(today: string, tenantId: string, withSubjects: boolean): Promise<(pred: SlicePredicate | null) => SubjectBillingSummary[]> {
  return loadBillingMonths(tenantId, monthKeys(today), withSubjects);
}


async function newcomers(settingsPromise: Promise<Settings>): Promise<(pred: SlicePredicate | null) => CareSummary> {
  const [view, settings] = await Promise.all([getNewcomers(), settingsPromise]);
  // The source page remains usable when the check table is unavailable. Do not manufacture overdue counts.
  const available = view.checksAvailable && !view.checksError;
  // 집계는 매일 기록(`ops-daily.ts`)과 한 벌(`buildCareSummary`) — 운영실 카드 숫자 = 그날 기록.
  const build = (rows: typeof view.rows, careRows: typeof view.rows): CareSummary =>
    buildCareSummary(rows, careRows, settings.operations.subjects, available, view.today);
  return (pred) => {
    if (!pred) return build(view.rows, view.rows);
    // 과목 관리자(원장 2026-10-14 2단계) — 그 과목 줄이 있거나 아직 과목이 없는(반 배정 전) 신규생. 체크 판정은 그 과목 줄로만
    // 하고(다른 과목 콜이 늦어도 이 관리자의 '지연'이 아니다), 단계별 막대의 영어·수학·동시 색은 학생 전체 과목 그대로 둔다.
    const parts = (r: (typeof view.rows)[number]) => r.subjects ?? [r];
    const mine = view.rows.filter((r) => parts(r).every((p) => !p.subject) || parts(r).some((p) => !!p.subject && pred(p.subject)));
    const careRows = mine.map((r) => {
      const own = (r.subjects ?? []).filter((p) => !p.subject || pred(p.subject));
      return own.length ? { ...r, subjects: own } : r;
    });
    return build(mine, careRows);
  };
}

/**
 * 직원 구성 — 역할별 인원에 **과목 묶음**(영어·수학·둘 다·그 외·없음)을 함께 센다(원장 2026-09-12 *"수학강사 영어강사 색깔
 * 구분 · 과목 없는 강사는 진한 회색 · 관리자도 마찬가지"*). 판정·라벨은 순수 함수(staff-subjects.ts)이고 과목 묶음은
 * 학년별 재원생 막대와 같은 `subjectGroupOf`라 학원설정 과목을 읽는다(하드코딩 금지).
 */
async function staff(settingsPromise: Promise<Settings>): Promise<(pred: SlicePredicate | null) => OverviewData["staff"]> {
  const db = await createClient();
  const [rows, settings] = await Promise.all([
    fetchAllPaged<{ id: string; system_role: string; subjects: string[] | null }>(
      (from, to) =>
        db
          .from("users")
          .select("id,system_role,subjects")
          .eq("status", "active")
          .neq("system_role", "student")
          .order("id")
          .range(from, to),
    ),
    settingsPromise,
  ]);
  const people = rows.map((r) => ({ role: staffDisplayRole(r, isChinsanTenant(settings)), subjects: r.subjects }));
  // 과목 관리자(원장 2026-10-14 2단계) — 그 과목을 맡은 직원 + 담당 과목이 없는 공용 직원(데스크 등 — '모름'은 모두에게).
  return (pred) =>
    staffComposition(pred ? people.filter((p) => inSliceAny(pred, p.subjects ?? [])) : people, settings.operations.subjects);
}

async function operations(
  allowed: MenuKey[],
  userId: string,
): Promise<OperationCount[]> {
  const db = await createClient();
  const jobs: Promise<OperationCount[]>[] = [];
  const count = (
    menu: MenuKey,
    label: string,
    table: string,
    href: string,
    documents = false,
  ) => {
    if (!allowed.includes(menu)) return;
    jobs.push(
      (async () => {
        let q = db.from(table).select("id", { count: "exact", head: true });
        if (documents) q = q.is("staff_user_id", null);
        const result = await q;
        return [
          {
            label,
            href,
            count: result.error ? null : (result.count ?? 0),
            unit: "건",
          },
        ];
      })(),
    );
  };
  count("meetings", "회의록", "meeting_minutes", "/meetings");
  count("documents", "공용 문서", "academy_documents", "/documents", true);
  // '등록 시험'은 뺐다(2026-09-23 전수 점검 D2) — 시험 등록을 폐지해(0283a, 결정 로그 '성적관리') exams 표에
  // 쓰는 코드가 없어 늘 0건이었다. 이번 학기 성적 기입 건수로 바꾸는 안은 강사 범위(담임·부담임 반만)와
  // 숫자가 갈리고 student_grades는 실시간 구독 대상도 아니라 거짓 숫자가 되기 쉬워 두지 않는다.
  if (allowed.includes("shuttle"))
    jobs.push(
      (async () => {
        const result = await db
          .from("shuttle_vehicles")
          .select("id", { count: "exact", head: true })
          .eq("archived", false);
        return [
          {
            label: "운행 차량",
            href: "/shuttle",
            count: result.error ? null : (result.count ?? 0),
            unit: "대",
          },
        ];
      })(),
    );
  if (allowed.includes("approvals"))
    jobs.push(
      (async () => {
        try {
          const b = await getApprovalBoxes(userId);
          return [
            {
              label: "내 결재 대기",
              href: "/approvals",
              count: b.ready && !b.loadError ? b.waiting.length : null,
              unit: "건",
            },
          ];
        } catch {
          return [
            {
              label: "내 결재 대기",
              href: "/approvals",
              count: null,
              unit: "건",
            },
          ];
        }
      })(),
    );
  if (allowed.includes("inventory"))
    jobs.push(
      (async () => {
        const counts = await getInventoryCounts();
        return [
          {
            label: "등록 자산",
            href: "/inventory",
            count: counts.assets,
            unit: "개",
          },
          {
            label: "소모품 품목",
            href: "/inventory?tab=supplies",
            count: counts.supplies,
            unit: "종",
          },
        ];
      })(),
    );
  return (await Promise.all(jobs)).flat();
}

/**
 * 운영실 스냅샷을 만드는 옵션. `full` = **학원 설정 '대시보드 관리' 미리보기 원본 전용** — 역할 배치를 안 걸고 원장 시점의 모든 영역을 읽는다.
 * 🔴 호출부(`owner/page.tsx`)가 원장·총괄 게이트를 지난 뒤에만 넘긴다. 서버 액션 `refreshOverview`는 인자를 받지 않아 이 옵션을 못 넘긴다.
 */
export type LoadOverviewOptions = { full?: boolean; subject?: string };

/** Authoritative, permission-gated snapshot. No cross-user server cache, no fallback zeros. */
export async function loadOverview(options: LoadOverviewOptions = {}): Promise<OverviewSnapshot> {
  const requestedAt = Date.now();
  const user = await requireAccess("dashboard");
  // 역할 판정(총괄 여부·관리자의 담당 과목)은 권한 매트릭스와 독립 — 먼저 띄워 둔다(B4, 30초 갱신마다 왕복이 붙지 않게).
  const viewerPromise = options.full ? Promise.resolve({ bundle: "owner" as const, subjects: [] as string[], subjectScoped: false }) : loadViewerBundle(user);
  void viewerPromise.catch(() => undefined);
  const matrix = await getUserPermMatrix();
  const allowed = MENU_KEYS.filter((key) =>
    canAccess(user.systemRole, key, matrix),
  );
  const today = kstToday();
  // 🔴 '최근 결석'은 **어제까지 7일**(원장 2026-10-20) — 오늘은 수업 전이면 결석을 알 수 없다. 갱신(서버 액션)마다
  //    다시 계산되므로 자정이 지나면 창도 함께 넘어간다.
  const absentRange = recentAbsenceRange(today);
  const settingsPromise = getTenantSettings();
  // 🔑 B1 — 강사 스코프를 **한 번만** 푼다. 서버 액션 갱신에선 React cache가 안 묶어서 영역마다 부르면
  //    getCurrentUser가 그만큼 users를 다시 읽는다. 영역엔 푼 값을 넘긴다.
  const teacherIdPromise = effectiveTeacherId();
  const scopePromise = teacherIdPromise.then((id) => (id ? getTeacherScope(id) : null));
  // 🔴 역할별 배치(학원 설정 '대시보드 관리') — **어느 영역을 읽을지**를 보는 사람의 배치가 정한다. 배치에 없는 카드의 영역은
  //    조회 자체를 하지 않는다(데이터가 만들어지지 않으면 샌 데이터도 없다). 메뉴 권한은 여전히 상한이다(`add`의 menus).
  //    설정(테넌트 캐시)과 역할 판정(총괄 여부·관리자의 담당 과목)은 서로 독립이라 함께 기다린다(B4).
  const [settingsNow, viewer] = await Promise.all([settingsPromise, viewerPromise]);
  const subjectLabels = subjectLabelRecord(settingsNow.operations.subjects);
  const subjectView = viewer.bundle === "subject" ? selectSubjectView(subjectLabels, viewer.subjects, options.subject) : null;
  const viewingSubjects = subjectView ? subjectView.subjects : viewer.subjects;
  const view: ResolvedView = resolveView({
    // 원장 시점 원본(full)·역할 판정 실패(degraded)는 저장값을 안 쓴다 — 실패면 코드 기본(민감 칸 없음·옵션 가림)으로.
    stored: options.full || ("degraded" in viewer && viewer.degraded) ? EMPTY_DASHBOARD : settingsNow.dashboard,
    bundle: viewer.bundle,
    subjectScoped: viewer.subjectScoped,
    menus: new Set(allowed),
    subject: subjectView?.active?.key,
    subjectLabels: viewingSubjects.flatMap((k) => (subjectLabels[k] ? [subjectLabels[k]] : [])),
  });
  if (subjectView) {
    view.activeSubject = subjectView.active?.key;
    view.subjectChoices = subjectView.choices;
  }
  const programSubjects = programSubjectsOf(subjectLabels);
  const groupOf = (key: string | null | undefined) => subjectGroupOf(key, programSubjects);
  // 과목 값 판정의 과목 목록 = **학원 설정의 과목만**(재리뷰 2026-10-14) — `subjectLabelRecord`의 옛 표시용 라벨(예술·사회·기타)을
  // 섞으면 자유 입력 '기타'가 설정에 있는 과목이 되어 아무 과목 관리자에게도 안 보이고, 미리보기 묶음도 쓸데없이 는다.
  const sliceSubjects = settingsNow.operations.subjects.map((s) => ({ key: s.key, label: s.label }));
  // 강좌수 추이도 영어를 인재원 영어 · EiE 두 강좌로(강좌수 칸과 같은 판정 — 원장 2026-10-30).
  const splitEnglishNow = isModuleEnabled(settingsNow.modules.disabled, "eie");
  const groups = [...new Set(viewingSubjects.map(groupOf).filter((g): g is string => g !== null))];
  // 과목별 값(원장 2026-10-14 2단계, `slices.ts`)을 만들 묶음 — 과목 관리자는 담당 묶음 하나(여럿이면 합집합 한 벌),
  // 미리보기 원본(full)은 묶음마다 한 벌(편집기가 과목을 골라 본다). 그 밖의 역할은 만들지 않는다(계산 0).
  const sliceSets: string[][] = options.full
    ? [...new Set(sliceSubjects.map((s) => groupOf(s.key)).filter((g): g is string => g !== null))].map((g) => [g])
    : view.subjectScoped && groups.length ? [groups] : [];
  const slices: SliceTable = {};
  // 과목별 값의 묶음 판정 — 설정에 없는 과목·빈 과목은 '모름'(모든 과목 관리자에게 든다, 원장 2026-10-14).
  // 콜&상담 과목 칸은 자유 입력이라 한 칸에서 묶음을 여럿 읽는다('EiE' → 영어 · '영어 수학' → 둘 다, `sliceGroupsOf`).
  const sliceGroups = sliceGroupsOf(sliceSubjects, groupOf);
  const sliceGroup = sliceGroupOf(sliceSubjects, groupOf);
  // 조회 계획 = 놓인 카드가 읽는 영역 ∩ 메뉴 권한(`loadPlan`, 순수 — 테스트가 역할별로 잠근다).
  const needed = loadPlan(view, new Set(allowed));
  if (options.full) for (const area of Object.keys(AREA_MENUS) as Area[]) {
    // 대시보드에서 뺀 카드의 영역은 미리보기도 읽지 않는다(강사별 업무 현황 → 직원 평가 '업무 현황' · 무거운 조회 — 리뷰 2026-10-30).
    if (RETIRED_AREAS.has(area)) continue;
    if (AREA_MENUS[area].every((menu) => allowed.includes(menu))) needed.add(area);
  }
  const needs = (...areas: Area[]) => areas.some((a) => needed.has(a));
  // 실제 퇴원 행은 KPI·추이·등록 후 3개월 내 퇴원이 공유한다. 과목 종료는 KPI에서만 추가한다.
  const withdrawalRows =
    (allowed.includes("withdrawals") || allowed.includes("students")) && needs("withdrawals", "changes", "earlyExits")
      // KPI가 보여 줄 달에 퇴원했지만 앞 달로 센 학생은 6개월보다 앞 달로 셌어도 싣는다(KPI 팝업 '앞 달로 센' — 원장 2026-11-03). 세 소비처는 `exitDate`로 다시 거른다.
      ? getWithdrawalsInWindow(`${monthKeys(today)[0]}-01`, today, { keepProcessedFrom: `${exitReportMonth(today)}-01` })
      : Promise.resolve([] as WindowWithdrawal[]);
  // 최근 60일 콜&상담 — 일정 카드(일정↔상담 연결)와 '상담 진행' 카드가 **같은 한 번의 조회**를 쓴다(두 카드가 같은 상담 집합을
  // 보고, 30초 갱신마다 같은 표를 두 번 읽지 않게). 실패 처리는 영역마다 다르다: 일정 카드는 링크만 빼고 살고, 상담 진행은 실패를 알린다.
  const consultationSince = shiftDate(today, -CONSULTATION_LINK_WINDOW_DAYS);
  const consultationRows = allowed.includes("enrollment") && needs("calendar", "consultProgress")
    ? admissionsConsultationCandidates(consultationSince)
    : null;
  // 공유 약속이 영역보다 먼저 거절돼도 '처리 안 된 거절'로 새지 않게 — 각 영역은 자기 try/catch에서 다시 받는다.
  for (const shared of [teacherIdPromise, scopePromise, withdrawalRows, consultationRows]) void shared?.catch(() => undefined);
  const history = allowed.includes("attendance") && needs("attendance", "attendanceTrend")
    ? attendanceHistory(today, sliceSets.length > 0)
    : null;
  // 🔴 **예산은 여기서부터** 잰다 — `requestedAt`(함수 진입)으로 재면 인증·권한 조회가 느린 날 남은 예산이
  //    0이 되어 **카드 25개가 통째로** 빈다(적대 리뷰 2026-09-16). `requestedAt`은 스냅샷 순서를 가리는 값이라
  //    그대로 둔다(`mergeSnapshot`).
  const budgetFrom = Date.now();
  const sections: Sections = {};
  const jobs: Promise<void>[] = [];
  // 마감에 걸렸을 때 "무엇이 안 끝났나"를 알아야 그 칸만 비운다(끝난 칸은 건드리지 않는다).
  const pending = new Set<Area>();
  function add<K extends Area>(
    area: K,
    menus: MenuKey[],
    load: () => Promise<OverviewData[K]>,
  ) {
    if (!needed.has(area)) return; // 배치에 없는 카드의 영역 — 조회하지 않는다
    if (!menus.every((key) => allowed.includes(key))) return;
    pending.add(area);
    jobs.push(
      (async () => {
        let result: Section<OverviewData[K]>;
        try {
          result = { data: await load(), at: Date.now(), error: false };
        } catch (error) {
          console.error(`[dashboard/overview/${area}]`, error);
          result = { data: null, at: null, error: true };
        }
        Object.assign(sections, { [area]: result });
        pending.delete(area);
      })(),
    );
  }
  /**
   * 과목으로 다시 집계하는 영역 — 조회는 **한 번**(`load`), 받은 행으로 학원 전체 값(`compute(null)`)과 묶음마다 과목별 값
   * (`compute(판정)`)을 같은 함수로 만든다. 과목 관리자 화면은 `shapeSections`가 과목별 값으로 갈아 끼운다.
   */
  function addSliced<K extends Area>(
    area: K,
    menus: MenuKey[],
    /** `groups` = 그 값의 묶음(건수만 세는 영역은 묶음마다 미리 센 값을 고른다 — 행이 없어 판정 함수로 못 거른다). */
    load: () => Promise<(pred: SlicePredicate | null, groups?: readonly string[]) => OverviewData[K]>,
  ) {
    add(area, menus, async () => {
      const compute = await load();
      if (sliceSets.length) {
        Object.assign(slices, { [area]: Object.fromEntries(sliceSets.map((gs) => [sliceKey(gs), compute(slicePredicate(gs, sliceGroups), gs)])) });
      }
      return compute(null);
    });
  }
  // '재원생'·'강좌수' 칸은 같은 재원생 명단·활성 수강을 본다 — 둘 중 하나라도 놓였을 때 **한 번만** 읽는다(30초 갱신도 한 번).
  let enrolledRowsOnce: Promise<EnrolledRows> | null = null;
  const enrolledRows = () => (enrolledRowsOnce ??= loadEnrolledRows());
  addSliced("students", ["students"], async () => students(await scopePromise, settingsPromise, enrolledRows()));
  addSliced("courses", ["students"], async () => courses(await scopePromise, settingsPromise, enrolledRows()));
  addSliced("changes", ["students"], async () =>
    loadMonthlyChanges(today, await scopePromise, withdrawalRows, sliceSets.length > 0, 6, true, loadRecordCoverage(user.tenantId, today).catch((error: unknown) => {
      reportError(error, { scope: "dashboard.changes.record-coverage" }); // 실패하면 종전대로(등록일 그대로) 센다
      return null;
    })),
  );
  // 과목 관리자 = 그 과목 반 수강이 그날 걸려 있던 재원생(원장 2026-10-14 *"재원생 추이도 마찬가지"*). 원본은 과목 값이 필요할 때만 받는다.
  // '재원생 추이'·'강좌수 추이' 카드는 **같은 계산값 캐시**(`loadEnrolledTrend` — 강좌수도 함께 센다)를 읽는다 — 한 번만 부른다.
  let trendOnce: Promise<EnrolledTrend> | null = null;
  let slicerOnce: ReturnType<typeof loadEnrolledTrendSlicer> | null = null;
  const trends = () =>
    Promise.all([
      (trendOnce ??= loadEnrolledTrend(user.tenantId, today, sliceSubjects, splitEnglishNow)),
      sliceSets.length ? (slicerOnce ??= loadEnrolledTrendSlicer(user.tenantId, today, sliceSubjects, splitEnglishNow)) : Promise.resolve(null),
    ]);
  addSliced("enrolledTrend", ["students"], async () => {
    if (await scopePromise) return () => null;
    const [academy, slicer] = await trends();
    return (pred) => withoutCourses(pred && slicer ? slicer(pred) : academy);
  });
  // '강좌수 추이'(원장 2026-10-20 '카드 따로') — 재원생 추이와 같은 원본·날짜·시작 달 · 과목 관리자는 그 과목 반만.
  addSliced("courseTrend", ["students"], async () => {
    if (await scopePromise) return () => null;
    // 앞쪽 달(에이와 기록 전)은 지난 기록으로 메운다(원장 2026-10-30 '이전 기록의 과학·국어 반영' — course-history.ts).
    // 지난 기록의 과목 수는 수납 청구에서 나온 값이라 수납 메뉴를 보는 사람에게만(원생 통계와 같은 규칙) · 학원 전체 카드만.
    const historyMonths = allowed.includes("billing")
      ? loadStudentHistory(user.tenantId).then((h) => h.months).catch((error: unknown) => {
          reportError(error, { scope: "dashboard.course-trend.history" });
          return null;
        })
      : Promise.resolve(null);
    const [[academy, slicer], months] = await Promise.all([trends(), historyMonths]);
    // 영어를 펼치는 것은 courseGroupOf가 가르는 지점만(설정에 injaewon·eie 과목 키가 있으면 가르지 않는다 — 리뷰 2026-10-30: EiE 두 번 셈).
    const ownProgramKeys = sliceSubjects.some((s) => isEnglishProgramKey(s.key));
    const courseGroups = [...new Set(sliceSubjects.map((s) => subjectGroupOf(s.key, sliceSubjects)).filter((g): g is string => g !== null))]
      .flatMap((g) => (g === "english" && splitEnglishNow && !ownProgramKeys ? [...ENGLISH_PROGRAM_KEYS] : [g]));
    const academyCourses = academy.courses && months ? withCourseHistory(academy.courses, months, courseGroups, today) : (academy.courses ?? null);
    return (pred) => (pred && slicer ? (slicer(pred).courses ?? null) : academyCourses);
  });
  // ── KPI 여섯 칸(원장 2026-09-11) — 카드·팝업·목적지 화면이 같은 함수를 부른다.
  add("withdrawals", ["withdrawals"], () => monthWithdrawals(withdrawalRows, today, settingsPromise));
  // 과목 관리자는 행의 과목으로 좁힌다(narrow.ts — KPI '퇴원&수업종료'와 같은 결).
  add("earlyExits", ["withdrawals"], () => monthEarlyExits(withdrawalRows, today));
  // 과목 관리자 = 상담 과목이 담당 과목이거나 과목을 안 고른 상담(원장 2026-10-14 — 모르는 것은 모두에게).
  addSliced("intake", ["enrollment"], async () => {
    const rows = await getIntakeOnDay(today);
    return (pred) => rows.filter((row) => !pred || pred(row.subject)).map((row) => ({
      id: row.id,
      name: row.name,
      time: kstTimeOf(row.createdAt),
    }));
  });
  // '전일 / 이달 신규'(옛 '금일 등록', 원장 2026-10-21) — 어제·이번 달 콜&상담 '등록 완료'로 옮긴 상담. 카드·팝업이 같은 배열.
  // 🔑 영역 키 `enrolledToday`는 그대로다 — 학원 설정에 저장된 배치가 `kpi:enrolledToday`를 가리킨다.
  addSliced("enrolledToday", ["enrollment"], async () => {
    const rows = await getEnrolledRecent(today);
    return (pred) => (pred ? rows.filter((row) => pred(row.subject)) : rows);
  });
  add("firstClass", ["students"], async () => firstClasses(today, await scopePromise, settingsPromise));
  // '보강예정'(원장 2026-09-14) — **오늘부터 한 달**(원장 2026-09-16) 보강 예약 + 지난 미이행. 창은 `monthAheadWindow` 한 함수
  // (아래 '레벨테스트 및 첫수업 일정'과 같은 끝 날짜) · 반 집합·기간 조회는 시간표 '보강' 탭과 같은 두 함수.
  // 과목 관리자 = 보강 반의 과목으로(창 뒤 예약 수도 그 과목 반만 더한다).
  addSliced("makeup", ["attendance"], async () => {
    const { overview, subjectOf, laterByClass } = await loadUpcomingMakeup(today, await teacherIdPromise, sliceSets.length > 0);
    return (pred) => {
      if (!pred) return overview;
      const mine = (classId: string) => pred(subjectOf.get(classId));
      const later = [...laterByClass].reduce((sum, [classId, n]) => sum + (mine(classId) ? n : 0), 0);
      return { ...overview, rows: overview.rows.filter((row) => mine(row.classId)), later };
    };
  });
  // 최근 결석 — 학생별 누적 결석 + 결석마다 그 수업 담당(teacher-axis) · 겸직 강사뷰면 그 강사가 가르치는 반만.
  // 센 창을 `from/to`로 함께 실어 보낸다 — 카드·팝업이 그 값을 읽어 같은 기간을 말한다.
  add("absent", ["attendance"], async () => getScopedRecentAbsences(absentRange, await teacherIdPromise));
  // 과목 관리자 = 그 과목 반의 출결 칸 · 그 과목 반의 처리 현황(원장 2026-10-14 2단계).
  addSliced("attendance", ["attendance"], async () => {
    const overview = (await history)!;
    return (pred, gs) => overview(pred, gs).snapshot;
  });
  addSliced("processing", ["attendance"], async () => {
    const rows = await getDailyProcessingStatus(today);
    return (pred) => (pred ? rows.filter((row) => pred(row.subject)) : rows);
  });
  // 휴원일(학원설정 휴일 목록)이면 위 처리 현황은 빈 목록이다 — 그날 **실제로 입력된 것**만 따로 센다(분모·완료율 없음).
  // 오늘 출결 휴원일 화면·출석부 요약과 같은 조회라 세 화면이 같은 "입력 N명 · M반"을 말한다(강사뷰면 그 강사 반만).
  // 평일은 null(조회 없음). 입력 현황 조회가 실패하면 휴일 이름은 살리고 숫자만 비운다(0명으로 접지 않는다).
  addSliced("holidayAttendance", ["attendance"], async () => {
    const name = await holidayNameOrNull(today);
    if (!name) return () => null;
    const activity = await getHolidayDayActivity(today).catch((error: unknown) => {
      reportError(error, { scope: "dashboard.holiday-attendance", date: today });
      return null;
    });
    // 과목 관리자 = 그 과목 반에 입력된 것만(학생 수는 겹침 없이 다시 센다).
    return (pred) => {
      if (!activity) return { name, counts: null };
      if (!pred) return { name, counts: holidayActivityCounts(activity) };
      const rows = activity.rows.filter((r) => pred(r.subject));
      return {
        name,
        counts: {
          students: new Set(rows.flatMap((r) => r.students.map((st) => st.studentId))).size,
          classes: rows.filter((r) => r.students.length > 0).length,
          reservations: rows.reduce((sum, r) => sum + r.reservations.length, 0),
        },
      };
    };
  });
  addSliced("attendanceTrend", ["attendance"], async () => {
    const overview = (await history)!;
    return (pred, gs) => overview(pred, gs).trend;
  });
  addSliced("billing", ["billing"], () => billing(today, user.tenantId, sliceSets.length > 0));
  add("expenses", ["billing"], async () =>
    summarizeExpenses(
      await getExpensesForMonth(today.slice(0, 7)),
      today.slice(0, 7),
    ),
  );
  addSliced("absences", ["attendance"], async () => {
    const db = { supabase: await createClient(), tenantId: user.tenantId };
    const [rows, anchor] = await Promise.all([
      getAbsenceRiskStudents(),
      getAbsenceRiskAnchor(db),
    ]);
    if (!anchor) return () => ({ anchor: null, rows: [] });
    const breakdown = await getAbsenceBreakdown(
      db,
      rows.map((r) => r.studentId),
      anchor,
    );
    const all = rows
      .map((r) => ({
        ...r,
        unexplained: unexplainedAbsences(
          r.absences,
          breakdown.reasons.get(r.studentId),
        ),
      }))
      .filter((r) => r.unexplained >= 3);
    // 과목 관리자(원장 2026-10-14 2단계) — 그 과목 반의 결석이 하나라도 있는 학생(반 과목을 모르는 결석은 모두에게).
    // ⚠️ 숫자(결석·사유 없는 결석)는 학생 전체 그대로다 — 반복 결석은 과목을 가리지 않고 챙길 신호라 줄이지 않는다.
    return (pred) => ({
      anchor,
      rows: pred ? all.filter((r) => (breakdown.subjects.get(r.studentId) ?? []).some((e) => e.count > 0 && pred(e.subject || null))) : all,
    });
  });
  // 과목 관리자 = 상담 과목이 담당 과목이거나 과목을 안 고른 상담. 학원 전체 값은 종전 DB 함수 그대로(행은 과목 값이 필요할 때만 받는다).
  addSliced("admissions", ["enrollment"], async () => {
    const [stats, rows] = await Promise.all([
      getRecentEnrollmentStats(today),
      sliceSets.length ? getRecentConsultationRows(today) : Promise.resolve([]),
    ]);
    return (pred) => (pred ? summarizeRecentEnrollment(rows.filter((r) => pred(r.subject)), today) : stats);
  });
  // 과목 관리자 = 다른 과목(키·라벨)의 상담만 빼고 센다 — 과목이 비었거나 설정에 없는 과목은 '모름'이라 남는다.
  // 건수 조회(head count)라 행이 없다 → 묶음마다 같은 조회를 과목 조건만 더해 한 벌씩 센다(B2 — 행을 받아 세지 않는다).
  addSliced("consultations", ["consultations"], async () => {
    const otherSubjects = (gs: readonly string[]) =>
      sliceSubjects.filter((s) => { const g = sliceGroup(s.key); return g !== null && !gs.includes(g); }).flatMap((s) => [s.key, s.label]);
    const [academy, ...perSlice] = await Promise.all([
      getStudentConsultationCounts(),
      ...sliceSets.map((gs) => getStudentConsultationCounts({ excludeSubjects: otherSubjects(gs) })),
    ]);
    const bySlice = new Map(sliceSets.map((gs, i) => [sliceKey(gs), perSlice[i]!]));
    return (pred, gs) => (pred && gs ? bySlice.get(sliceKey(gs))! : academy);
  });
  addSliced("newcomers", ["newcomers"], () => newcomers(settingsPromise));
  // 담당 과목 키 — 설정에 있는 과목 중 그 묶음의 것(보고서는 과목 키로 저장된다).
  const sliceSubjectKeys = (gs: readonly string[]) => sliceSubjects.filter((s) => { const g = sliceGroup(s.key); return g !== null && gs.includes(g); }).map((s) => s.key);
  addSliced("homework", ["lesson_reports"], async () => {
    const view = await loadHomeworkRisk();
    return (pred, gs) => view(pred && gs ? sliceSubjectKeys(gs) : null);
  });
  add("teacherWork", ["lesson_reports"], async () => withStaffTasks(loadTeacherWork(user.tenantId, today, await scopePromise, settingsNow)));
  // 학부모 미열람 = ClassNote 읽음 기록이 소스 — ClassNote 기능이 꺼진 학원엔 이 카드가 없다(2026-09-30 "꺼지면 흔적 없이").
  // 🔑 영역 등록을 설정 대기로 막지 않는다(뒤 영역들이 늦게 출발하지 않게) — 조회 안에서 판정하고,
  //    꺼졌으면 조회 없이 빈 값을 돌린 뒤 아래 반환 직전에 영역째 뺀다.
  addSliced("unread", ["lesson_reports"], async () => {
    if (!isModuleEnabled((await settingsPromise).modules.disabled, "classnote")) return () => null as unknown as OverviewData["unread"];
    // 건수 조회라 묶음마다 한 번 더 센다(행을 받지 않는다 — B2).
    const [academy, ...perSlice] = await Promise.all([getUnreadReports(), ...sliceSets.map((gs) => getUnreadReports(sliceSubjectKeys(gs)))]);
    const bySlice = new Map(sliceSets.map((gs, i) => [sliceKey(gs), perSlice[i]!]));
    return (pred, gs) => (pred && gs ? bySlice.get(sliceKey(gs))! : academy);
  });
  // 이어지는 교시(같은 반·강사·교실)는 한 줄로 — 원장 2026-09-13, 규칙은 continuous-classes.ts.
  add("schedule", ["timetable"], async () =>
    mergeContinuousClasses(
      (await getTodaySchedule()).map(
        ({
          id,
          classId,
          className,
          subject,
          startTime,
          endTime,
          teacherName,
          classroomName,
          status,
        }) => ({
          id,
          classId,
          className,
          subject,
          startTime,
          endTime,
          teacherName,
          classroomName,
          status,
        }),
      ),
    ),
  );
  addSliced("staff", ["staff"], () => staff(settingsPromise));
  add("operations", [], () => operations(allowed, user.id));
  add("notices", [], () => getRecentAnnouncements(user.systemRole, 4));
  addSliced("calendar", ["calendar"], async () => {
    // 창 = **오늘부터 한 달**(원장 2026-09-16 *"오늘 기준으로 1달 이내로"*, 그전엔 7일) — `monthAheadWindow` 한 함수를
    // 패널 머리·빈 문구(화면)와 '보강예정' 카드가 함께 쓴다. 일정 조회·첫 수업 연결 후보가 모두 이 `end`를 쓴다.
    const { end } = monthAheadWindow(today);
    // 콜&상담 연결 후보(원장 2026-09-13)는 일정 조회와 독립이라 먼저 띄운 공유 조회(`consultationRows`)를 받는다(B4) — 저장하지 않고
    // 갱신마다 다시 맞추므로 일정이 먼저 있고 상담이 나중에 생겨도 다음 갱신에 붙는다. 실패해도 빈 목록(링크만 없다).
    const consultationsPromise: Promise<Awaited<ReturnType<typeof admissionsConsultationCandidates>>> =
      consultationRows
        ? consultationRows.catch((error) => {
            reportError(error, { scope: "dashboard.admissions-consultation-links" });
            return [];
          })
        : Promise.resolve([]);
    // 창 구간을 **한 번에**(수기 일정만) — 달 단위로 받으면 창이 두 달에 걸치는 거의 모든 날 조회가 두 벌이 된다.
    // 휴가 오버레이는 안 받는다: 분류기(`admissionsEventKind`)가 `source !== "manual"`을 전부 버린다.
    // 전일 첫날(어제 · 월요일엔 토요일)부터 읽는다 — KPI '전일 입테'(원장 2026-10-22 *"금일 입테 -> 전일 입테로 … 측정하는것도
    // 전일 입테로"* · *"월요일의 전일은 주말 모두 포함"*). 오늘 전 줄은 **레벨테스트만** 싣고(취소 포함 — 팝업 취소선),
    // 패널은 `upcomingAdmissionsRows`로 오늘부터만 그린다.
    const prevFrom = previousDayRange(today).from;
    const result = await getDateRangeEvents(prevFrom, end);
    if (!result.ready) throw new Error("학원 일정 연결 확인 필요");
    // 취소된 일정도 목록에 취소선으로 남는다(원장 2026-09-30) — 반·상담 연결과 그 조회는 **살아 있는 일정만**(`live`).
    const upcoming = upcomingAdmissionsEvents(result.events, prevFrom, end).filter(
      (event) => event.endDate >= today || admissionsEventBaseKind(event) === "levelTest",
    );
    const live = upcoming.filter((e) => !isCancelledEventTitle(e.title));
    let candidates: Awaited<ReturnType<typeof firstClassCandidates>> = [];
    let classSlots: Awaited<ReturnType<typeof firstClassScheduleCandidates>> =
      [];
    // 반 연결(첫 수업)과 상담 연결(콜&상담)은 서로 독립이라 함께 기다린다(B4). 어느 쪽이 실패해도 일정 자체는 계속 보여준다.
    const [, consultations] = await Promise.all([
      (async () => {
        if (
          !allowed.includes("students") ||
          !allowed.includes("classes") ||
          !live.some((e) => /첫\s*수업/.test(`${e.title} ${e.tag?.name ?? ""}`))
        )
          return;
        try {
          [candidates, classSlots] = await Promise.all([
            firstClassCandidates(today, end),
            firstClassScheduleCandidates(today, end),
          ]);
        } catch (error) {
          reportError(error, { scope: "dashboard.first-class-links" });
        }
      })(),
      consultationsPromise,
    ]);
    const calendarSettings = await settingsPromise;
    const subjectLabels = subjectLabelRecord(calendarSettings.operations.subjects);
    const notNames = Object.values(subjectLabels);
    // 동명이인 가족(같은 이름의 재원·대기 원생들) — 창 안 상담이 한 명뿐이어도 원생 표엔 같은 이름이 더 있을 수 있다(김근우/김근우A).
    // 제목에 걸린 이름만 좁혀 조회하고, 조회가 실패하면 상담 연결을 통째로 끈다(모르는 채 붙이면 다른 아이 이름으로 바뀐다).
    const bases = consultationBasesInTitles(live, consultations, notNames);
    let families: Awaited<ReturnType<typeof homonymFamilies>> | null = new Map();
    if (bases.length) {
      try {
        families = await homonymFamilies(bases);
      } catch (error) {
        reportError(error, { scope: "dashboard.admissions-homonyms" });
        families = null;
      }
    }
    const rows = upcoming.map((event) => {
      // 취소된 일정 = 목록에 취소선으로만(원장 2026-09-30). 반·콜&상담 링크·이름 바로잡기·단계 칩을 붙이지 않고
      // `kind`는 null(전일 입테·열 건수에서 빠진다), 원래 종류는 `cancelledKind`로만 싣는다.
      if (isCancelledEventTitle(event.title)) {
        return {
          id: event.id,
          title: event.title,
          startDate: event.startDate,
          endDate: event.endDate,
          startTime: event.startTime,
          source: event.source,
          kind: null,
          cancelledKind: admissionsEventBaseKind(event),
          matchedClass: null,
          matchedConsultation: null,
        };
      }
      // 학생으로 확정된 반 연결만 원생 이름을 준다(시간표 슬롯으로 찾은 반은 학생이 없다).
      const byStudent = matchFirstClass(event, candidates, subjectLabels);
      const matchedClass =
        byStudent ?? matchFirstClassSchedule(event, classSlots, subjectLabels);
      const matchedConsultation = families
        ? matchAdmissionsConsultation(event, consultations, notNames, {
            since: consultationSince,
            families,
          })
        : null;
      return {
        id: event.id,
        title: event.title,
        // 제목의 '김근우' → 연결된 원생의 정식 이름 '김근우A'(반 연결이 먼저, 없으면 상담의 원생). 원문은 title에 남는다.
        displayTitle: canonicalEventTitle(
          event.title,
          byStudent?.studentName ?? matchedConsultation?.name,
        ),
        startDate: event.startDate,
        endDate: event.endDate,
        startTime: event.startTime,
        source: event.source,
        kind: admissionsEventKind(event),
        matchedClass,
        matchedConsultation,
      };
    });
    // 일정의 과목(원장 2026-10-14 2단계) — 연결된 상담의 과목 · 연결된 반의 과목 · 제목·태그에 적힌 과목 이름. 하나도 없으면
    // '모름'이라 모든 과목 관리자에게 보인다(입테 일정은 과목을 안 적는 일이 흔하다 — 숨기면 아무도 못 본다).
    // 제목 속 과목 이름은 낱말로 선 것만 읽는다(`subjectsNamedIn` — 콜&상담과 같은 이름표라 'EiE'도 영어).
    const classSubject = new Map([...candidates, ...classSlots].map((c) => [c.classId, c.subject]));
    const consultSubject = new Map(consultations.map((c) => [c.id, c.subject]));
    const subjectsOf = rows.map((row, i) => {
      const named = subjectsNamedIn(`${upcoming[i]!.title} ${upcoming[i]!.tag?.name ?? ""}`, sliceSubjects, groupOf);
      return [
        ...(row.matchedConsultation ? [consultSubject.get(row.matchedConsultation.id) ?? null] : []),
        ...(row.matchedClass ? [classSubject.get(row.matchedClass.id) ?? null] : []),
        ...named,
      ].filter((k): k is string => !!k);
    });
    return (pred) => (pred ? rows.filter((_, i) => inSliceAny(pred, subjectsOf[i]!)) : rows);
  });
  // '상담 진행'(원장 2026-09-22) — 콜&상담 단계별 인원 + 멈춘 상담 + 줄마다 단계 칩. 판정은 consultation-progress.ts 한 벌이고
  // 단계는 칸반과 같은 stageOfCard다. 입테는 캘린더를 읽을 수 있을 때만(못 읽으면 '모름' — 0으로 적지 않는다).
  addSliced("consultProgress", ["enrollment"], async () => {
    const { end } = monthAheadWindow(today);
    const [rows, calendar, progressSettings] = await Promise.all([
      consultationRows!,
      // 일정을 못 읽어도 카드는 산다 — 입테만 '모름'이 된다(단계별 인원·멈춘 상담의 상담 쪽 판정은 그대로).
      allowed.includes("calendar")
        ? getDateRangeEvents(consultationSince, end).catch((error) => {
            reportError(error, { scope: "dashboard.consult-progress-calendar" });
            return null;
          })
        : Promise.resolve(null),
      settingsPromise,
    ]);
    const notNames = Object.values(subjectLabelRecord(progressSettings.operations.subjects));
    const { list, levelTestKnown } = await consultProgressList(rows, calendar?.ready ? calendar.events : null, notNames, consultationSince, today);
    // 과목 관리자 = 상담 과목이 담당 과목이거나 과목을 안 고른 상담만 센다(단계별 인원·멈춘 상담·칩 모두 같은 줄).
    return (pred) => consultProgressData(pred ? list.filter((p) => pred(p.subject)) : list, levelTestKnown, today);
  });
  add("englishSheet", ["ecs"], async () => {
    const result = await getSheetLanding(null);
    if (!result.ok) throw new Error("영어 시트 조회 실패");
    return {
      period: result.weekLabel,
      classes: result.cards.length,
      filled: result.cards.reduce((sum, c) => sum + c.filledSlots, 0),
      total: result.cards.reduce((sum, c) => sum + c.totalSlots, 0),
    };
  });
  add("mathSheet", ["mcs"], async () => {
    const result = await getMathSheetLanding(today.slice(0, 7));
    if (!result.ok) throw new Error("수학 시트 조회 실패");
    return {
      period: result.data.monthLabel,
      classes: result.data.cards.length,
      filled: result.data.cards.reduce((sum, c) => sum + c.written, 0),
      total: result.data.cards.reduce((sum, c) => sum + c.shown, 0),
    };
  });
  // 🔴 전부 기다리지 않는다 — 하나가 늘어지면 세그먼트 상한(60초)을 넘겨 **운영실이 통째로 504**가 됐다
  //    (원장 콘솔 2026-09-16). 마감이 지나면 못 끝낸 칸만 '시간 초과'로 비우고 화면을 낸다.
  await settleWithin(jobs, remainingMs(budgetFrom, OVERVIEW_BUDGET_MS, Date.now()));
  if (pending.size > 0) {
    // 한 줄로 모은다 — 느린 날 렌더마다 25줄이 쌓이면 진짜 신호가 묻힌다.
    console.error(`[dashboard/overview] 렌더 마감 ${OVERVIEW_BUDGET_MS}ms 초과 — 비운 칸: ${[...pending].join(", ")}`);
    for (const area of pending) {
      Object.assign(sections, { [area]: { data: null, at: null, error: true, timedOut: true } });
    }
  }
  // ⚠️ 이 둘은 마감 **밖**이다 — 학원 이름·과목 라벨이 없으면 화면을 만들 수 없어 '비우기'가 성립하지 않는다
  //    (`getTenantSettings`는 테넌트별 `unstable_cache`, 강사 스코프는 요청당 캐시라 대개 이미 끝나 있다).
  const settings = await settingsPromise;
  const teacherId = await teacherIdPromise;
  if (!isModuleEnabled(settings.modules.disabled, "classnote")) delete sections.unread; // ClassNote 꺼짐 = 카드 없음
  // 🔴 값 정리는 서버에서 — 금액·전화번호·담당 과목 밖 값은 직렬화되기 전에 여기서 비운다(브라우저가 가리는 게 아니다).
  //    `full`(설정 '대시보드 관리'의 미리보기 원본, 원장·총괄만)은 원장 시점 그대로 — 편집기가 역할마다 같은 함수를 다시 돌린다.
  // 마감에 걸려 비운 영역의 과목별 값은 버린다 — 학원 전체 칸은 비었는데 과목별 값만 늦게 들어오면 그 값이 실린다.
  for (const area of Object.keys(slices) as Area[]) if (sections[area]?.data == null) delete slices[area];
  const shaped = options.full ? sections : shapeSections({ ...sections }, view, { groups, groupOf: sliceGroup, slices });
  return {
    scope: `${user.tenantId}:${user.id}:${user.systemRole}:${teacherId ?? "all"}:${view.rev}${options.full ? ":full" : ""}`,
    tenantId: user.tenantId,
    ...(teacherId ? { teacherView: true as const } : {}),
    academy: settings.profile.name,
    today,
    requestedAt,
    allowed,
    subjects: subjectLabelRecord(settings.operations.subjects),
    ...(isModuleEnabled(settings.modules.disabled, "eie") ? {} : { eie: false as const }),
    view,
    // 과목별 값은 미리보기 원본에만 싣는다(편집기가 과목 관리자 배치를 그 과목 값으로 그린다) — 다른 화면엔 안 내려보낸다.
    ...(options.full ? { slices: { ...slices }, sliceSubjectKeys: sliceSubjects.map((s) => s.key) } : {}),
    // 🔑 **복사해서** 돌려준다 — 마감 뒤 늦게 끝난 조회가 직렬화 도중 같은 객체를 고치면 한 렌더 안에서
    //    카드가 실패 → 성공으로 뒤집힌다(그 결과는 이미 화면에 못 실린다).
    sections: { ...shaped },
  };
}
