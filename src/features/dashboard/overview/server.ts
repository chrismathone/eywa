import "server-only";
import { requireAccess } from "@/lib/auth/require-access";
import { getUserPermMatrix } from "@/lib/auth/perm-matrix";
import {
  effectiveTeacherId,
  effectiveTeacherScope,
} from "@/lib/auth/view-mode";
import { canAccess, MENU_KEYS, type MenuKey } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { getEnrolledStatCounts } from "@/features/students/server/queries";
import { getClassesStats } from "@/features/classes/server/queries";
import { getRecentAnnouncements } from "@/features/dashboard/server/queries";
import { getDailyProcessingStatus } from "@/features/attendance/server/queries";
import {
  effectiveAttendanceRecords,
  type EffectiveAttendanceRecord,
} from "@/features/attendance/effective-records";
import { attendanceRate } from "@/lib/calc/attendance";
import { getGradeLevel, isPreschoolGrade } from "@/lib/format/school-grade";
import { summarizeInvoices } from "@/features/billing/calc";
import { getEnrollmentStats } from "@/features/enrollment/server/stats-queries";
import { getStudentConsultationCounts } from "@/features/consultations/server/queries";
import { getNewcomers } from "@/features/newcomers/server/queries";
import {
  ONBOARDING_ITEMS,
  BUCKET_LABEL,
  shiftDate,
} from "@/features/newcomers/onboarding-items";
import {
  getHomeworkRisk,
  getUnreadReports,
} from "@/features/dashboard/onescreen/server/queries";
import { getTodaySchedule } from "@/features/timetable/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { subjectLabelRecord } from "@/features/owner/subjects";
import { getApprovalBoxes } from "@/features/approvals/server/queries";
import { getInventoryCounts } from "@/features/inventory/server/queries";
import { getMonthEvents } from "@/features/calendar/server/queries";
import { getSheetLanding } from "@/features/class-sheets/server/queries";
import { getMathSheetLanding } from "@/features/math-sheets/server/landing";
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
import {
  distribution,
  datedWithdrawals,
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

async function students(): Promise<OverviewData["students"]> {
  const db = await createClient();
  const [counts, scope, rows] = await Promise.all([
    getEnrolledStatCounts(),
    effectiveTeacherScope(),
    fetchAllPaged<{ id: string; grade: string | null; school: string | null }>(
      (from, to) =>
        db
          .from("students")
          .select("id, grade, school")
          .eq("status", "enrolled")
          .order("id")
          .range(from, to),
    ),
  ]);
  const ids = scope ? new Set(scope.studentIds) : null;
  const visible = ids ? rows.filter((r) => ids.has(r.id)) : rows;
  return {
    enrolled: visible.length,
    subjects: Object.entries(counts.bySubject)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value),
    grades: distribution(visible.map((r) => r.grade)),
    levels: distribution(
      visible.map((r) =>
        isPreschoolGrade(r.grade)
          ? "미취학"
          : ({ 초: "초등", 중: "중등", 고: "고등" }[getGradeLevel(r.grade)] ??
            (r.grade ? "기타" : "미입력")),
      ),
    ),
    schools: distribution(visible.map((r) => r.school)),
  };
}

async function changes(today: string) {
  const db = await createClient();
  const fromDate = `${monthKeys(today)[0]}-01`;
  const [scope, enrolled, withdrawn] = await Promise.all([
    effectiveTeacherScope(),
    fetchAllPaged<{ id: string; enrolled_at: string }>((from, to) =>
      db
        .from("students")
        .select("id,enrolled_at")
        .gte("enrolled_at", fromDate)
        .order("id")
        .range(from, to),
    ),
    fetchAllPaged<{
      id: string;
      withdrawn_at: string;
      enrollments: { id: string }[];
    }>((from, to) =>
      db
        .from("students")
        .select("id,withdrawn_at,enrollments(id)")
        .gte("withdrawn_at", fromDate)
        .order("id")
        .range(from, to),
    ),
  ]);
  const ids = scope ? new Set(scope.studentIds) : null;
  return monthlyChanges(
    today,
    enrolled.filter((r) => !ids || ids.has(r.id)).map((r) => r.enrolled_at),
    datedWithdrawals(withdrawn.filter((r) => !ids || ids.has(r.id))),
  );
}

async function attendanceHistory(today: string) {
  const db = await createClient();
  const start = shiftDate(today, -13);
  const rows = await fetchAllPaged<
    EffectiveAttendanceRecord & { status: string }
  >((from, to) =>
    db
      .from("attendance_records")
      .select(
        "id,student_id,class_id,session_date,slot_start,status,recorded_at",
      )
      .gte("session_date", start)
      .lte("session_date", today)
      .order("id")
      .range(from, to),
  );
  // Attendance cells keep separate lesson periods; corrections replace only the same cell.
  const effective = effectiveAttendanceRecords(rows);
  const trend = Array.from({ length: 14 }, (_, i) => {
    const date = shiftDate(start, i);
    const day = effective.filter((r) => r.session_date === date);
    return {
      date,
      total: day.length,
      rate: day.length
        ? attendanceRate(
            day.filter((r) => r.status === "present" || r.status === "late")
              .length,
            day.length,
          )
        : null,
    };
  });
  const latest = trend.filter((r) => r.total > 0).at(-1);
  const day = latest
    ? effective.filter((r) => r.session_date === latest.date)
    : [];
  const count = (status: string) =>
    day.filter((r) => r.status === status).length;
  return {
    trend,
    snapshot: latest
      ? {
          date: latest.date,
          total: latest.total,
          present: count("present"),
          absent: count("absent"),
          late: count("late"),
          excused: count("excused"),
          rate: latest.rate!,
        }
      : null,
  };
}

async function billing(today: string) {
  const db = await createClient();
  const months = monthKeys(today);
  const rows = await fetchAllPaged<{
    period: string;
    amount_total: number;
    amount_paid: number;
    amount_discount: number | null;
    status: string;
  }>((from, to) =>
    db
      .from("invoices")
      .select("period,amount_total,amount_paid,amount_discount,status")
      .in("period", months)
      .neq("status", "void")
      .order("id")
      .range(from, to),
  );
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

async function newcomers(): Promise<CareSummary> {
  const view = await getNewcomers();
  // The source page remains usable when the check table is unavailable. Do not manufacture overdue counts.
  const available = view.checksAvailable && !view.checksError;
  return {
    total: view.rows.length,
    stages: Object.entries(BUCKET_LABEL).map(([key, label]) => ({
      label:
        (
          {
            d7: "0–7일",
            d30: "8–30일",
            d60: "31–60일",
            d90: "61–90일",
          } as Record<string, string>
        )[key] ?? label,
      value: view.rows.filter((r) => r.bucket === key).length,
    })),
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

async function staff() {
  const db = await createClient();
  const rows = await fetchAllPaged<{ system_role: string }>((from, to) =>
    db
      .from("users")
      .select("system_role")
      .eq("status", "active")
      .neq("system_role", "student")
      .order("id")
      .range(from, to),
  );
  const labels: Record<string, string> = {
    master: "원장",
    admin: "관리자",
    manager: "매니저",
    teacher: "강사",
    counselor: "상담",
    accountant: "회계",
    viewer: "열람",
  };
  return distribution(rows.map((r) => labels[r.system_role] ?? r.system_role));
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
  const history = allowed.includes("attendance")
    ? attendanceHistory(today)
    : null;
  const sections: Sections = {};
  const jobs: Promise<void>[] = [];
  function add<K extends Area>(
    area: K,
    menus: MenuKey[],
    load: () => Promise<OverviewData[K]>,
  ) {
    if (!menus.every((key) => allowed.includes(key))) return;
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
      })(),
    );
  }
  add("students", ["students"], students);
  add("changes", ["students"], () => changes(today));
  add("attendance", ["attendance"], async () => (await history)!.snapshot);
  add("processing", ["attendance"], () => getDailyProcessingStatus(today));
  add("attendanceTrend", ["attendance"], async () => (await history)!.trend);
  add("billing", ["billing"], () => billing(today));
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
    getEnrollmentStats(Number(today.slice(0, 4))),
  );
  add("consultations", ["consultations"], getStudentConsultationCounts);
  add("newcomers", ["newcomers"], newcomers);
  add("homework", ["lesson_reports"], getHomeworkRisk);
  add("unread", ["lesson_reports"], getUnreadReports);
  add("schedule", ["timetable"], async () =>
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
  );
  add("classes", ["classes"], getClassesStats);
  add("staff", ["staff"], staff);
  add("operations", [], () => operations(allowed, user.id));
  add("notices", [], () => getRecentAnnouncements(user.systemRole, 4));
  add("calendar", ["calendar"], async () => {
    const end = shiftDate(today, 6);
    const months = [...new Set([today.slice(0, 7), end.slice(0, 7)])];
    const results = await Promise.all(months.map(getMonthEvents));
    if (results.some((r) => !r.ready))
      throw new Error("학원 일정 연결 확인 필요");
    const events = [
      ...new Map(
        results.flatMap((r) => r.events).map((e) => [e.id, e]),
      ).values(),
    ];
    return events
      .filter(
        (e) =>
          e.endDate >= today &&
          e.startDate <= end &&
          e.source === "manual" &&
          !/^\s*\[취소\]/.test(e.title) &&
          !e.title.includes("예약 금지") &&
          !e.tag?.name.includes("운영팀 중요일정"),
      )
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .map(({ id, title, startDate, endDate, startTime, source }) => ({
        id,
        title,
        startDate,
        endDate,
        startTime,
        source,
      }));
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
  const settingsPromise = getTenantSettings();
  await Promise.all(jobs);
  const settings = await settingsPromise;
  const teacherId = await effectiveTeacherId();
  return {
    scope: `${user.tenantId}:${user.id}:${user.systemRole}:${teacherId ?? "all"}`,
    tenantId: user.tenantId,
    academy: settings.profile.name,
    today,
    requestedAt,
    allowed,
    subjects: subjectLabelRecord(settings.operations.subjects),
    sections,
  };
}
