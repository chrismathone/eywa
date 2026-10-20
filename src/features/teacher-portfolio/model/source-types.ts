/**
 * 강사평가 지표 셋(성적 관리 · 학부모 만족도 · 강사 근태)의 입력·근거 모양 — `types.ts`가 다시 내보낸다.
 * 스냅샷의 `sources`에 함께 실린다. 표가 아직 없는 DB(0364a·0365a 적용 전)에선 그 칸이 null이다(#95 — 그 지표는 '계산 전'·직접 입력만).
 */
import type { UnifiedKind } from "@/features/grades/unified/model";

/** 세는 시험 종류 — 성적관리 통합 원장의 갈래에서 입학(레벨) 테스트를 뺀 것. 차례 = 화면 차례. */
export const GRADE_KINDS = ["daily", "check", "monthly", "school", "other"] as const satisfies readonly UnifiedKind[];
export type GradeKind = (typeof GRADE_KINDS)[number];
/**
 * 시험 한 건 — 성적 입력(`student_grades`) 또는 수업보고서의 일일·확인테스트. 점수가 있는 것만(스냅샷이 거른다).
 * `entered` = 입력한 날(한국 날짜) — 마감한 달은 그 달 말일까지 입력된 것만 센다. 모르면 null.
 */
export type SnapshotGrade = {
  id: string; student_id: string; subject: string; class_id: string | null; day: string; entered: string | null;
  kind: GradeKind; score: number; max: number;
};
/**
 * 성적 근거 한 줄 = 학생 한 명 — `daily` = 일일테스트 제출 칸/대상 칸 · `monthly` = 월말평가 응시(대상이 아니면 없다) ·
 * `tests`·`average`·`kinds` = 점수율로 재는 시험(확인테스트·내신·기타)의 수·평균·종류별 건수(없으면 average null).
 * 2026-10-15 전에 저장된 달은 daily·monthly가 없고 average·kinds가 모든 시험의 값이다(화면이 둘 다 읽는다).
 */
export type GradeRow = {
  studentId: string; className: string; tests: number; average: number | null; kinds: string;
  daily?: { done: number; total: number }; monthly?: boolean;
  /** 점수율 시험의 종류별 시험 수·평균(%) — 내역의 시험 종류 탭(원장 2026-10-16). 그 전에 저장된 달엔 없다(`kinds` 글자로 대신 센다). */
  byKind?: Partial<Record<GradeKind, { count: number; average: number }>>;
};
/** 종류별 셈 — 일일테스트 = 제출률 · 월말평가 = 응시율 · 나머지 = 점수율(원장 2026-10-15). */
export type GradeMeasure = "submit" | "take" | "score";
/**
 * 종류별 값(`average`, %) — 제출·응시는 `done`/`count`(칸·학생), 점수율은 `count` = 시험 수. 비중은 그 달 설정의 값.
 * 2026-10-15 전에 저장된 달은 `measure`가 없다(전부 점수율).
 */
export type GradeKindStat = { kind: GradeKind; count: number; average: number; weight: number; measure?: GradeMeasure; done?: number };

/**
 * 매출 대비 급여 근거의 반 한 줄(원장 2026-10-15 — 금액 없이 비중만) — `share` = 그 달 맞춘 매출 중 이 반 몫(%, 맞춘 줄이 없으면 null) ·
 * `rows` = 청구서가 있는 학생 줄 · `billed` = 그중 청구서 항목을 이 반에 맞춘 줄. 2026-10-15 전에 저장된 달엔 없다(빈 목록).
 */
export type PayClassRow = { className: string; students: number; rows: number; billed: number; share: number | null };

/** 학부모 글 판정(0364a) — 반영·확인 대기만 싣는다. 본문은 싣지 않는다(근거 문구만). */
export type SnapshotJudgment = {
  id: string; student_id: string | null; posted_on: string; class_id: string | null; subjects: string[];
  verdict: "plus" | "minus" | null; phrase: string | null; method: "rule" | "ai" | "manual"; state: "applied" | "pending";
};
/** 원장이 넣은 클레임·칭찬(0364a) — 취소한 것은 빼고 싣는다. */
export type SnapshotClaim = { id: string; teacher_id: string; student_id: string | null; occurred_on: string; points: number; content: string };
/** 만족도 근거 한 줄 — 학부모 글 판정 또는 클레임. 확인 대기는 점수가 없다(반영 전). */
export type SatisfactionRow = {
  key: string; source: "글" | "클레임"; day: string; studentId: string | null; points: number | null; text: string | null; how: string; waiting: boolean;
  /** 글이 이 선생님에게 온 반(그날 그 반 담임 — `attribution.ts`). 2026-10-16 전에 저장한 줄엔 없다. */
  className?: string;
  /** 같은 글을 함께 받는 다른 선생님(판정 줄은 하나라 반영·취소가 함께 움직인다). 없으면 생략. */
  sharedWith?: string[];
};

/** 직원 출퇴근 한 줄(0365a) — 지각·결근 판정은 원본(메이크에듀) 표시 그대로. */
export type SnapshotStaffDay = {
  user_id: string; work_date: string; status: "present" | "late" | "absent" | "leave" | "off"; late_minutes: number | null; check_in_at: string | null;
  /** 옛 스냅샷엔 없다(조퇴를 세지 않는다). */
  check_out_at?: string | null;
};
/** 결재된 휴가(연차·반차·반반차) — 그날의 지각·결근은 세지 않는다(법정 휴가 감점 금지). */
export type SnapshotLeave = { user_id: string; start_date: string; end_date: string };
/**
 * 근태 근거 한 줄 = 지각·결근·조퇴한 날 하나 · 태그는 없지만 그날 직접 쓴 출결·보고서로 출근을 인정한 날(`recorded`, 세지 않는다).
 * `expected` = 그날 기준 시각(지각은 출근 기준 · 조퇴는 퇴근 기준) · `basis` = 기준을 어디서 정했나 · `minutes` = 기준과의 차이(분).
 * 2026-10-15 전에 마감된 달의 줄은 `lateMinutes`만 있다(화면이 둘 다 읽는다).
 */
export type PunctualityRow = {
  day: string; status: "late" | "absent" | "early" | "recorded"; checkIn: string | null; counted: boolean; excuse: string | null;
  checkOut?: string | null; expected?: string | null; basis?: "personal" | "lessons" | null; minutes?: number | null; lateMinutes?: number | null;
};

export type EvaluationSources = {
  grades: SnapshotGrade[];
  /** null = 판정 표(0364a)가 아직 없다. */
  satisfaction: { judgments: SnapshotJudgment[]; claims: SnapshotClaim[] } | null;
  /** days = null이면 출퇴근 표(0365a)가 아직 없다(원장 직접 입력만 쓴다). */
  /** `latest` = 메이크에듀 출퇴근의 가장 늦은 날짜(이 날짜 전날까지는 다 받았다 · 옛 스냅샷엔 없다). */
  punctuality: { days: SnapshotStaffDay[] | null; leaves: SnapshotLeave[]; latest?: string | null };
};
