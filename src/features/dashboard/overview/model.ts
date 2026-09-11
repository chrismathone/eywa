import type { BillingSummary } from "@/features/billing/calc";
import type {
  AttendanceSnapshot,
  AnnouncementRow,
} from "@/features/dashboard/server/queries";
import type { ClassProcessing } from "@/features/attendance/server/queries";
import type { EnrollmentStats } from "@/features/enrollment/server/stats-queries";
import type { StudentConsultationCounts } from "@/features/consultations/server/queries";
import type {
  HomeworkRiskView,
  UnreadReportsView,
} from "@/features/dashboard/onescreen/server/queries";
import type { TodaySlot } from "@/features/timetable/server/queries";
import type { MenuKey } from "@/lib/permissions";
import type { ExpenseSummary } from "@/features/billing/server/expense-queries";
import { isSystemBulkWithdrawal } from "@/features/withdrawals/system-bulk";

export type Distribution = { label: string; value: number }[];
export type MonthChange = {
  month: string;
  enrolled: number;
  withdrawn: number;
};
export type CareSummary = {
  total: number;
  stages: Distribution;
  checksAvailable: boolean;
  items: {
    label: string;
    needs: { id: string; name: string }[];
    optional: boolean;
    done: number;
    overdue: number;
    due: number;
    upcoming: number;
    pending: number;
    waived: number;
  }[];
};
export type OperationCount = {
  label: string;
  href: string;
  count: number | null;
  unit: string;
};
export type OverviewData = {
  students: {
    enrolled: number;
    subjects: Distribution;
    grades: Distribution;
    levels: Distribution;
    schools: Distribution;
    schoolGroups?: import("./student-composition").SchoolGroup[];
    concurrent?: number;
    subjectCombinations?: { subjects: string[]; value: number }[];
  };
  changes: MonthChange[];
  attendance: AttendanceSnapshot | null;
  processing: ClassProcessing[];
  attendanceTrend: { date: string; rate: number | null; total: number }[];
  billing: BillingSummary[];
  expenses: ExpenseSummary;
  absences: {
    anchor: string | null;
    rows: {
      studentId: string;
      studentName: string;
      absences: number;
      unexplained: number;
    }[];
  };
  admissions: EnrollmentStats;
  consultations: StudentConsultationCounts;
  newcomers: CareSummary;
  homework: HomeworkRiskView;
  unread: UnreadReportsView;
  schedule: Pick<
    TodaySlot,
    | "id"
    | "classId"
    | "className"
    | "subject"
    | "startTime"
    | "endTime"
    | "teacherName"
    | "classroomName"
    | "status"
  >[];
  classes: { total: number; active: number; totalSeats: number };
  staff: Distribution;
  operations: OperationCount[];
  notices: AnnouncementRow[];
  calendar: {
    id: string;
    title: string;
    startDate: string;
    endDate: string;
    startTime: string | null;
    source: string;
    matchedClass?: { id: string; name: string } | null;
  }[];
  englishSheet: {
    period: string;
    classes: number;
    filled: number;
    total: number;
  };
  mathSheet: { period: string; classes: number; filled: number; total: number };
};
export type Area = keyof OverviewData;
export type Section<T> = { data: T | null; at: number | null; error: boolean };
export type Sections = { [K in Area]?: Section<OverviewData[K]> };
export type OverviewSnapshot = {
  scope: string;
  tenantId: string;
  academy: string;
  today: string;
  requestedAt: number;
  allowed: MenuKey[];
  subjects: Record<string, string>;
  sections: Sections;
};

/** A failed refresh never turns the last successful reading into a zero. Revoked areas disappear. */
export function mergeSnapshot(
  previous: OverviewSnapshot | undefined,
  next: OverviewSnapshot,
): OverviewSnapshot {
  if (
    !previous ||
    previous.scope !== next.scope ||
    previous.today !== next.today
  )
    return next;
  if (next.requestedAt < previous.requestedAt) return previous;
  const sections = { ...next.sections };
  for (const key of Object.keys(sections) as Area[]) {
    const current = sections[key];
    const old = previous.sections[key];
    if (current?.error && old && old.at !== null) {
      // Both values belong to the same mapped key; preserve its exact payload, including a successful null.
      Object.assign(sections, { [key]: { ...old, error: true } });
    }
  }
  return { ...next, sections };
}

export function distribution(
  values: (string | null)[],
  empty = "미입력",
): Distribution {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value?.trim() || empty;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "ko"));
}

export function monthKeys(today: string, count = 6): string[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;
  return Array.from({ length: count }, (_, i) =>
    new Date(Date.UTC(year, month - count + 1 + i, 1))
      .toISOString()
      .slice(0, 7),
  );
}

/** Match the withdrawal page: unknown dates from system cleanup are not dated departures. */
export function datedWithdrawals(
  rows: { withdrawn_at: string; enrollments: { id: string }[] }[],
): string[] {
  return rows
    .filter(
      (row) =>
        !isSystemBulkWithdrawal({
          withdrawnAt: row.withdrawn_at,
          hasEnrollmentHistory: row.enrollments.length > 0,
        }),
    )
    .map((row) => row.withdrawn_at);
}

export function monthlyChanges(
  today: string,
  enrolled: string[],
  withdrawn: string[],
): MonthChange[] {
  return monthKeys(today).map((month) => ({
    month,
    enrolled: enrolled.filter(
      (d) => d.slice(0, 7) === month && d.slice(0, 10) <= today,
    ).length,
    withdrawn: withdrawn.filter(
      (d) => d.slice(0, 7) === month && d.slice(0, 10) <= today,
    ).length,
  }));
}

export function processingSummary(rows: ClassProcessing[]) {
  const expected = rows.reduce((sum, row) => sum + row.expected, 0);
  const recorded = rows.reduce(
    (sum, row) => sum + Math.min(row.recorded, row.expected),
    0,
  );
  return {
    expected,
    recorded,
    complete: rows.filter((r) => r.expected > 0 && r.unprocessed === 0).length,
    partial: rows.filter((r) => r.recorded > 0 && r.unprocessed > 0).length,
    unmarked: rows.filter((r) => r.expected > 0 && r.recorded === 0).length,
    empty: rows.filter((r) => r.expected === 0).length,
  };
}
