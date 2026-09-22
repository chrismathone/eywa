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
import type { StaffRow } from "./staff-subjects";
import type { Program } from "@/features/students/program";
import type { GradeSplit, ProgramSummary } from "@/features/students/enrolled-composition";
import type { FirstClassStudent } from "@/features/dashboard/day-arrivals";
import type { AbsentDay } from "@/features/dashboard/absent-students";
import type { AdmissionsKind } from "./display";

export type Distribution = { label: string; value: number }[];
export type MonthChange = {
  month: string;
  enrolled: number;
  withdrawn: number;
};
export type CareSummary = {
  total: number;
  stages: import("./student-composition").SubjectDistributionRow[];
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
    /** 재원생 수 — 원생목록과 **같은** count(head · 강사 스코프). */
    enrolled: number;
    subjects: Distribution;
    levels: Distribution;
    schools: Distribution;
    schoolGroups?: import("./student-composition").SchoolGroup[];
    /** 영어(EiE·인재원 영어) + 수학 동시 수강 — `gradeSplit`의 보라 합계와 같은 판정(subjectMixOf). */
    concurrent: number;
    subjectCombinations?: { subjects: string[]; value: number }[];
    /** 프로그램별 재원생(겹침 있음) + 수강 없음 — KPI '재원생' 팝업. */
    programs: ProgramSummary;
    gradeSplit: GradeSplit;
    levelSplit?: import("./student-composition").LevelSubjectSplit;
  };
  changes: MonthChange[];
  /** KPI '퇴원생' — 이번 달 1일 ~ 오늘(KST) 퇴원, 시스템 정리 제외. 프로그램 = 마지막 수강 반. */
  withdrawals: {
    month: string;
    rows: {
      id: string;
      name: string;
      schoolGrade: string | null;
      withdrawnAt: string;
      program: Program | null;
    }[];
  };
  /** KPI '신규문의' — 오늘(KST) 접수된 콜&상담. time = 접수 시각(KST HH:MM). */
  intake: { id: string; name: string; time: string | null }[];
  /** KPI '오늘첫수업' — 첫 등원 + 새 과목 첫 수업. */
  firstClass: FirstClassStudent[];
  /**
   * KPI '보강예정'(원장 2026-09-14) — **오늘부터 한 달**(원장 2026-09-16, `monthAheadWindow`) 예약 상태의 보강(0264a)
   * + 지난 60일 미이행(`overdue`). 카드 = 팝업(같은 `rows`). `range` = 서버가 센 창 · `later` = 창 뒤 예약 수(보조 줄).
   */
  makeup: import("@/features/dashboard/server/makeup-upcoming").UpcomingMakeupOverview;
  /**
   * KPI '전일 결석' — **어제**(KST, `absentKpiDate`) 한 교시도 안 온 학생(결석·공결) + 따로 보이는 '일부 교시 결석'.
   * `date` = 서버가 실제로 조회한 그날 — 카드 보조 줄·팝업 머리·↗가 이 값을 읽어, 화면이 다른 날을 말하는 일이 없게 한다.
   */
  absent: AbsentDay & { date: string };
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
  /** 오늘 수업 — 교시 단위가 아니라 **이어지는 교시를 묶은 한 줄**이다(`continuous-classes.ts`). `id`는 첫 교시 것. */
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
  /** 역할별 인원 + 과목 묶음(영어·수학·둘 다·그 외·없음) — staff-subjects.ts. */
  staff: StaffRow[];
  operations: OperationCount[];
  notices: AnnouncementRow[];
  calendar: {
    id: string;
    /** 일정 원문 제목(구글에서 가져온 그대로). */
    title: string;
    /** 표시용 제목 — 연결된 원생의 정식 이름(동명이인 접미사)으로 바로잡은 것. 없으면 `title`. */
    displayTitle?: string;
    startDate: string;
    endDate: string;
    startTime: string | null;
    source: string;
    /** 입학 일정 종류(단일 분류기 `admissionsEventKind`) — KPI '금일입테'는 levelTest만. */
    kind: AdmissionsKind | null;
    matchedClass?: { id: string; name: string; studentName?: string } | null;
    /** 이 일정의 콜&상담(이름·날짜·번호·학교로 한 건 확정될 때만) — 콜&상담 열람 권한이 있을 때만 싣는다. */
    matchedConsultation?: { id: string; name: string } | null;
  }[];
  /**
   * '상담 진행'(원장 2026-09-22) — 콜&상담 단계별 인원(상담일 기준 최근 30일) · 멈춘 상담(60일) · 상담 id → 지금 단계 칩.
   * 판정은 `consultation-progress.ts` 한 벌(단계 = 칸반과 같은 `stageOfCard`).
   */
  consultProgress: import("./consultation-progress").ConsultProgressData;
  englishSheet: {
    period: string;
    classes: number;
    filled: number;
    total: number;
  };
  mathSheet: { period: string; classes: number; filled: number; total: number };
};
export type Area = keyof OverviewData;
/**
 * 카드 한 칸의 조회 결과. `timedOut`은 **렌더 마감에 걸린 것**이라 실패와 뜻이 다르다 — 쿼리가 깨진 게 아니라
 * 느린 것이고, 화면은 그 차이를 문구로 말한다(`deadline.ts`).
 */
export type Section<T> = { data: T | null; at: number | null; error: boolean; timedOut?: boolean };
export type Sections = { [K in Area]?: Section<OverviewData[K]> };
export type OverviewSnapshot = {
  scope: string;
  tenantId: string;
  academy: string;
  today: string;
  requestedAt: number;
  allowed: MenuKey[];
  subjects: Record<string, string>;
  /** EiE 구분을 **쓰지 않는** 학원이면 false(EiE 모듈 꺼짐 — 새 학원 기본). 없으면 씀(침산 — 키 자체가 없어 스냅샷이 종전과 같다). */
  eie?: false;
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
      // 실패 사유(시간 초과)는 **현재 것**을 싣는다 — 옛 값의 사유를 물려받으면 문구가 거짓이 된다.
      Object.assign(sections, { [key]: { ...old, error: true, timedOut: current.timedOut } });
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
