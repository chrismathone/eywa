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
  enrollment_followup: {
    label: "콜&상담 후속 조치",
    doneRule: "그 상담을 등록 또는 미등록으로 정하면 처리됩니다. 다음 상담 날짜를 옮기면 이 회차는 취소되고 새 날짜에 다시 열립니다. 그 날이 지나면 늦음입니다.",
  },
  progress_anomaly: {
    label: "진도 기록 이상",
    doneRule: "학생 상세 진도 탭에서 그 기록의 '이상 없음'을 누르면 처리됩니다(확인을 되돌리면 다시 열립니다). 생긴 다음 날까지 확인하지 않으면 늦음입니다.",
  },
  attendance_absent_desk: {
    label: "결석 확인 전화",
    doneRule: "오늘 출결의 데스크 확인에서 이 결석의 연락 결과를 '저장'하거나 '해당 없음'을 누르면 처리됩니다. 출석으로 정정되면 취소됩니다. 입력한 다음 날이 되면 늦음, 7일이 지나면 기한 지남입니다.",
  },
  video_upload_check: {
    label: "영상 업로드 확인",
    doneRule: "그 숙제 영상이 실제로 들어오면(올리기 사이트에서 끝까지 올라오거나 영상 제출 현황이 '완료') 처리됩니다. 숙제를 고르지 않고 올리다 멈춘 것은 그 학생이 같은 반에 숙제 없이 다시 올리거나, 같은 파일을 숙제를 골라 다시 올려 끝까지 들어오면 처리됩니다. 숙제를 취소하면 취소, 숙제일(숙제를 안 골랐으면 생긴 날)부터 14일이 지나면 기한 지남입니다. 다음 날까지 안 들어오면 늦음입니다.",
  },
  video_unassigned: {
    label: "미배정 영상",
    doneRule: "영상 제출 현황에서 이 영상을 숙제에 배정하거나 제외하면 처리됩니다. 영상이 아직 안 붙은 숙제가 있을 때만 생기고, 그 숙제가 다른 영상으로 채워지는 등 붙일 숙제가 없어지면 취소됩니다. 영상이 지워져도 취소, 올린 지 14일이 지나면 기한 지남입니다. 다음 날까지 배정하지 않으면 늦음입니다.",
  },
  unsent_report: {
    label: "미발송 수업 보고서",
    doneRule: "그 보고서의 발송을 요청하면 처리됩니다(실제로 나갔는지는 '보고서 발송 실패'가 따로 확인합니다). 회수·삭제하거나 보낼 수 없게 되면 취소, 발송 기한이 지나면 기한 지남입니다. 찾은 날이 끝날 때까지 안 보내면 늦음입니다.",
  },
  approval_turn: {
    label: "전자결재 차례",
    doneRule: "내 결재 차례에서 승인·반려·전결하면 처리됩니다. 후결로 넘겨진 칸은 '후결 확인'을 하면 처리됩니다. 문서가 취소되거나 내 차례가 전결로 생략되면 취소됩니다. 차례가 온 다음 날까지 결재하지 않으면 늦음입니다.",
  },
  withdrawal_step: {
    label: "퇴원보고서",
    doneRule: "작성 차례는 보고서를 제출하면, 승인 차례는 승인하면 처리됩니다. 원장 환불 결정 차례는 퇴원월 뒤 청구에서 환불 승인이나 환불 없음을 정하면 처리됩니다. 보완 요청·취소로 차례가 없어지면 취소됩니다. 작성은 이틀, 승인·환불 결정은 다음 날까지 안 하면 늦음입니다.",
  },
  refund_process: {
    label: "환불 처리",
    doneRule: "퇴원보고서에서 원장이 환불을 승인하며 나를 데스크 담당자로 지정한 일입니다. 환불 요청서에 환불완료일자를 넣고 저장하면 처리됩니다. 요청서를 지우면 취소됩니다. 다음 날까지 처리하지 않으면 늦음입니다.",
  },
  duty_late: {
    label: "업무 기한 초과",
    // 원장 2026-11-10 *"쓸데없는 멘트 제거"* — 한 줄만(가드: 모든 종류는 처리 기준을 가진다).
    doneRule: "그 기록이 생기면 처리됩니다.",
  },
  help_question: {
    label: "도움말 질문",
    doneRule: "질문에 답변이 달리거나 답변 완료·닫힘이 되면 처리됩니다. 질문이 지워지면 취소됩니다. 다음 날까지 답하지 않으면 늦음입니다.",
  },
};

export function taskKindLabel(kind: string): string {
  return TASK_KINDS[kind]?.label ?? "할 일";
}

export function taskState(status: string, dueAt: string | null, now: number = Date.now()): StaffTaskState {
  if (status === "done" || status === "cancelled" || status === "expired") return status;
  return dueAt && Date.parse(dueAt) < now ? "late" : "open";
}

/** 화면 이름 — 억지 고유어 대신 익숙한 한자어(원장 2026-10-30 *"열린일 늦음 끝나일 … 너무 어색해 … 한자어 써도 됨"*). */
export const TASK_STATE_LABEL: Record<StaffTaskState, string> = {
  open: "미처리",
  late: "기한 초과",
  done: "처리 완료",
  cancelled: "취소",
  expired: "기한 만료",
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
  refund_completed: "환불 요청서에 환불완료일자를 넣음",
  rescheduled: "기한을 다른 날로 옮김",
  cleared: "후속조치 기한을 지움",
  anomaly_resolved: "이상 없음으로 확인",
  desk_settled: "데스크가 학부모 확인을 마침",
  not_absent: "결석이 아니게 정정됨",
  stale: "7일이 지나도록 확인하지 않음",
  video_arrived: "영상이 들어옴",
  homework_cancelled: "숙제를 취소함",
  upload_window: "올릴 수 있는 기간이 지남",
  video_removed: "영상이 지워짐",
  video_assigned: "숙제에 배정하거나 제외함",
  unassigned_window: "올린 지 14일이 지남",
  no_open_homework: "붙일 숙제가 없음",
  send_requested: "발송을 요청함",
  not_sendable: "보낼 수 없는 보고서가 됨",
  approval_decided: "결재함",
  document_canceled: "문서가 취소됨",
  turn_skipped: "내 차례가 생략됨",
  withdrawal_acted: "제출하거나 승인함",
  withdrawal_canceled: "퇴원보고서가 취소됨",
  refund_settled: "원장 환불 결정이 끝남(또는 결정할 청구가 없어짐)",
  turn_changed: "차례가 바뀜",
  help_answered: "답변이 달림",
};
export function closeReasonLabel(reason: string | null): string | null {
  return reason ? (CLOSE_REASON[reason] ?? null) : null;
}

/** 이력 한 줄의 사건 이름. */
const EVENT_LABEL: Record<string, string> = {
  opened: "업무요청",
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
export const TASK_FILTER_LABEL: Record<StaffTaskFilter, string> = { open: "미처리", late: "기한 초과", closed: "처리 완료", all: "전체" };
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
/** 알림 줄의 할 일 상태. 묶음 알림(0378a)이면 total = 내가 맡은 연결 할 일 수 · remaining = 그중 아직 열린 것. */
export type NotificationTaskBadge = { id: string; state: StaffTaskState; total?: number; remaining?: number };

/** 묶음의 대표 상태 — 열린 것이 하나라도 있으면 열림(늦은 게 있으면 늦음) · 다 닫혔으면 기한 지남 > 처리됨 > 취소 순. */
export function groupTaskState(states: readonly StaffTaskState[]): StaffTaskState {
  const order: StaffTaskState[] = ["late", "open", "expired", "done", "cancelled"];
  return order.find((s) => states.includes(s)) ?? "cancelled";
}
