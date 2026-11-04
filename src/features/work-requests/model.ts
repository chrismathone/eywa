/**
 * 업무 요청(s2_0018) — 요청 → 담당자 확인·처리 보고 → 관리자 검토 → 마감. 화면 문구·단계 판정의 한 곳(서버·클라 공용 · 순수).
 * 🔴 사람이 보고를 쓰는 것은 이 흐름뿐이다 — 기존 할 일(staff_tasks)은 원래 기록의 사실로 닫힌다(원장 2026-11-02).
 * 학생 연결은 근거일 뿐이고 학생 기록을 바꾸지 않는다.
 */
export const WORK_CATEGORIES = ["general", "weekly", "plan", "training", "handover", "improvement"] as const;
export type WorkCategory = (typeof WORK_CATEGORIES)[number];
export const WORK_CATEGORY_LABEL: Record<WorkCategory, string> = {
  general: "일반", weekly: "주간보고", plan: "기획안", training: "교육", handover: "인수인계", improvement: "개선안",
};

export type WorkStatus = "working" | "review" | "closed" | "cancelled";
export const STATUS_LABEL: Record<WorkStatus, string> = { working: "진행 중", review: "검토 대기", closed: "마감", cancelled: "취소" };
export type StepState = "ready" | "acked" | "reported";
export type WorkOutcome = "done" | "partial" | "blocked";
export const WORK_OUTCOMES: readonly WorkOutcome[] = ["done", "partial", "blocked"];
export const OUTCOME_LABEL: Record<WorkOutcome, string> = { done: "처리함", partial: "일부 처리", blocked: "처리 못 함" };
export type WorkAction = "ack" | "report" | "approve" | "return" | "cancel";
export type EventKind = "created" | "acked" | "reported" | "to_review" | "returned" | "approved" | "cancelled";
export const EVENT_LABEL: Record<EventKind, string> = {
  created: "업무 요청", acked: "확인함", reported: "처리 보고", to_review: "모두 보고 → 검토로", returned: "보완 요청", approved: "승인 · 마감", cancelled: "요청 취소",
};

/** `subjects` = 담당 과목 이름(학원설정 라벨) — 담당자 고르기의 묶음. */
export type WorkPerson = { id: string; name: string; role: string; subjects?: string[] };
/**
 * `returned` = 보완 요청을 받은 적 있음(서버가 채운다) — 담당자에게 내려줄 때 남의 `returnedNote` 글은 비워도 이 표식은 남는다
 * (상태 '보완 중' 판정이 보는 사람마다 달라지지 않게).
 */
export type WorkStep = { user: WorkPerson; state: StepState; ackedAt: string | null; reportedAt: string | null; outcome: WorkOutcome | null; note: string | null; returnedNote: string | null; returned: boolean };
/** 근거 학생 — `assigneeId` = 그 학생을 맡은 담당자(null = 담당 미정 · 근거로만). 같은 학생이 두 담당자에게 있을 수 있다. */
export type WorkLink = { type: "student"; id: string; label: string; assigneeId: string | null };
/** `actorId` = 한 사람의 id(담당자에게 내려줄 때 남의 보고 글을 가린다 — `forAssignee`). */
export type WorkEvent = { at: string; actor: string | null; actorId: string | null; kind: EventKind; note: string | null };
export type WorkItem = {
  id: string; category: WorkCategory; title: string; body: string; criteria: string; source: string | null;
  requester: WorkPerson | null; reviewer: WorkPerson | null; dueOn: string | null; status: WorkStatus;
  reviewNote: string | null; createdAt: string; closedAt: string | null; closedBy: string | null;
  steps: WorkStep[]; links: WorkLink[]; events: WorkEvent[];
};
export type WorkBoard = {
  /** 표가 아직 없으면(SQL 적용 전) false — 구역을 그리지 않는다. */
  enabled: boolean;
  me: string | null;
  canCreate: boolean;
  canMonitor: boolean;
  items: WorkItem[];
  /** 담당자·검토자 고르기(만들 수 있을 때만). */
  staff: WorkPerson[];
};
export const NO_WORK: WorkBoard = { enabled: false, me: null, canCreate: false, canMonitor: false, items: [], staff: [] };

export type WorkDraft = {
  category: WorkCategory; title: string; body: string; criteria: string; dueOn: string | null;
  reviewerId: string | null; assigneeIds: string[]; students: DraftStudent[]; source: string | null;
};
/** 초안의 근거 학생 — 맡을 담당자(`assigneeId`)가 담당자 목록에서 빠지면 담당 미정으로 보인다(다시 고르면 돌아온다). */
export type DraftStudent = { id: string; name: string; assigneeId: string | null };
/**
 * 만들기 창에 미리 넣는 값. `rebody` = 근거 학생의 담당이 바뀌면 내용을 새 묶음으로 다시 짓는다(내용을 직접 고치기 전까지만).
 * `nameOf` = 담당자 제목 이름(`recipientNames` — 서버가 몫을 가를 때와 같은 이름). 함수라 초안(`WorkDraft` — 서버로 보내는 값)에는 넣지 않는다.
 */
export type WorkPrefill = Partial<WorkDraft> & { rebody?: (students: readonly DraftStudent[], nameOf: (id: string) => string | undefined) => string };
/** 학생을 맡은 담당자 — 담당자 목록에서 빠졌으면 담당 미정(null). 근거 학생 묶음 · 내용 다시 짓기 · 저장이 같은 규칙. */
export const assignedTo = (s: Pick<DraftStudent, "assigneeId">, assignees: readonly string[]) => (s.assigneeId && assignees.includes(s.assigneeId) ? s.assigneeId : null);
/**
 * 저장 · 묶음 · 내용 다시 짓기가 함께 쓰는 근거 학생 — 맡을 담당자를 정리하고(`assignedTo`), 같은 학생을 다른 담당자가 이미 맡았으면
 * 그 학생의 담당 미정 줄은 뺀다(이미 근거로 있다 — 두 줄로 두면 직원을 지울 때 연결 표의 유일 조건에 걸린다). 같은 (학생, 담당자)는 하나만.
 */
export function effectiveStudents(students: readonly DraftStudent[], assignees: readonly string[]): DraftStudent[] {
  const mapped = students.map((s) => ({ ...s, assigneeId: assignedTo(s, assignees) }));
  const owned = new Set(mapped.flatMap((s) => (s.assigneeId ? [s.id] : [])));
  const seen = new Set<string>();
  return mapped.filter((s) => {
    const key = `${s.id}|${s.assigneeId ?? ""}`;
    if ((!s.assigneeId && owned.has(s.id)) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
/** 근거 학생 수 — 같은 학생을 두 담당자가 맡아도 한 명(목록 · 상세가 같은 수). */
export const studentCount = (item: Pick<WorkItem, "links">) => new Set(item.links.map((l) => l.id)).size;

/** 검토하는 사람 — 비어 있으면 요청자. */
export const reviewerOf = (item: Pick<WorkItem, "reviewer" | "requester">) => item.reviewer ?? item.requester;
/**
 * 글 전체 · 모든 근거 학생을 보는 사람 — 요청자 · 검토자 · 업무 처리 현황 권한.
 * 담당자이기만 하면 자기 몫 글 · 자기 학생만 받는다(`forAssignee` — 원장 2026-11-03 *"각 선생님에게 각자 학생것만"*).
 */
export const seesAll = (item: Pick<WorkItem, "requester" | "reviewer">, me: string | null, monitor: boolean) =>
  monitor || (!!me && (item.requester?.id === me || item.reviewer?.id === me));
/** 담당자별 맡은 학생 — 담당 미정은 `null` 키. */
export function linksByAssignee<T extends { assigneeId: string | null }>(links: readonly T[], assignees: readonly string[]): Map<string | null, T[]> {
  const out = new Map<string | null, T[]>();
  for (const l of links) {
    const key = l.assigneeId && assignees.includes(l.assigneeId) ? l.assigneeId : null;
    out.set(key, [...(out.get(key) ?? []), l]);
  }
  return out;
}
export const reportedCount = (item: Pick<WorkItem, "steps">) => item.steps.filter((s) => s.state === "reported").length;

/** 단계 막대 — 0 담당자 보고 · 1 관리자 검토 · 2 마감. */
export function stageOf(status: WorkStatus): number {
  return status === "working" ? 0 : status === "review" ? 1 : 2;
}

export function statusText(item: Pick<WorkItem, "status" | "steps">): string {
  if (item.status !== "working") return STATUS_LABEL[item.status];
  if (item.steps.some((s) => s.returned && s.state !== "reported")) return "보완 중";
  if (item.steps.every((s) => s.state === "ready")) return "확인 전";
  return `처리 중 ${reportedCount(item)}/${item.steps.length}`;
}

/** 이 사람이 지금 할 일 — 보고(담당자) · 검토(검토자). 없으면 null. */
export function myTurn(item: WorkItem, me: string | null): "report" | "review" | null {
  if (!me) return null;
  if (item.status === "working" && item.steps.some((s) => s.user.id === me && s.state !== "reported")) return "report";
  if (item.status === "review" && (reviewerOf(item)?.id === me || item.requester?.id === me)) return "review";
  return null;
}

/** 기한이 지났나(KST 오늘과 견준다 · 끝난 일은 아니다). */
export const isLate = (item: Pick<WorkItem, "dueOn" | "status">, today: string) => !!item.dueOn && item.dueOn < today && (item.status === "working" || item.status === "review");
export const isOpen = (item: Pick<WorkItem, "status">) => item.status === "working" || item.status === "review";

export type WorkTab = "mine" | "requested" | "all" | "past";
export const WORK_TAB_LABEL: Record<WorkTab, string> = { mine: "내 차례", requested: "요청한 업무", all: "진행 중 전체", past: "지난 업무" };

export function filterWork(items: readonly WorkItem[], tab: WorkTab, me: string | null): WorkItem[] {
  if (tab === "past") return items.filter((i) => !isOpen(i));
  if (tab === "all") return items.filter(isOpen);
  if (tab === "requested") return items.filter((i) => isOpen(i) && i.requester?.id === me);
  return items.filter((i) => myTurn(i, me) !== null);
}

/** 급한 순 — 내 차례 → 기한 지남 → 기한 가까운 순(기한 없음은 뒤) → 최근에 만든 순. 끝난 일은 맨 뒤. */
export function urgentFirst(items: readonly WorkItem[], me: string | null, today: string): WorkItem[] {
  const rank = (i: WorkItem) => (!isOpen(i) ? 3 : myTurn(i, me) ? 0 : isLate(i, today) ? 1 : 2);
  return [...items].sort((a, b) => rank(a) - rank(b) || (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") || b.createdAt.localeCompare(a.createdAt));
}

/** 제목 · 담당 · 요청자 · 근거 학생 이름으로 찾기. */
export function matchesWork(item: WorkItem, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  return [item.title, item.requester?.name, ...item.steps.map((s) => s.user.name), ...item.links.map((l) => l.label)].some((t) => t?.includes(q));
}

/** 기한까지 — `11.04 · 2일 남음` · `1일 지남` · 오늘. 끝난 일은 날짜만. */
export function dueLabel(item: Pick<WorkItem, "dueOn" | "status">, today: string): { text: string; late: boolean } {
  if (!item.dueOn) return { text: "—", late: false };
  const md = `${Number(item.dueOn.slice(5, 7))}.${item.dueOn.slice(8, 10)}`;
  if (!isOpen(item)) return { text: md, late: false };
  const days = Math.round((Date.parse(`${item.dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return { text: days === 0 ? `${md} · 오늘` : days > 0 ? `${md} · ${days}일 남음` : `${md} · ${-days}일 지남`, late: days < 0 };
}

/** 업무 흐름 현황 — 진행 중 업무의 단계별 건수와 지난 7일 마감. */
export function workCounts(items: readonly WorkItem[], today: string) {
  const open = items.filter(isOpen);
  const weekAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
  return {
    ready: open.filter((i) => i.status === "working" && i.steps.every((s) => s.state === "ready")).length,
    working: open.filter((i) => statusText(i).startsWith("처리 중")).length,
    returned: open.filter((i) => statusText(i) === "보완 중").length,
    review: open.filter((i) => i.status === "review").length,
    late: open.filter((i) => isLate(i, today)).length,
    closedWeek: items.filter((i) => i.status === "closed" && (i.closedAt ?? "").slice(0, 10) >= weekAgo).length,
  };
}

/** 마감 근거 — 무엇으로 · 누가 · 언제(원장 2026-10-30 *"그냥 무작정 처리됨이 아니라"*). 사람을 지어내지 않는다. */
export function closeBasis(item: WorkItem): string | null {
  if (item.status !== "closed") return null;
  const who = item.events.findLast((e) => e.kind === "approved")?.actor ?? "검토자";
  const reports = item.steps.filter((s) => s.state === "reported").map((s) => `${s.user.name} ${s.outcome ? OUTCOME_LABEL[s.outcome] : "보고"}`);
  return `${reports.join(" · ") || "보고 없음"} → ${who} 승인`;
}
