/**
 * 직원 포트폴리오 — 월간 점수 계산의 입력(스냅샷)과 결과(강사 × 월).
 *
 * 입력은 DB 행 모양 그대로다(snake_case). 계산은 순수 함수라서 화면·cron·테스트가 같은 값을 낸다.
 * 결과의 한 달(`PortfolioPeriod`)이 그대로 `teacher_portfolio_months.payload`에 저장된다 — 마감한 달은
 * 점수와 근거를 함께 굳히기 위해서다. 학생은 id로만 싣고 이름은 화면이 읽을 때 붙인다.
 */

export type SnapshotUser = { id: string; display_name: string; status: string; subjects: string[] | null };
export type SnapshotClass = {
  id: string; class_name: string; subject: string; english_track: string | null; teacher_id: string | null;
  is_active: boolean; closed_at: string | null; report_optout: boolean | null; is_makeup_pool: boolean | null;
};
export type SnapshotSchedule = {
  id: string; class_id: string; day_of_week: string; start_time: string; end_time: string | null;
  teacher_id: string | null; slot_teacher_label: string | null; lab_separate: boolean | null;
  valid_from: string; valid_to: string | null;
};
export type SnapshotEnrollment = {
  id: string; student_id: string; class_id: string; start_date: string; end_date: string | null;
  on_hold: boolean; attendance_days: string[] | null; is_transferred: boolean; is_transferred_in: boolean;
};
export type SnapshotAttendance = {
  id: string; class_id: string; student_id: string; session_date: string; slot_start: string | null;
  status: string; recorded_at: string; supersedes_id: string | null; seat_label: string | null;
  recorded_via: string | null; taught_by: string | null; note: string | null;
};
export type SnapshotReport = {
  id: string; student_id: string; class_id: string | null; report_date: string; created_by: string | null;
  created_at: string | null; covers_date: string | null; makeup: boolean | null;
};
export type SnapshotConsultation = {
  id: string; student_id: string; counselor_id: string | null; follow_up_date: string | null;
  follow_up_done: boolean | null; consulted_at: string; updated_at: string | null;
};
export type SnapshotReviewSheet = { scores?: unknown; submittedAt?: string | null; completedAt?: string | null; byId?: string | null };
export type SnapshotReview = {
  id: string; staff_user_id: string | null; header: { teacherId?: string | null } | null; areas: unknown;
  template_name: string | null; submissions: Record<string, SnapshotReviewSheet>;
};
export type SnapshotTransition = {
  class_id: string | null; target_label: string | null; teacher_id: string; previous_teacher_id: string | null; date: string;
};
export type SnapshotDelegation = { class_id: string; delegate_user_id: string; from_date: string; to_date: string };
export type SnapshotInvoice = {
  id: string; student_id: string; period: string; amount_total: number | string; amount_discount: number | string | null;
  line_items: unknown;
};
export type SnapshotTerm = {
  id: string; invoice_id: string; class_id: string; amount: number | string | null; confirmed_sessions: number | string | null;
  allocation_line_index: number | null; allocation_amount: number | string | null; allocation_source: unknown;
  allocation_base_amount: number | string | null;
};
export type SnapshotMakeup = {
  id: string; student_id: string; class_id: string; absence_date: string | null; makeup_date: string | null;
  status: string; done_at: string | null;
};

/** 기록을 시작하기 전에 끝난 달의 처리. 항목마다 시작일과 기준 달을 따로 갖는다. */
export type PreRecordItem = { before: string; reference: string[] };
export type PreRecordPolicy = Partial<Record<"report" | "attendance", PreRecordItem>>;

export type PortfolioSnapshot = {
  tenant: { id: string; name: string };
  /** 조회 시각(ISO). 진행 중인 달의 입력 인정 시각이다. */
  capturedAt: string;
  /** 가장 오래된 달의 1일 · 수업 대상 마지막 날(한국 시간 어제). */
  from: string;
  end: string;
  settings: {
    holidays: { date: string }[];
    subjects: { key: string; label: string }[];
    report_subjects: string[];
    report_exempt: string[];
  };
  preRecord: PreRecordPolicy | null;
  users: SnapshotUser[];
  classes: SnapshotClass[];
  schedules: SnapshotSchedule[];
  enrollments: SnapshotEnrollment[];
  attendance: SnapshotAttendance[];
  reports: SnapshotReport[];
  consultations: SnapshotConsultation[];
  reviews: SnapshotReview[];
  transitions: SnapshotTransition[];
  delegations: SnapshotDelegation[];
  invoices: SnapshotInvoice[];
  terms: SnapshotTerm[];
  makeupLegacy: SnapshotMakeup[];
};

export type MetricId = "report" | "attendance" | "follow" | "quality" | "students" | "revenue" | "expansion" | "coverage";
export const METRIC_IDS: readonly MetricId[] = ["report", "attendance", "follow", "quality", "students", "revenue", "expansion", "coverage"];
export const METRIC_MAX: Record<MetricId, number> = {
  report: 20, attendance: 10, follow: 10, quality: 10, students: 20, revenue: 10, expansion: 10, coverage: 10,
};

export type PeriodWindow = { month: string; start: string; end: string; partial: boolean };

export type ReportState = "own" | "proxy" | "missing" | "late" | "unknown";
export type ReportCell = { day: string; studentId: string; className: string; state: ReportState };
export type AttendanceRow = { day: string; studentId: string; className: string; done: boolean; ambiguous: boolean };
export type FollowState = "후속 대상 아님" | "마감 시점 확인" | "완료" | "미완료";
export type FollowRow = { studentId: string; day: string | null; due: string | null; scored: boolean; state: FollowState };
export type QualityRow = { date: string | null; name: string; average: number };

export type StudentEventType =
  | "신규" | "퇴원" | "수강종료" | "반이동 유입" | "반이동 유출" | "같은 강사 내 반이동" | "담당 변경" | "추가 수강" | "재등록";
export type StudentEvent = {
  studentId: string; day: string; type: StudentEventType; points: number; direction: "유입" | "유출";
  className: string; role: string;
};
export type StudentTracking = {
  value: number; basePoints: number; adjustment: number; previousPoints: number; previous: number; current: number;
  change: number; newCount: number; exitCount: number; endedCount: number; transferIn: number; transferOut: number;
  unscored: number; homeroom: number; assistant: number; detail: StudentEvent[];
};

export type RevenueSubject = { key: string; label: string; amount: number; total: number; unassigned: number };
export type RevenueClassRow = { className: string; amount: number };
export type RevenueResult = {
  value: number; amount: number; subjectTotal: number; subjectLabel: string; subjects: RevenueSubject[];
  unassigned: number; unclassified: number; detail: RevenueClassRow[];
};

export type CoverageState = "기한 전 완료" | "기한 내 대기" | "인정" | "기한 초과" | "연결 확인 필요" | "미완료";
export type CoverageRow = {
  studentId: string; className: string; absence: string; deadline: string; makeup: string | null;
  evidence: string; state: CoverageState; scored: boolean;
};
export type CoverageResult = {
  value: number; due: number; done: number; pending: number; early: number; unconfirmed: number; detail: CoverageRow[];
};

/** 기록 시작 전이라 기준 달 평균으로 둔 항목에 붙는다. `detail`은 비운다 — 없는 기록을 만들지 않는다. */
export type Estimated = { since: string; targets: number; reference: { month: string; value: number }[] };

type MetricCommon<Id extends MetricId, Detail> = {
  id: Id; max: number; value: number | null; basis: string; reason: string; detail: Detail[];
  gap?: string; estimated?: Estimated;
};
export type ReportMetric = MetricCommon<"report", ReportCell>;
export type AttendanceMetric = MetricCommon<"attendance", AttendanceRow>;
export type FollowMetric = MetricCommon<"follow", FollowRow>;
export type QualityMetric = MetricCommon<"quality", QualityRow>;
export type StudentsMetric = MetricCommon<"students", StudentEvent> & { tracking: StudentTracking };
export type RevenueMetric = MetricCommon<"revenue", RevenueClassRow> & Pick<RevenueResult, "amount" | "subjectTotal" | "subjectLabel" | "subjects" | "unassigned" | "unclassified">;
export type ExpansionMetric = MetricCommon<"expansion", never>;
export type CoverageMetric = MetricCommon<"coverage", CoverageRow> & Pick<CoverageResult, "due" | "done" | "pending" | "early">;
export type Metric =
  | ReportMetric | AttendanceMetric | FollowMetric | QualityMetric | StudentsMetric | RevenueMetric | ExpansionMetric | CoverageMetric;
export type MetricOf<Id extends MetricId> = Extract<Metric, { id: Id }>;

export type DayStat = { day: string; holiday: boolean; target: number; own: number; proxy: number; missing: number; late: number };

export type PortfolioPeriod = PeriodWindow & {
  subjects: string[];
  classes: string[];
  students: number;
  items: Metric[];
  knownCount: number;
  knownScore: number;
  knownMax: number;
  /** 8개 항목이 모두 산출됐을 때만 합계. 하나라도 산출불가면 null — 100점으로 다시 환산하지 않는다. */
  total: number | null;
  ownReportRecords: number;
  holidays: string[];
  dayStats: DayStat[];
};

/** 저장된 한 달의 마감 상태. 'reconstructed' = 달이 끝나고 한참 뒤 남은 기록으로 다시 만든 마감. */
export type ClosingSource = "month_end" | "reconstructed";
export type PeriodClosing = { closedAt: string | null; source: ClosingSource | null; computedAt: string };
export type StoredPeriod = PortfolioPeriod & { closing: PeriodClosing };

export type PortfolioTeacher = { id: string; name: string; subjects: string[]; periods: PortfolioPeriod[] };
export type PortfolioResult = {
  tenant: string;
  capturedAt: string;
  from: string;
  end: string;
  teachers: PortfolioTeacher[];
  subjectOrder: string[];
  /** 화면에 보이는 6개월(최신 → 과거). 강사의 `periods`는 전월 비교용 한 달이 더 있다. */
  months: PeriodWindow[];
  preRecord: PreRecordPolicy | null;
};

export function metricOf<Id extends MetricId>(period: Pick<PortfolioPeriod, "items">, id: Id): MetricOf<Id> {
  return period.items.find((m) => m.id === id) as MetricOf<Id>;
}
