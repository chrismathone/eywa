/**
 * 직원 포트폴리오 — 월간 점수 계산의 입력(스냅샷, DB 행 모양 그대로)과 결과(강사 × 월). 계산은 순수 함수라 화면·cron·테스트가 같은 값을 낸다.
 * 결과의 한 달(`PortfolioPeriod`)이 그대로 `teacher_portfolio_months.payload`에 저장된다(마감한 달은 점수와 근거를 함께 굳힌다). 학생은 id로만 싣는다.
 */
import type { EvaluationConfig } from "../evaluation/config";
import type { EvaluationSources, GradeKindStat, GradeRow, PayClassRow, PunctualityRow, SatisfactionRow } from "./source-types";
export type { EvaluationSources } from "./source-types";

export type { SnapshotUser, SnapshotClass, SnapshotSchedule, SnapshotEnrollment, SnapshotAttendance, SnapshotReport, SnapshotConsultation, SnapshotReviewSheet, SnapshotReview, SnapshotTransition, SnapshotDelegation, SnapshotInvoice, SnapshotTerm, SnapshotMakeup, SnapshotReferral, SnapshotAttendanceTouch } from "./snapshot-types";
import type { SnapshotUser, SnapshotClass, SnapshotSchedule, SnapshotEnrollment, SnapshotAttendance, SnapshotReport, SnapshotConsultation, SnapshotReview, SnapshotTransition, SnapshotDelegation, SnapshotInvoice, SnapshotTerm, SnapshotMakeup, SnapshotReferral, SnapshotAttendanceTouch } from "./snapshot-types";

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
    subjects: { key: string; label: string; counselAllHomerooms?: boolean }[];
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
  /** activity_log의 담임 변경(2026-11-11) — 감사로그 전이와 합쳐 담임 이력을 만든다(`buildHomeroomOwner`). 옛 스냅숏엔 없다. */
  teacherChanges?: import("./homeroom-history").ActivityTeacherChange[];
  /** 지운 옛 계정 id → 지금 계정 id(같은 사람 — `loadTeacherAliases`). 옛 스냅숏엔 없다. */
  teacherAliases?: Record<string, string>;
  delegations: SnapshotDelegation[];
  invoices: SnapshotInvoice[];
  terms: SnapshotTerm[];
  makeupLegacy: SnapshotMakeup[];
  /** 퇴원율 — 창 끝 다음 한 달 안에 시작하는 수강(월말에 반을 옮긴 학생을 퇴원으로 세지 않게) · 학생의 퇴원 사유(퇴원관리와 같은 곳). */
  futureEnrollments?: SnapshotEnrollment[];
  studentReasons?: { id: string; reason: string | null; withdrawn_at?: string | null }[];
  /** 원생 소개 — 소개한 사람이 이어진 콜&상담 전부(같은 사람 판정에 창 밖 상담도 필요하다). 옛 스냅샷·0362a 전 DB엔 없다. */
  referrals?: SnapshotReferral[];
  /** 출결 입력·수정 기록(활동 기록) — 마감하지 않은 달만 읽는다(`touchesSince`). 없으면 출결 행의 현재 입력자·시각으로만 판정한다. */
  attendanceTouches?: SnapshotAttendanceTouch[];
  /** 성적(성적 입력 + 보고서 시험) · 학부모 글 판정·클레임 · 직원 출퇴근·휴가 — 옛 스냅샷엔 없다(그 지표는 '계산 전'). */
  sources?: EvaluationSources;
};

export type MetricId =
  | "report" | "attendance" | "follow" | "counsel" | "quality" | "students" | "revenue" | "expansion" | "coverage" | "churn" | "payRatio"
  | "grades" | "satisfaction" | "punctuality";
/** 계산 코드가 처음 매기는 만점(옛 고정 배점) — 화면의 만점은 설정이 덮는다. 옛 저장 행의 기준표도 이 값이다. */
export const METRIC_MAX: Record<MetricId, number> = {
  report: 20, attendance: 10, follow: 10, counsel: 10, quality: 10, students: 20, revenue: 10, expansion: 10, coverage: 10,
  payRatio: 20, churn: 20, grades: 10, satisfaction: 0, punctuality: 10,
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
  /** 감점하지 않은 까닭 — 강사 탓이 아닌 사유로 그만둔 퇴원·수강종료(`사유 졸업`). */ note?: string;
};
export type StudentTracking = {
  value: number; basePoints: number; adjustment: number; previousPoints: number; previous: number; current: number;
  change: number; newCount: number; exitCount: number; endedCount: number; transferIn: number; transferOut: number;
  unscored: number; homeroom: number; assistant: number; detail: StudentEvent[];
  /** 강사 탓이 아닌 사유라 감점하지 않은 퇴원·수강종료 수(옛 행엔 없다). */ excused?: number;
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

/**
 * 기록 시작 전이라 기준 달 평균으로 둔 항목에 붙는다. `detail`은 비운다 — 없는 기록을 만들지 않는다.
 * `unit`이 있으면 기준 값은 원래 수치(%)다. 없으면 옛 저장 행이라 점수다.
 */
export type Estimated = { since: string; targets: number; reference: { month: string; value: number }[]; unit?: string };

type MetricCommon<Id extends string, Detail> = {
  /** `value` = 원장 설정으로 매긴 점수 · `max` = 그 지표의 만점(설정). null = 합계에서 뺀 지표. */
  id: Id; max: number; value: number | null; basis: string; reason: string; detail: Detail[];
  gap?: string; estimated?: Estimated;
  /** 원래 수치(설정 단위 — % · 점 · 건). 자료가 없으면 null. 설정을 바꾸면 이 값으로 다시 매긴다. 옛 저장 행엔 없다. */
  raw?: number | null;
  /** 원장이 정한 이름 — 옛 저장 행엔 없어 기본 이름으로 보인다. */
  label?: string;
  /** 원장이 끈 지표 — 미리보기를 위해 저장은 하되 화면·합계엔 없다. */
  off?: boolean;
  /** 자료가 없어 '자료가 없을 때' 규칙(0점·만점·빼기)으로 매겼다. */
  missing?: boolean;
  /** 아직 자동으로 세지 않는 지표(계산이 들어오기 전) — 화면이 '자료 없음'과 갈라 '계산 전'으로 적는다. */
  uncounted?: boolean;
};
export type ReportMetric = MetricCommon<"report", ReportCell>;
export type AttendanceMetric = MetricCommon<"attendance", AttendanceRow>;
export type FollowMetric = MetricCommon<"follow", FollowRow>;
/** 원생상담 — 그 달 담당 학생 한 명 한 줄(상담했는지 · 처음 상담한 날 · 반). */
export type CounselRow = { studentId: string; consulted: boolean; day: string | null; className: string };
export type CounselMetric = MetricCommon<"counsel", CounselRow> & { total: number; consulted: number };
export type QualityMetric = MetricCommon<"quality", QualityRow>;
export type StudentsMetric = MetricCommon<"students", StudentEvent> & { tracking: StudentTracking };
export type RevenueMetric = MetricCommon<"revenue", RevenueClassRow> & Pick<RevenueResult, "amount" | "subjectTotal" | "subjectLabel" | "subjects" | "unassigned" | "unclassified">;
/** 원생 소개 한 건 — 소개받은 사람(상담 이름) · 소개한 원생(id — 이름은 화면이 붙인다) 또는 직원 본인. */
export type ReferralRow = { consultationId: string; day: string; prospect: string; referrerStudentId: string | null; byStaff: boolean; subject: string | null };
export type ExpansionMetric = MetricCommon<"expansion", ReferralRow>;
export type CoverageMetric = MetricCommon<"coverage", CoverageRow> & Pick<CoverageResult, "due" | "done" | "pending" | "early">;
/** 성적 관리 · 학부모 만족도 · 강사 근태(2026-10-15 계산 시작) — 그 전에 저장된 달은 `uncounted` 자리라 아래 칸이 없다. */
export type GradesMetric = MetricCommon<"grades", GradeRow> & { tests?: number; students?: number; kinds?: GradeKindStat[] };
export type SatisfactionMetric = MetricCommon<"satisfaction", SatisfactionRow> & { plus?: number; minus?: number; claims?: number; waiting?: number };
/** `freelancer` = 프리랜서라 근태를 세지 않고 만점(원장 2026-10-16 — 점수는 `evaluate.ts`가 만점으로 매긴다). */
export type PunctualityMetric = MetricCommon<"punctuality", PunctualityRow> & {
  late?: number; absent?: number; early?: number; excused?: number; days?: number; checkIns?: number; checkOuts?: number; manual?: boolean; freelancer?: boolean;
};
/** 퇴원율의 그만둔 학생 한 줄 — 셌는지(counted)와 뺀 까닭(note). */
export type ChurnRow = { studentId: string; day: string; type: "퇴원" | "수강종료"; className: string; reason: string; counted: boolean; note: string | null };
/** base = 지난달 담당 학생(그 달 절반 이상) · need = 절반 일수 · counted = 센 학생 수. */
export type ChurnMetric = MetricCommon<"churn", ChurnRow> & { base: number; need: number; counted: number };
/** 매출 대비 급여 — 비율·출처·학생 수·반 수·반별 비중만(금액 없음). 계산 전 달은 `uncounted`라 출처 칸이 없다. `newcomer` = 지난달 담당 반 없음(합계에서 제외). */
export type PayRatioMetric = MetricCommon<"payRatio", PayClassRow> & {
  source?: string | null; students?: number; classes?: number; enrollments?: number; newcomer?: boolean;
};
/** 원장이 직접 만든 지표 — 달마다 입력한 숫자가 원래 수치다. */
export type ManualMetricItem = MetricCommon<`manual:${string}`, never> & { unit: string; note?: string };
export type Metric =
  | ReportMetric | AttendanceMetric | FollowMetric | QualityMetric | StudentsMetric | RevenueMetric | ExpansionMetric | CoverageMetric
  | ChurnMetric | PayRatioMetric | CounselMetric | GradesMetric | SatisfactionMetric | PunctualityMetric | ManualMetricItem;
/** 한 달의 항목 id — 기본 지표 또는 `manual:<key>`. */
export type ItemId = Metric["id"];
export type MetricOf<Id extends MetricId> = Extract<Metric, { id: Id }>;

export type DayStat = { day: string; holiday: boolean; target: number; own: number; proxy: number; missing: number; late: number };

export type PortfolioPeriod = PeriodWindow & {
  subjects: string[];
  classes: string[];
  students: number;
  items: Metric[];
  /** 합계에 든 항목 수 · 점수 합 · 만점 합(켠 지표의 만점 합 — 100점이 아니어도 된다). */
  knownCount: number;
  knownScore: number;
  knownMax: number;
  /**
   * 총점 = 켠 지표 점수의 합(원장 2026-10-13 — 자료가 없는 항목은 0점이라 총점이 늘 나온다).
   * null은 옛 저장 행(2026-10-13 전 규칙: 하나라도 산출불가면 총점 산출불가)에만 있다.
   */
  total: number | null;
  /** 이 달을 매긴 설정의 사본 — 마감한 달은 그때의 설정으로 굳는다. 옛 저장 행엔 없다. */
  evaluation?: EvaluationConfig;
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
