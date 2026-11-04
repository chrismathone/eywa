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
import type { Program } from "@/features/students/enrollment/program";
import type { GradeSplit, ProgramSummary } from "@/features/students/enrollment/enrolled-composition";
import type { FirstClassStudent } from "@/features/dashboard/day-arrivals";
import type { RecentAbsences } from "@/features/dashboard/recent-absences";
import type { AdmissionsKind } from "./display";

export type Distribution = { label: string; value: number }[];
export type MonthChange = {
  month: string;
  enrolled: number;
  withdrawn: number;
  /** 그달 등록 칸이 **수업을 시작한 등록만** 셌나(원장 2026-10-20 — 청구가 덮은 달부터 · 판정 재료가 없으면 표식도 없다). */
  startedOnly?: boolean;
};

/**
 * 등록 칸 안내 — '수업을 시작한 등록만' 판정이 걸린 달이 있을 때만(판정 재료가 실패했거나 청구가 덮기 전 달뿐이면 말하지 않는다 —
 * 적대 리뷰 2026-10-20: 안내가 늘 붙어 있으면 거짓이 되는 때가 있다). 보이는 달 중 일부만 걸렸으면 그 달부터라고 적는다.
 */
export function startedNote(rows: readonly { month: string; startedOnly?: boolean }[]): string | null {
  const first = rows.find((r) => r.startedOnly)?.month;
  if (!first) return null;
  return rows[0]!.startedOnly ? "등록은 수업을 시작한 학생만" : `등록은 ${first.slice(0, 4)}년 ${Number(first.slice(5, 7))}월부터 수업을 시작한 학생만`;
}
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
/** KPI '퇴원&수업종료' 한 줄(퇴원 한 명 또는 과목 수강종료 한 건). */
export type WithdrawalKpiRow = {
  id: string;
  /** 같은 학생이 여러 과목을 종료하면 목록에는 과목마다 한 줄. */
  eventKey?: string;
  name: string;
  schoolGrade: string | null;
  /** 처리한 날(퇴원일·과목 종료일) — 보이는 날짜. 어느 달로 세는지는 수업료 기준(`exit-month.ts`). */
  withdrawnAt: string;
  program: Program | null;
  subject?: string | null;
  kind?: "withdrawn" | "subject-ended";
  className?: string;
};
export type OverviewData = {
  teacherWork: import("./teacher-work").TeacherWork;
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
    /** 과목 막대에 선 학생(중복 없이) — 막대 합과의 차 = 두 과목 이상 듣는 학생이 더 선 몫(과목별 수강 각주 · 옛 스냅샷엔 없다). */
    subjectStudents?: number;
    /** 프로그램별 재원생(겹침 있음) + 수강 없음 — KPI '재원생' 팝업. */
    programs: ProgramSummary;
    gradeSplit: GradeSplit;
    levelSplit?: import("./student-composition").LevelSubjectSplit;
    /**
     * 과목 관리자 화면에서 '(학원 전체)'로 서는 구성 카드(재원생 구성·학년별·학교별)용 **학원 전체** 재원생·미수강 —
     * 위 `enrolled`·`programs`는 담당 과목으로 좁혀져 있어, 학원 전체 막대 옆에 그 값을 쓰면 숫자가 섞인다(narrow.ts).
     */
    academy?: { enrolled: number; noEnrollment: number };
  };
  changes: MonthChange[];
  /** 재원생 추이(월말·연말 재원생 수, 원장 2026-09-29) — 강사 스코프면 null(지금 담당 학생으로 과거를 셀 수 없다). */
  enrolledTrend: import("./enrolled-trend-server").EnrolledTrend | null;
  /**
   * 상단 '강좌수'(원장 2026-10-20 *"대시보드에 강좌수도 볼 수 있으면 좋을듯"* — 상단 칸 추가) — 재원생의 수강을 학생·과목마다 한 번
   * (`summarizeCourses` · '재원생' 칸과 같은 조회·같은 줄 판정 → 오늘 값 = 원생 통계 '강좌수 추이' 오늘 점).
   */
  courses: import("@/features/students/enrollment/course-count").CourseSummary;
  /** '강좌수 추이' 카드(원장 같은 날 '카드 따로') — 재원생 추이와 같은 원본·날짜·시작 달(`loadEnrolledTrend().courses`) · 강사 스코프면 null. */
  courseTrend: import("./course-history").CourseTrendWithHistory | null;
  /**
   * 보여 줄 달(`month` = `exitReportMonth` — 1~10일은 지난달, 11일부터 이번 달)로 **센** 퇴원 또는 과목 전체 수업종료(수업료를 낸 마지막 달 기준 —
   * `exit-month.ts`). 과목별 종료 건수이며 반이동·특강 종료·시스템 정리 제외.
   * `carried` = 그 달(1일 ~ min(말일, 오늘))에 마지막 수업을 했지만 앞 달까지만 내 앞 달로 센 줄 — 숫자엔 들지 않고 팝업이 따로 밝힌다(원장 2026-11-03 *"오해 소지가
   * 없도록"*). `countMonth` = 센 달. 옛 저장본엔 없다(선택 칸).
   */
  withdrawals: {
    month: string;
    rows: WithdrawalKpiRow[];
    carried?: (WithdrawalKpiRow & { countMonth: string })[];
  };
  /**
   * '등록 후 3개월 내 퇴원'(원장 2026-10-15) — 이번 달 1일 ~ 오늘(KST) 퇴원한 학생 **전부**와 등록일부터 며칠 만인지(`days`,
   * 판정 못 하면 null — `early-exit.ts`). KPI '퇴원&수업종료'가 읽는 퇴원 행과 같은 조회(시스템 정리·병합 제외) · 창은 달력 이번 달(KPI는 1~10일에 지난달). 카드가 30·60·90일로 다시 센다 —
   * 퇴원관리 `?type=withdrawn&range=month&early=3m`와 같은 수다(과목 관리자 화면은 담당 과목으로 좁힌 수 — 카드가 밝힌다). `subjects` = 퇴원 무렵 끝난 과목(과목 관리자 좁히기).
   * 인원은 달로 끊는다(원장 2026-09-28) — 월초에 0만 보이지 않게 지난 달들도 **달마다** 센다(`history`, 등록·퇴원 추이와 같은 6개월 조회).
   */
  earlyExits: {
    month: string;
    /** 달 칸(오래된 달 → 이번 달) — 등록·퇴원 추이와 같은 6개월(`monthKeys`). */
    months: string[];
    rows: {
      id: string;
      name: string;
      schoolGrade: string | null;
      enrolledAt: string | null;
      withdrawnAt: string;
      days: number | null;
      subjects: string[];
    }[];
    /** 이번 달 전 달들의 퇴원 — 이름 없이 퇴원 달·일수·과목만(달마다 세는 재료). */
    history: { month: string; days: number | null; subjects: string[] }[];
  };
  /** KPI '신규문의' — 오늘(KST) 접수된 콜&상담. time = 접수 시각(KST HH:MM). */
  intake: { id: string; name: string; time: string | null }[];
  /**
   * KPI '전일 / 이달 신규'(옛 '금일 등록', 원장 2026-10-21) — 어제·이번 달(KST) 콜&상담 상태를 '등록 완료'로 옮긴 상담
   * (지금도 등록 완료인 것만). `assigned` = 칸반 '반 배정 완료'와 같은 판정. 카드 = 팝업(같은 배열) — `getEnrolledRecent`,
   * 가르기 = `splitEnrolledRecent`. 키 이름은 저장된 배치(`kpi:enrolledToday`) 때문에 그대로다.
   */
  enrolledToday: import("@/features/dashboard/server/enrolled-today").EnrolledTodayRow[];
  /** KPI '오늘첫수업' — 첫 등원 + 새 과목 첫 수업. */
  firstClass: FirstClassStudent[];
  /**
   * KPI '보강예정'(원장 2026-09-14) — **오늘부터 한 달**(원장 2026-09-16, `monthAheadWindow`) 예약 상태의 보강(0264a)
   * + 지난 60일 미이행(`overdue`). 카드 = 팝업(같은 `rows`). `range` = 서버가 센 창 · `later` = 창 뒤 예약 수(보조 줄).
   */
  makeup: import("@/features/dashboard/server/makeup-upcoming").UpcomingMakeupOverview;
  /**
   * KPI '최근 결석' — **어제까지 7일**(KST, `recentAbsenceRange`) 결석을 학생별로(누적 많은 순) · 결석마다 그 수업 담당.
   * `from/to` = 서버가 실제로 센 창 — 카드 보조 줄·팝업 머리가 이 값을 읽어 화면이 다른 기간을 말하지 않게 한다.
   */
  absent: RecentAbsences;
  attendance: AttendanceSnapshot | null;
  processing: ClassProcessing[];
  /**
   * 오늘이 **학원설정 휴원일**일 때만 값이 있다(평일은 null) — 2026-10-03.
   * 휴원일엔 `processing`이 빈 목록이라(예정 분모를 만들지 않는다) 출결 카드가 "미처리 0건 · 입력 중 0반"과 빈 막대를 그렸다.
   * 그 자리에 휴일 이름과 **실제로 입력된 것**(학생 수·반 수·보강 예약 건수)만 적는다 — 분모·완료율 없음.
   * `counts: null` = 입력 현황 조회 실패(0명으로 접지 않는다). 숫자만 싣는다(이름·목록은 내려보내지 않는다).
   */
  holidayAttendance: {
    name: string;
    counts: import("@/features/attendance/holiday-activity").HolidayActivityCounts | null;
  } | null;
  attendanceTrend: { date: string; rate: number | null; total: number }[];
  /** 달마다 수납 요약 — 과목 관리자 값에는 과목으로 못 가른 금액(`unclassified`)이 따로 실린다(`billing-subject.ts`). */
  billing: import("./billing-subject").SubjectBillingSummary[];
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
    /** 입학 일정 종류(단일 분류기 `admissionsEventKind`) — KPI '전일 입테'는 levelTest만. */
    kind: AdmissionsKind | null;
    /**
     * 취소된 일정(제목에 '취소', `isCancelledEventTitle`)의 원래 종류 — 이 값이 있으면 `kind`는 null이다.
     * 목록엔 취소선으로 남고(원장 2026-09-30) 건수·링크엔 안 든다. 옛 스냅샷엔 없다(= 취소 줄 없음).
     */
    cancelledKind?: AdmissionsKind | null;
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
  /**
   * 이 사람이 보는 배치(역할 묶음별) — 서버가 정한다. 없으면(옛 스냅샷·테스트) 지금 운영실 그대로의 기본 배치.
   * 갱신 스냅샷에도 실려 와서 설정에서 배치를 바꾸면 다음 갱신에 화면이 따라온다(scope에 배치 판이 섞여 있다).
   */
  view?: import("@/features/dashboard/layout/view").ResolvedView;
  /** 강사 범위(강사·강사뷰)로 센 화면 — 원생 통계처럼 강사에게 안 보이는 상세 대신 종전 목록으로 보낸다(없음 = 학원 범위). */
  teacherView?: true;
  sections: Sections;
  /** 과목별 값 표 — **미리보기 원본(`loadOverview({ full })`)에만** 있다. 편집기가 과목 관리자 배치를 그 과목 값으로 그린다. */
  slices?: import("@/features/dashboard/layout/slices").SliceTable;
  /** 학원 설정의 과목(키) — 미리보기 원본에만. `subjects`엔 옛 표시용 라벨이 섞여 있어 과목 판정은 이것으로 거른다(서버와 같은 목록). */
  sliceSubjectKeys?: string[];
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
  /** 몇 달 — 운영실 카드는 6, 원생 통계 화면은 더 길게(같은 판정 한 벌). */
  count = 6,
): MonthChange[] {
  return monthKeys(today, count).map((month) => ({
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
