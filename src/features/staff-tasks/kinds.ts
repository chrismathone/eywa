/**
 * 업무 처리 확인(할 일) — 화면 문구·판정의 한 곳(클라·서버 공용 · server-only 없음).
 *
 * 할 일은 알림과 따로 남는 기록이다(0377a `staff_tasks`). 끝났는지는 원래 기록의 사실로 판정한다 —
 * 직원이 누르는 '처리' 버튼이 아니다(원장 2026-10-19 *"안물어봐도 시스템적으로 체크되도록"*).
 * 🔴 새 종류를 더하면: 0377a처럼 열기·닫기 판정(트리거 + `staff_tasks_sync`) · 여기 `TASK_KINDS` 한 줄 · 그 알림의 task_id 연결.
 */
import type { SemanticTone } from "@/lib/design/semantic-color";

export type StaffTaskStatus = "open" | "done" | "cancelled" | "expired";
/** 화면 상태 — 열린 일 중 기한(due_at)이 지난 것이 '늦음'. */
export type StaffTaskState = "open" | "late" | "done" | "cancelled" | "expired";

export type StaffTaskKindInfo = { label: string; doneRule: string };

/** 종류별 이름 · 무엇이 일어나면 처리로 보나(상세 화면 안내). */
export const TASK_KINDS: Record<string, StaffTaskKindInfo> = {
  report_send_failed: {
    label: "보고서 발송 실패",
    doneRule: "그 보고서가 학부모에게 실제로 나가면 처리됩니다. 재발송 요청만으로는 처리되지 않습니다. 실패한 다음 날까지 못 보내면 늦음입니다.",
  },
  followup_due: {
    label: "상담 후속조치",
    doneRule: "원생상담에서 후속조치 완료를 체크하면 처리됩니다. 기한 날이 지나면 늦음입니다.",
  },
};

export function taskKindLabel(kind: string): string {
  return TASK_KINDS[kind]?.label ?? "할 일";
}

export function taskState(status: string, dueAt: string | null, now: number = Date.now()): StaffTaskState {
  if (status === "done" || status === "cancelled" || status === "expired") return status;
  return dueAt && Date.parse(dueAt) < now ? "late" : "open";
}

export const TASK_STATE_LABEL: Record<StaffTaskState, string> = {
  open: "처리 전",
  late: "늦음",
  done: "처리됨",
  cancelled: "취소됨",
  expired: "기한 지남",
};

/** 상태 칩 색 = 의미색(design-conventions 의미색 캐논) — 처리 전은 '내 할 일', 늦음·기한 지남은 위험, 취소는 종료. */
export const TASK_STATE_TONE: Record<StaffTaskState, SemanticTone> = {
  open: "caution",
  late: "critical",
  done: "positive",
  cancelled: "inert",
  expired: "critical",
};

/** 닫힌 까닭(close_reason) → 사람 말. 모르는 값은 상태 이름만. */
const CLOSE_REASON: Record<string, string> = {
  sent: "학부모에게 발송됨",
  revoked: "보고서 회수",
  recalled: "보고서 회수",
  deleted: "원래 기록이 삭제됨",
  too_old: "재발송 기한이 지남",
  deadline: "재발송 기한이 지남",
  followup_done: "후속조치 완료 체크",
  rescheduled: "기한을 다른 날로 옮김",
  cleared: "후속조치 기한을 지움",
};
export function closeReasonLabel(reason: string | null): string | null {
  return reason ? (CLOSE_REASON[reason] ?? null) : null;
}

/** 이력 한 줄의 사건 이름. */
const EVENT_LABEL: Record<string, string> = {
  opened: "할 일 생김",
  reopened: "다시 열림",
  assigned: "담당 지정",
  retry_requested: "재발송 요청",
  failed_again: "다시 실패",
  done: "처리됨",
  cancelled: "취소됨",
  expired: "기한 지남",
};
export function taskEventLabel(event: string): string {
  return EVENT_LABEL[event] ?? "변경";
}

/** 목록 필터 — 주소·요청 값과 같은 글자. */
export const TASK_FILTERS = ["open", "late", "closed", "all"] as const;
export type StaffTaskFilter = (typeof TASK_FILTERS)[number];
export const TASK_FILTER_LABEL: Record<StaffTaskFilter, string> = { open: "열린 일", late: "늦음", closed: "끝난 일", all: "전체" };
export function parseTaskFilter(raw: unknown): StaffTaskFilter {
  return TASK_FILTERS.includes(raw as StaffTaskFilter) ? (raw as StaffTaskFilter) : "open";
}

export type StaffTaskPerson = { id: string; name: string };
export type StaffTaskItem = {
  id: string;
  kind: string;
  title: string;
  detail: string | null;
  link: string | null;
  status: StaffTaskStatus;
  openedAt: string;
  dueAt: string | null;
  closedAt: string | null;
  closedBy: StaffTaskPerson | null;
  closeReason: string | null;
  assignees: StaffTaskPerson[];
};
export type StaffTaskEvent = { at: string; event: string; actor: StaffTaskPerson | null };
export type StaffTaskList = { items: StaffTaskItem[]; total: number; page: number; pageSize: number };
/** 벨·강사 홈이 받는 내 할 일 요약 · 원장(지정한 사람)이면 현황을 열 수 있다. */
export type StaffTaskSummary = { open: number; late: number; canMonitor: boolean };
/** 벨 줄에 붙는 그 알림의 할 일 상태. */
export type NotificationTaskBadge = { id: string; state: StaffTaskState };
