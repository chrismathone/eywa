/**
 * 의무 장부(duty_items, s2_0043) — 종류·주기·문구의 한 곳(클라·서버 공용 · server-only 없음).
 *
 * 한 행 = 학생(또는 반) × 종류 × 회차의 **해야 할 일**. 생성기가 분모를 미리 적고, 원 표의 사실로 닫힌다(사람이 누르는 버튼 아님 —
 * 할 일 0377a와 같은 원칙). 운영실 '강사별 업무 현황'·직원 포트폴리오와 **같은 판정 함수**를 써서 숫자가 어긋나지 않는다.
 * 🔴 새 종류를 더하면: 여기 한 줄 · 생성기(`model/*.ts`)에 분모·완료 판정 · SQL `duties_private.kind_label`(할 일 제목) 한 줄.
 */
export type DutyPeriod = "daily" | "weekly" | "monthly" | "case";
export type DutyStatus = "open" | "done" | "void";
/** 화면 상태 — 열린 것 중 기한(due_at)이 지난 것이 '늦음'. */
export type DutyState = DutyStatus | "late";

export type DutyKindInfo = { label: string; period: DutyPeriod; doneRule: string };

export const DUTY_KINDS = {
  attendance: { label: "출결 입력", period: "daily", doneRule: "그 반 그날 그 학생의 출결 기록이 생기면 완료. 기한은 그날 그 반 수업이 끝나는 시각(넘겨 찍으면 기한 후 완료)." },
  report_write: { label: "수업보고서 작성", period: "daily", doneRule: "그날 그 학생의 수업보고서(또는 그날을 대신하는 보고서)가 있으면 완료. 결석이면 대상에서 빠진다. 기한은 수업이 끝난 뒤 24시간." },
  report_send: { label: "보고서 발송", period: "daily", doneRule: "그날 수업한 학생의 보고서가 학부모에게 실제로 나가면(발송 성공 · 영어는 반 알림장 게시) 완료. 써 놓고 보내지 않은 것은 미완료다. 결석 · 회수면 의무에서 빠진다(발송 기한을 넘겨 못 나간 것은 미이행). 기한은 수업이 끝난 뒤 24시간(넘겨 보내면 기한 후 완료)." },
  counsel_monthly: { label: "학생 상담", period: "monthly", doneRule: "상담 의무 학생(같은 과목에서 가장 많은 요일을 맡은 담임 · 영어는 반 담임 전원 — 강사평가·원생상담 통계와 같은 판정)마다 그 달 본인이 상담을 1건 이상 기록하면 완료. 기한은 말일." },
  exam_monthly: { label: "월말평가", period: "monthly", doneRule: "그 달 담임 반 명단 학생마다 그 달 그 과목 월말평가 기록(성적관리 · 응시)이 있으면 완료(강사평가 월말평가 응시율과 같은 판정). 학원이 그 달이나 지난달에 월말평가를 친 과목만. 기한은 말일." },
  newcomer_call: { label: "신규생 관리", period: "case", doneRule: "신규생 관리 체크리스트(사전 콜 · 첫 수업 안내 · OJT · 첫 수업 후 콜 · 1개월 콜 · 3개월 콜)의 항목을 체크하면 완료. 기한은 그 항목의 날(등록일·첫 수업일 기준). 담당 = 그 학생의 상담 의무 담임." },
} as const satisfies Record<string, DutyKindInfo>;

export type DutyKind = keyof typeof DUTY_KINDS;
export const DUTY_KIND_KEYS = Object.keys(DUTY_KINDS) as DutyKind[];

export function dutyKindLabel(kind: string): string {
  return (DUTY_KINDS as Record<string, DutyKindInfo>)[kind]?.label ?? kind;
}

export function dutyState(status: DutyStatus, dueAt: string, now: number = Date.now()): DutyState {
  if (status !== "open") return status;
  return Date.parse(dueAt) < now ? "late" : "open";
}

/** 화면 이름 — 원장 2026-11-09 *"아직 → 미완료"*. */
export const DUTY_STATE_LABEL: Record<DutyState, string> = { open: "미완료", late: "기한 초과", done: "완료", void: "해당 없음" };

/** 할 일(staff_tasks) 종류 — 늦은 의무 묶음(담당자 × 종류 × 회차)마다 하나(`duty_escalate`). */
export const DUTY_LATE_TASK_KIND = "duty_late";

/** 화면에 내려가는 의무 한 건(강사 홈 '내 업무' 목록). */
export type DutyItemView = {
  id: string; kind: DutyKind | string; period: DutyPeriod; cycle: string; status: DutyStatus; dueAt: string; doneAt: string | null;
  /** void일 때 까닭(absent · not_due · expired · rekeyed …) — 화면이 "결석"처럼 사람 말로 적는다. */
  voidReason: string | null;
  studentId: string | null; studentName: string | null; school: string | null; grade: string | null;
  classId: string | null; className: string | null; subject: string | null;
  escalation: number;
};

/** 신규생 콜 회차(항목 키) → 화면 이름 — `ONBOARDING_ITEMS`와 같은 글자(클라에서 그 모듈을 다시 묶지 않으려 여기 둔다). */
export const NEWCOMER_ITEM_LABEL: Record<string, string> = {
  pre_call: "수업 전 사전 콜", first_class_guide: "첫 수업 안내", ojt: "신입생 OJT", after_first_call: "첫 수업 후 콜", month1_call: "1개월 콜", month2_call: "2개월 콜", month3_call: "3개월 콜",
};
