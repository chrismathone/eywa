import "server-only";
import { isModuleEnabled } from "@/lib/modules";
import { requireAccess } from "@/lib/auth/require-access";
import { getUserPermMatrix } from "@/lib/auth/perm-matrix";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { getTeacherScope, type TeacherScope } from "@/lib/auth/teacher-scope";
import { canAccess, MENU_KEYS, type MenuKey } from "@/lib/permissions";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { kstTimeOf, kstToday } from "@/lib/date-kst";
import {
  countEnrolledStudents,
  fetchActiveEnrolledEnrollments,
  fetchEnrolledStudents,
} from "@/features/students/server/enrolled-programs";
import {
  composeEnrolled,
  notYetStartedStudentIds,
  enrolledSubjectCounts,
  gradeSplit,
  summarizePrograms,
} from "@/features/students/enrolled-composition";
import { getWithdrawalsInWindow, type WindowWithdrawal } from "@/features/withdrawals/server/window";
import {
  inWithdrawalWindow,
  withdrawalMonthWindow,
  withdrawalProgram,
} from "@/features/withdrawals/window";
import { isMergedStudent } from "@/features/students/merged";
import { getIntakeOnDay } from "@/features/enrollment/server/intake-day";
import { getFirstClassStudents } from "@/features/dashboard/server/day-arrivals-query";
import { getScopedAbsentStudents } from "@/features/dashboard/server/absent-students";
import { absentKpiDate } from "./kpi-links";
import { getUpcomingMakeupOverview } from "@/features/dashboard/server/makeup-upcoming";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { getRecentAnnouncements } from "@/features/dashboard/server/queries";
import { getDailyProcessingStatus } from "@/features/attendance/server/queries";
import {
  effectiveAttendanceRecords,
  type EffectiveAttendanceRecord,
} from "@/features/attendance/effective-records";
import { attendanceOverview, attendanceWindowStart } from "./attendance-day";
import { getGradeLevel, isPreschoolGrade } from "@/lib/format/school-grade";
import { summarizeInvoices } from "@/features/billing/calc";
import { getRecentEnrollmentStats } from "@/features/enrollment/server/stats-queries";
import { getStudentConsultationCounts } from "@/features/consultations/server/queries";
import { getNewcomers } from "@/features/newcomers/server/queries";
import {
  ONBOARDING_ITEMS,
  shiftDate,
} from "@/features/newcomers/onboarding-items";
import {
  getHomeworkRisk,
  getUnreadReports,
} from "@/features/dashboard/onescreen/server/queries";
import { getTodaySchedule } from "@/features/timetable/server/queries";
import { mergeContinuousClasses } from "./continuous-classes";
import { getTenantSettings } from "@/features/owner/server/queries";
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
import { careStatus } from "./care";
import { schoolsByLevel, levelSubjectSplit } from "./student-composition";
import { newcomerStages } from "./newcomer-composition";
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
import {
  admissionsEventKind,
  staffDisplayRole,
  upcomingAdmissionsEvents,
} from "./display";
import { monthAheadWindow } from "./upcoming-window";
import { consultProgress } from "./consultation-progress-server";
import { staffComposition } from "./staff-subjects";
import {
  distribution,
  monthlyChanges,
  monthKeys,
  type Area,
  type CareSummary,
  type OperationCount,
  type OverviewData,
  type OverviewSnapshot,
  type Section,
  type Sections,
} from "./model";

type Settings = Awaited<ReturnType<typeof getTenantSettings>>;

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
): Promise<OverviewData["students"]> {
  const db = await createClient();
  const today = kstToday();
  const [studentRows, rows, settings] = await Promise.all([
    fetchEnrolledStudents(db),
    fetchActiveEnrolledEnrollments(db),
    settingsPromise,
  ]);
  // '실시간 재원생'(원장 2026-09-16) — 아직 한 과목도 시작 안 한 학생은 총원·과목·학년 분해에서 함께 빠진다.
  // 🔴 `countEnrolledStudents`가 이 행들을 다시 받지 않게 **같은 rows에서** 집합을 만든다(운영실 30초 갱신은
  //    서버 액션이라 React cache가 조회를 묶지 않는다 — 여기서 한 번 받은 것을 넘긴다는 이 함수의 규약 그대로).
  const notStarted = notYetStartedStudentIds(rows, today);
  const enrolled = await countEnrolledStudents(db, scope, notStarted);
  const composition = composeEnrolled({
    students: studentRows,
    rows,
    scope,
    subjects: settings.operations.subjects,
    today,
  });
  const counts = enrolledSubjectCounts(rows, scope, today);
  const visible = composition.students;
  const programs = summarizePrograms(
    visible.map((r) => r.id),
    composition.programs,
    composition.active,
  );
  return {
    enrolled,
    subjects: Object.entries(counts.bySubject)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value),
    levels: distribution(
      visible.map((r) =>
        isPreschoolGrade(r.grade)
          ? "미취학"
          : ({ 초: "초등", 중: "중등", 고: "고등" }[getGradeLevel(r.grade)] ??
            (r.grade ? "기타" : "미입력")),
      ),
    ),
    schools: distribution(visible.map((r) => r.school)),
    schoolGroups: schoolsByLevel(visible, composition.programs, composition.active),
    // 동시 수강 = 영어 + 수학(원장 2026-09-11 재정의) — gradeSplit 보라 합계와 같은 subjectMixOf 판정.
    concurrent: programs.both,
    subjectCombinations: counts.combinations,
    programs,
    gradeSplit: gradeSplit(visible, composition.programs, settings.operations.gradeLevels),
    levelSplit: levelSubjectSplit(visible, composition.programs),
  };
}

/**
 * KPI '퇴원생' — 이번 달 1일 ~ min(말일, 오늘)(KST). 추이 패널과 **같은 행**(loadOverview가 한 번 받은 getWithdrawalsInWindow)을
 * 퇴원관리 `range=month`와 **같은 창 판정**(withdrawalMonthWindow + inWithdrawalWindow)으로 거른다 — 카드 = 패널 이번 달 칸 = 퇴원관리.
 */
async function monthWithdrawals(
  rowsPromise: Promise<WindowWithdrawal[]>,
  today: string,
  settingsPromise: Promise<Settings>,
): Promise<OverviewData["withdrawals"]> {
  const month = today.slice(0, 7);
  const win = withdrawalMonthWindow(month, today);
  const [rows, settings] = await Promise.all([rowsPromise, settingsPromise]);
  return {
    month,
    rows: rows
      .filter((row) =>
        inWithdrawalWindow({ withdrawnAt: row.withdrawnAt, systemBulk: false }, win.from, win.to),
      )
      .map((row) => ({
        id: row.id,
        name: row.name,
        schoolGrade: schoolGradeLabel(row.school, row.grade) || null,
        withdrawnAt: row.withdrawnAt,
        program: withdrawalProgram(row, settings.operations.subjects),
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
 * 🔴 퇴원 칸은 KPI '퇴원생'·퇴원관리와 **같은 모집단**(getWithdrawalsInWindow: status=withdrawn · 시스템 정리 제외 ·
 *    마지막 종료 수강 규칙 · 강사 스코프 없음)이다 — 이번 달 칸(1일~오늘) = 카드. 등록 칸은 종전대로 강사 스코프를 건다.
 */
async function changes(
  today: string,
  scope: TeacherScope | null,
  withdrawalRows: Promise<WindowWithdrawal[]>,
) {
  const db = await createClient();
  const fromDate = `${monthKeys(today)[0]}-01`;
  const [enrolled, withdrawn] = await Promise.all([
    fetchAllPaged<{ id: string; enrolled_at: string; notes: string | null }>((from, to) =>
      db
        .from("students")
        .select("id,enrolled_at,notes")
        .gte("enrolled_at", fromDate)
        .order("id")
        .range(from, to),
    ),
    withdrawalRows,
  ]);
  const ids = scope ? new Set(scope.studentIds) : null;
  // 🔴 이 조회는 **status를 보지 않는다**(퇴원했다 복구된 학생의 그 달 등록을 살리려고) — 그래서 중복 병합된
  //    학생도 그대로 등록으로 세고 있었다(원장 2026-09-13). 퇴원 칸은 `withdrawalRows`가 이미 걸러 온다.
  return monthlyChanges(
    today,
    enrolled
      .filter((r) => (!ids || ids.has(r.id)) && !isMergedStudent(r.notes))
      .map((r) => r.enrolled_at),
    withdrawn.map((r) => r.withdrawnAt),
  );
}

async function attendanceHistory(today: string) {
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
  return attendanceOverview(effectiveAttendanceRecords(rows), today);
}

type InvoiceTrendRow = {
  period: string;
  amount_total: number;
  amount_paid: number;
  amount_discount: number | null;
  status: string;
};

function summarizeInvoiceMonths(rows: InvoiceTrendRow[], months: string[]) {
  return months.map((month) =>
    summarizeInvoices(
      rows
        .filter((r) => r.period === month)
        .map((r) => ({
          amountTotal: Number(r.amount_total),
          amountPaid: Number(r.amount_paid),
          amountDiscount: Number(r.amount_discount ?? 0),
          status: r.status,
        })),
      month,
    ),
  );
}

const invoiceTrendSelect = "period,amount_total,amount_paid,amount_discount,status";

/**
 * 지난 달들의 청구 요약 — tenantId별 `unstable_cache`(5분). 여러 달 청구서(실측 2026-09: 월 340~430행)를 30초 갱신마다 전건
 * 다시 받으면 B2 위반이라, 바뀌지 않는 지난 달은 캐시하고 **이번 달만** 요청마다 새로 읽는다(수납 현황 카드가 같은 값을 쓴다).
 * 캐시 안엔 쿠키가 없어 admin client + 신뢰된 tenantId 키(`loadTenantSettingsRaw`와 같은 패턴, `.eq(tenant_id)` 격리).
 * ⚠️ 지난 달 미수가 5분 뒤에 반영되는 것은 감수(추이 차트) — 이번 달 숫자는 즉시.
 */
const loadPastInvoiceMonths = (tenantId: string, months: string[]) =>
  unstable_cache(
    async () => {
      const admin = createAdminClient();
      const rows = await fetchAllPaged<InvoiceTrendRow>((from, to) =>
        admin
          .from("invoices")
          .select(invoiceTrendSelect)
          .eq("tenant_id", tenantId)
          .in("period", months)
          .neq("status", "void")
          .order("id")
          .range(from, to),
      );
      return summarizeInvoiceMonths(rows, months);
    },
    ["dashboard-invoice-trend", tenantId, months.join(",")],
    { tags: [`dashboard-invoice-trend:${tenantId}`], revalidate: 300 },
  )();

async function billing(today: string, tenantId: string) {
  const db = await createClient();
  // 최근 6개월(원장 2026-09-13 "청구 6개월로 바꾸자. 다시 돌려" — 12개월로 넓혔더니 청구서가 2026-01부터라 앞 석 달이 빈 칸이었다).
  const months = monthKeys(today);
  const current = months[months.length - 1];
  const [past, currentRows] = await Promise.all([
    loadPastInvoiceMonths(tenantId, months.slice(0, -1)),
    fetchAllPaged<InvoiceTrendRow>((from, to) =>
      db
        .from("invoices")
        .select(invoiceTrendSelect)
        .eq("period", current)
        .neq("status", "void")
        .order("id")
        .range(from, to),
    ),
  ]);
  return [...past, ...summarizeInvoiceMonths(currentRows, [current])];
}

async function newcomers(settingsPromise: Promise<Settings>): Promise<CareSummary> {
  const [view, settings] = await Promise.all([getNewcomers(), settingsPromise]);
  // The source page remains usable when the check table is unavailable. Do not manufacture overdue counts.
  const available = view.checksAvailable && !view.checksError;
  return {
    total: view.rows.length,
    stages: newcomerStages(view.rows, settings.operations.subjects),
    checksAvailable: available,
    items: available
      ? ONBOARDING_ITEMS.map((item) => {
          const statuses = view.rows.map((r) =>
            careStatus(item, r, view.today),
          );
          return {
            label: item.shortLabel,
            needs: view.rows
              .filter(
                (_, i) => statuses[i] === "due" || statuses[i] === "overdue",
              )
              .map((r) => ({ id: r.studentId, name: r.name })),
            optional: !!item.optional,
            done: statuses.filter((s) => s === "done").length,
            overdue: statuses.filter((s) => s === "overdue").length,
            due: statuses.filter((s) => s === "due").length,
            upcoming: statuses.filter((s) => s === "upcoming").length,
            pending: statuses.filter((s) => s === "pending").length,
            waived: statuses.filter((s) => s === "waived").length,
          };
        })
      : [],
  };
}

/**
 * 직원 구성 — 역할별 인원에 **과목 묶음**(영어·수학·둘 다·그 외·없음)을 함께 센다(원장 2026-09-12 *"수학강사 영어강사 색깔
 * 구분 · 과목 없는 강사는 진한 회색 · 관리자도 마찬가지"*). 판정·라벨은 순수 함수(staff-subjects.ts)이고 과목 묶음은
 * 학년별 재원생 막대와 같은 `subjectGroupOf`라 학원설정 과목을 읽는다(하드코딩 금지).
 */
async function staff(settingsPromise: Promise<Settings>) {
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
  return staffComposition(
    rows.map((r) => ({ role: staffDisplayRole(r), subjects: r.subjects })),
    settings.operations.subjects,
  );
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
  count("exams", "등록 시험", "exams", "/exams");
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

/** Authoritative, permission-gated snapshot. No cross-user server cache, no fallback zeros. */
export async function loadOverview(): Promise<OverviewSnapshot> {
  const requestedAt = Date.now();
  const user = await requireAccess("dashboard");
  const matrix = await getUserPermMatrix();
  const allowed = MENU_KEYS.filter((key) =>
    canAccess(user.systemRole, key, matrix),
  );
  const today = kstToday();
  // 🔴 '전일 결석'만 **어제**를 본다(원장 2026-09-12) — 오늘은 수업 전이면 결석을 알 수 없다. 갱신(서버 액션)마다
  //    다시 계산되므로 자정이 지나면 기준일도 함께 넘어간다.
  const absentDate = absentKpiDate(today);
  const settingsPromise = getTenantSettings();
  // 🔑 B1 — 강사 스코프를 **한 번만** 푼다. 서버 액션 갱신에선 React cache가 안 묶어서 영역마다 부르면
  //    getCurrentUser가 그만큼 users를 다시 읽는다. 영역엔 푼 값을 넘긴다.
  const teacherIdPromise = effectiveTeacherId();
  const scopePromise = teacherIdPromise.then((id) => (id ? getTeacherScope(id) : null));
  // 이번 달 퇴원(KPI)과 등록·퇴원 추이(6개월)가 **같은 행**을 쓴다 — 한 번만 받는다(카드 = 패널 이번 달 칸).
  const withdrawalRows =
    allowed.includes("withdrawals") || allowed.includes("students")
      ? getWithdrawalsInWindow(`${monthKeys(today)[0]}-01`, today)
      : Promise.resolve([] as WindowWithdrawal[]);
  // 최근 60일 콜&상담 — 일정 카드(일정↔상담 연결)와 '상담 진행' 카드가 **같은 한 번의 조회**를 쓴다(두 카드가 같은 상담 집합을
  // 보고, 30초 갱신마다 같은 표를 두 번 읽지 않게). 실패 처리는 영역마다 다르다: 일정 카드는 링크만 빼고 살고, 상담 진행은 실패를 알린다.
  const consultationSince = shiftDate(today, -CONSULTATION_LINK_WINDOW_DAYS);
  const consultationRows = allowed.includes("enrollment")
    ? admissionsConsultationCandidates(consultationSince)
    : null;
  // 공유 약속이 영역보다 먼저 거절돼도 '처리 안 된 거절'로 새지 않게 — 각 영역은 자기 try/catch에서 다시 받는다.
  for (const shared of [teacherIdPromise, scopePromise, withdrawalRows, consultationRows]) void shared?.catch(() => undefined);
  const history = allowed.includes("attendance")
    ? attendanceHistory(today)
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
  add("students", ["students"], async () => students(await scopePromise, settingsPromise));
  add("changes", ["students"], async () => changes(today, await scopePromise, withdrawalRows));
  // ── KPI 여섯 칸(원장 2026-09-11) — 카드·팝업·목적지 화면이 같은 함수를 부른다.
  add("withdrawals", ["withdrawals"], () => monthWithdrawals(withdrawalRows, today, settingsPromise));
  add("intake", ["enrollment"], async () =>
    (await getIntakeOnDay(today)).map((row) => ({
      id: row.id,
      name: row.name,
      time: kstTimeOf(row.createdAt),
    })),
  );
  add("firstClass", ["students"], async () => firstClasses(today, await scopePromise, settingsPromise));
  // '보강예정'(원장 2026-09-14) — **오늘부터 한 달**(원장 2026-09-16) 보강 예약 + 지난 미이행. 창은 `monthAheadWindow` 한 함수
  // (아래 '레벨테스트 및 첫수업 일정'과 같은 끝 날짜) · 반 집합·기간 조회는 시간표 '보강' 탭과 같은 두 함수.
  add("makeup", ["attendance"], async () => getUpcomingMakeupOverview(today, await teacherIdPromise));
  // 출석부 `?status=absent`와 같은 함수·같은 강사 스코프(teacher-axis) — 겸직 강사뷰면 그 강사가 가르치는 반만.
  // 조회한 날을 `date`로 함께 실어 보낸다 — 카드·팝업·↗가 그 값을 읽어 셋이 같은 날을 말한다.
  add("absent", ["attendance"], async () => ({
    date: absentDate,
    ...(await getScopedAbsentStudents(absentDate, await teacherIdPromise)),
  }));
  add("attendance", ["attendance"], async () => (await history)!.snapshot);
  add("processing", ["attendance"], () => getDailyProcessingStatus(today));
  add("attendanceTrend", ["attendance"], async () => (await history)!.trend);
  add("billing", ["billing"], () => billing(today, user.tenantId));
  add("expenses", ["billing"], async () =>
    summarizeExpenses(
      await getExpensesForMonth(today.slice(0, 7)),
      today.slice(0, 7),
    ),
  );
  add("absences", ["attendance"], async () => {
    const db = { supabase: await createClient(), tenantId: user.tenantId };
    const [rows, anchor] = await Promise.all([
      getAbsenceRiskStudents(),
      getAbsenceRiskAnchor(db),
    ]);
    if (!anchor) return { anchor: null, rows: [] };
    const breakdown = await getAbsenceBreakdown(
      db,
      rows.map((r) => r.studentId),
      anchor,
    );
    return {
      anchor,
      rows: rows
        .map((r) => ({
          ...r,
          unexplained: unexplainedAbsences(
            r.absences,
            breakdown.reasons.get(r.studentId),
          ),
        }))
        .filter((r) => r.unexplained >= 3),
    };
  });
  add("admissions", ["enrollment"], () =>
    getRecentEnrollmentStats(today),
  );
  add("consultations", ["consultations"], getStudentConsultationCounts);
  add("newcomers", ["newcomers"], () => newcomers(settingsPromise));
  add("homework", ["lesson_reports"], getHomeworkRisk);
  add("unread", ["lesson_reports"], getUnreadReports);
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
  add("staff", ["staff"], () => staff(settingsPromise));
  add("operations", [], () => operations(allowed, user.id));
  add("notices", [], () => getRecentAnnouncements(user.systemRole, 4));
  add("calendar", ["calendar"], async () => {
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
    const result = await getDateRangeEvents(today, end);
    if (!result.ready) throw new Error("학원 일정 연결 확인 필요");
    const upcoming = upcomingAdmissionsEvents(result.events, today, end);
    let candidates: Awaited<ReturnType<typeof firstClassCandidates>> = [];
    let classSlots: Awaited<ReturnType<typeof firstClassScheduleCandidates>> =
      [];
    // 반 연결(첫 수업)과 상담 연결(콜&상담)은 서로 독립이라 함께 기다린다(B4). 어느 쪽이 실패해도 일정 자체는 계속 보여준다.
    const [, consultations] = await Promise.all([
      (async () => {
        if (
          !allowed.includes("students") ||
          !allowed.includes("classes") ||
          !upcoming.some((e) => /첫\s*수업/.test(`${e.title} ${e.tag?.name ?? ""}`))
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
    const bases = consultationBasesInTitles(upcoming, consultations, notNames);
    let families: Awaited<ReturnType<typeof homonymFamilies>> | null = new Map();
    if (bases.length) {
      try {
        families = await homonymFamilies(bases);
      } catch (error) {
        reportError(error, { scope: "dashboard.admissions-homonyms" });
        families = null;
      }
    }
    return upcoming.map((event) => {
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
  });
  // '상담 진행'(원장 2026-09-22) — 콜&상담 단계별 인원 + 멈춘 상담 + 줄마다 단계 칩. 판정은 consultation-progress.ts 한 벌이고
  // 단계는 칸반과 같은 stageOfCard다. 입테는 캘린더를 읽을 수 있을 때만(못 읽으면 '모름' — 0으로 적지 않는다).
  add("consultProgress", ["enrollment"], async () => {
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
    return consultProgress(rows, calendar?.ready ? calendar.events : null, notNames, consultationSince, today);
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
  return {
    scope: `${user.tenantId}:${user.id}:${user.systemRole}:${teacherId ?? "all"}`,
    tenantId: user.tenantId,
    academy: settings.profile.name,
    today,
    requestedAt,
    allowed,
    subjects: subjectLabelRecord(settings.operations.subjects),
    ...(isModuleEnabled(settings.modules.disabled, "eie") ? {} : { eie: false as const }),
    // 🔑 **복사해서** 돌려준다 — 마감 뒤 늦게 끝난 조회가 직렬화 도중 같은 객체를 고치면 한 렌더 안에서
    //    카드가 실패 → 성공으로 뒤집힌다(그 결과는 이미 화면에 못 실린다).
    sections: { ...sections },
  };
}
