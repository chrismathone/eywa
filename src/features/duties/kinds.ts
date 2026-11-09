/**
 * 의무 장부(duty_items, s2_0041) — 종류·주기·문구의 한 곳(클라·서버 공용 · server-only 없음).
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
  attendance: { label: "출결 입력", period: "daily", doneRule: "그 반 그날 그 학생의 출결 기록이 생기면 완료. 기한은 당일 자정." },
  report_write: { label: "수업보고서 작성", period: "daily", doneRule: "그날 그 학생의 수업보고서(또는 그날을 대신하는 보고서)가 있으면 완료. 결석이면 의무가 사라진다. 기한은 당일 자정." },
  report_send: { label: "보고서 발송", period: "daily", doneRule: "쓴 보고서가 학부모에게 실제로 나가면(발송 성공) 완료. 회수·발송 기한 지남이면 의무에서 빠진다. 기한은 다음 날 정오." },
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

export const DUTY_STATE_LABEL: Record<DutyState, string> = { open: "아직", late: "기한 초과", done: "완료", void: "해당 없음" };

/** 할 일(staff_tasks) 종류 — 늦은 의무 묶음(담당자 × 종류 × 회차)마다 하나(`duty_escalate`). */
export const DUTY_LATE_TASK_KIND = "duty_late";

/** 화면에 내려가는 의무 한 건(강사 홈 '내 업무' 목록). */
export type DutyItemView = {
  id: string; kind: DutyKind | string; period: DutyPeriod; cycle: string; status: DutyStatus; dueAt: string;
  studentId: string | null; studentName: string | null; classId: string | null; className: string | null; subject: string | null;
  escalation: number;
};
