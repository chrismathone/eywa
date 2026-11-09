/**
 * 학원 비서 화면 상태 — 순수 리듀서 + NDJSON 줄 나누기(Vitest). 그물(fetch·스트림)은 `use-assistant.ts`가 한다.
 *
 * 🔑 상태는 오버레이 안이 아니라 **런처**(셸 레이아웃에 붙어 화면을 옮겨도 살아 있다)가 든다 — 닫아도 대화·진행 중 답이 그대로다.
 * 🔑 질문 한 번(= 차례 turn)은 `turnKey`(전역 유일)로 찾는다 — 새 대화는 첫 `thread` 이벤트에서 `new:*` 키가 `t:<id>`로
 *    바뀌므로, 진행 중인 흐름이 대화 키를 들고 있으면 그 순간 갈 곳을 잃는다.
 */
import type { AssistantLevel } from "@/features/assistant/levels";
import { isAssistantLevel } from "@/features/assistant/levels";
import type { AskEvent, AskStep, QuerySummary, ThreadDetailResponse, ThreadMessage, ThreadSummary } from "@/features/assistant/protocol";
import type { SettledReport } from "@/features/assistant/report";
import { addDays, kstDateOf, kstTimeOf, monthDayLabel } from "@/lib/date-kst";

/**
 * 차례의 상태.
 * - `streaming` 답을 받는 중 · `recovering` 흐름이 끊겨 저장본을 다시 읽는 중 · `running` 서버가 아직 만드는 중(다른 창에서 물은 질문 등)
 * - `done` 보고서 도착 · `error` 실패(문구 있음) · `stopped` 사용자가 멈춤
 */
export type TurnStatus = "streaming" | "recovering" | "running" | "done" | "error" | "stopped";

export type Turn = {
  key: string;
  messageId: string | null;
  question: string;
  level: AssistantLevel;
  createdAt: string;
  status: TurnStatus;
  /** 답을 만드는 단계(같은 id는 덮어쓴다 · 온 순서대로) — 진행 중엔 실시간, 끝난 뒤엔 '과정 보기'. */
  steps: AskStep[];
  /** 저장본의 조회 요약(단계가 없던 옛 메시지의 근거용). */
  queries: QuerySummary[];
  report: SettledReport | null;
  error: string | null;
};

export type Conversation = {
  key: string;
  threadId: string | null;
  title: string | null;
  turns: Turn[];
  load: "idle" | "loading" | "ready" | "error";
  loadError: string | null;
};

export type AssistantState = {
  /** 지난 대화 목록 — 처음 열 때 읽는다. */
  threads: ThreadSummary[];
  threadsLoad: "idle" | "loading" | "ready" | "error";
  threadsError: string | null;
  /** 이 지점·사람이 비서를 쓸 수 있나(목록 응답이 알려 준다). 모르면 null. */
  enabled: boolean | null;
  conversations: Record<string, Conversation>;
  currentKey: string;
  /** 지금 답을 받는 차례(한 번에 하나 — 서버 동시 실행 상한과 같은 결). */
  inflight: { turnKey: string } | null;
};

export const threadKey = (threadId: string) => `t:${threadId}`;

const emptyConversation = (key: string, threadId: string | null = null, title: string | null = null): Conversation => ({
  key,
  threadId,
  title,
  turns: [],
  load: threadId ? "idle" : "ready",
  loadError: null,
});

export function initialAssistantState(newKey = "new:0"): AssistantState {
  return {
    threads: [],
    threadsLoad: "idle",
    threadsError: null,
    enabled: null,
    conversations: { [newKey]: emptyConversation(newKey) },
    currentKey: newKey,
    inflight: null,
  };
}

export type AssistantAction =
  | { type: "threads/loading" }
  | { type: "threads/loaded"; enabled: boolean; threads: ThreadSummary[] }
  | { type: "threads/failed"; error: string }
  | { type: "conv/new"; key: string }
  | { type: "conv/select"; threadId: string; title?: string | null }
  | { type: "conv/loading"; key: string }
  | { type: "conv/loaded"; key: string; detail: ThreadDetailResponse }
  | { type: "conv/failed"; key: string; error: string }
  | { type: "ask/start"; convKey: string; turn: Turn }
  | { type: "ask/event"; turnKey: string; event: AskEvent; now: string }
  | { type: "ask/broken"; turnKey: string }
  | { type: "ask/failed"; turnKey: string; error: string }
  | { type: "ask/stopped"; turnKey: string }
  | { type: "ask/end"; turnKey: string }
  | { type: "thread/deleted"; threadId: string; newKey: string }
  | { type: "thread/renamed"; threadId: string; title: string };

/** 저장된 메시지 → 화면 차례. 끝난 답·실패·진행 중 어느 것도 아니면 "답을 받지 못했다"로(빈 차례를 남기지 않는다). */
export function turnFromMessage(m: ThreadMessage): Turn {
  const status: TurnStatus = m.report ? "done" : m.running ? "running" : "error";
  return {
    key: `m:${m.id}`,
    messageId: m.id,
    question: m.question,
    level: isAssistantLevel(m.level) ? m.level : "normal",
    createdAt: m.createdAt,
    status,
    steps: Array.isArray(m.steps) ? m.steps : [],
    queries: m.queries ?? [],
    report: m.report,
    error: status === "error" ? (m.error ?? "답을 받지 못했습니다.") : null,
  };
}

function findTurn(state: AssistantState, turnKey: string): { conv: Conversation; index: number } | null {
  for (const conv of Object.values(state.conversations)) {
    const index = conv.turns.findIndex((t) => t.key === turnKey);
    if (index >= 0) return { conv, index };
  }
  return null;
}

function patchTurn(state: AssistantState, turnKey: string, patch: (t: Turn) => Turn): AssistantState {
  const hit = findTurn(state, turnKey);
  if (!hit) return state;
  const turns = hit.conv.turns.slice();
  turns[hit.index] = patch(turns[hit.index]!);
  return { ...state, conversations: { ...state.conversations, [hit.conv.key]: { ...hit.conv, turns } } };
}

/** 목록에서 그 대화를 맨 위로(갱신 시각 = now). 없으면 그대로. */
function bumpThread(threads: ThreadSummary[], threadId: string, now: string): ThreadSummary[] {
  const t = threads.find((x) => x.id === threadId);
  if (!t) return threads;
  return [{ ...t, updatedAt: now }, ...threads.filter((x) => x.id !== threadId)];
}

function onEvent(state: AssistantState, turnKey: string, event: AskEvent, now: string): AssistantState {
  switch (event.type) {
    case "started":
      return patchTurn(state, turnKey, (t) => ({ ...t, messageId: event.messageId }));
    case "thread": {
      // 새 대화가 서버에 생겼다 — `new:*` 대화를 `t:<id>`로 옮기고 목록 맨 위에 세운다.
      const hit = findTurn(state, turnKey);
      if (!hit) return state;
      const nextKey = threadKey(event.threadId);
      const moved: Conversation = { ...hit.conv, key: nextKey, threadId: event.threadId, title: event.title, load: "ready" };
      const conversations = { ...state.conversations };
      delete conversations[hit.conv.key];
      conversations[nextKey] = moved;
      const level = hit.conv.turns[hit.index]!.level;
      const threads = [
        { id: event.threadId, title: event.title, level, updatedAt: now },
        ...state.threads.filter((t) => t.id !== event.threadId),
      ];
      return {
        ...state,
        conversations,
        threads,
        currentKey: state.currentKey === hit.conv.key ? nextKey : state.currentKey,
      };
    }
    case "step":
      // 같은 id는 그 자리에서 덮어쓰고(running → done/error), 새 단계는 끝에 붙인다.
      return patchTurn(state, turnKey, (t) => {
        const i = t.steps.findIndex((x) => x.id === event.step.id);
        const steps = i >= 0 ? t.steps.map((x, j) => (j === i ? event.step : x)) : [...t.steps, event.step];
        return { ...t, steps };
      });
    case "report":
    case "error": {
      const next = patchTurn(state, turnKey, (t) =>
        event.type === "report"
          ? { ...t, status: "done", messageId: event.messageId, report: event.report, error: null }
          : { ...t, status: "error", messageId: event.messageId ?? t.messageId, error: event.message },
      );
      const threadId = findTurn(next, turnKey)?.conv.threadId;
      return threadId ? { ...next, threads: bumpThread(next.threads, threadId, now) } : next;
    }
  }
}

export function assistantReducer(state: AssistantState, action: AssistantAction): AssistantState {
  switch (action.type) {
    case "threads/loading":
      return { ...state, threadsLoad: state.threadsLoad === "ready" ? "ready" : "loading", threadsError: null };
    case "threads/loaded":
      return { ...state, threads: action.threads, enabled: action.enabled, threadsLoad: "ready", threadsError: null };
    case "threads/failed":
      return { ...state, threadsLoad: state.threadsLoad === "ready" ? "ready" : "error", threadsError: action.error };

    case "conv/new": {
      // 비어 있는 새 대화가 이미 있으면 그쪽으로(새 질문을 여러 번 눌러 빈 대화가 쌓이지 않게).
      const blank = Object.values(state.conversations).find((c) => !c.threadId && c.turns.length === 0);
      if (blank) return { ...state, currentKey: blank.key };
      return { ...state, conversations: { ...state.conversations, [action.key]: emptyConversation(action.key) }, currentKey: action.key };
    }
    case "conv/select": {
      const key = threadKey(action.threadId);
      if (state.conversations[key]) return { ...state, currentKey: key };
      const title = action.title ?? state.threads.find((t) => t.id === action.threadId)?.title ?? null;
      return { ...state, conversations: { ...state.conversations, [key]: emptyConversation(key, action.threadId, title) }, currentKey: key };
    }
    case "conv/loading": {
      const conv = state.conversations[action.key];
      if (!conv) return state;
      return { ...state, conversations: { ...state.conversations, [action.key]: { ...conv, load: "loading", loadError: null } } };
    }
    case "conv/loaded": {
      const conv = state.conversations[action.key];
      if (!conv) return state;
      // 🔴 이 대화에서 답을 받는 중이면 그 차례는 남긴다(로컬이 저장본보다 새롭다) — 저장본의 '도는 중' 같은 질문은 뺀다.
      const live = state.inflight ? conv.turns.find((t) => t.key === state.inflight!.turnKey) : undefined;
      let turns = action.detail.messages.map(turnFromMessage);
      if (live) {
        // 같은 차례 = 질문 번호가 같은 것(같은 글을 두 번 물은 차례를 잘못 빼지 않게 — 적대 리뷰 2026-11-06).
        // 번호(`started`)를 받기 전에만 '도는 중 + 같은 질문 글'로 맞춘다.
        const dup = live.messageId
          ? turns.findIndex((t) => t.messageId === live.messageId)
          : turns.findLastIndex((t) => t.status === "running" && t.question === live.question);
        if (dup >= 0) turns = turns.filter((_, i) => i !== dup);
        turns = [...turns, live];
      }
      const t = action.detail.thread;
      return {
        ...state,
        conversations: { ...state.conversations, [action.key]: { ...conv, title: t.title, turns, load: "ready", loadError: null } },
        threads: state.threads.map((x) => (x.id === t.id ? { ...x, title: t.title } : x)),
      };
    }
    case "conv/failed": {
      const conv = state.conversations[action.key];
      if (!conv) return state;
      // 끊긴 차례를 되살리지 못했으면 그 차례에 이유를 적는다(빙글빙글 도는 채로 남기지 않는다).
      const turns = conv.turns.map((t) =>
        t.status === "recovering" ? { ...t, status: "error" as const, error: "연결이 끊겼고 결과를 다시 불러오지 못했습니다." } : t,
      );
      return { ...state, conversations: { ...state.conversations, [action.key]: { ...conv, turns, load: "error", loadError: action.error } } };
    }

    case "ask/start": {
      const conv = state.conversations[action.convKey];
      if (!conv || state.inflight) return state;
      return {
        ...state,
        conversations: { ...state.conversations, [conv.key]: { ...conv, turns: [...conv.turns, action.turn] } },
        inflight: { turnKey: action.turn.key },
      };
    }
    case "ask/event":
      return onEvent(state, action.turnKey, action.event, action.now);
    case "ask/broken":
      return patchTurn(state, action.turnKey, (t) => (t.status === "streaming" ? { ...t, status: "recovering" } : t));
    case "ask/failed":
      return patchTurn(state, action.turnKey, (t) =>
        t.status === "done" ? t : { ...t, status: "error", error: action.error },
      );
    case "ask/stopped":
      return patchTurn(state, action.turnKey, (t) =>
        t.status === "streaming" || t.status === "recovering" ? { ...t, status: "stopped" } : t,
      );
    case "ask/end":
      return state.inflight?.turnKey === action.turnKey ? { ...state, inflight: null } : state;

    case "thread/deleted": {
      const key = threadKey(action.threadId);
      const conversations = { ...state.conversations };
      delete conversations[key];
      const threads = state.threads.filter((t) => t.id !== action.threadId);
      if (state.currentKey !== key) return { ...state, conversations, threads };
      const blank = Object.values(conversations).find((c) => !c.threadId && c.turns.length === 0);
      if (blank) return { ...state, conversations, threads, currentKey: blank.key };
      conversations[action.newKey] = emptyConversation(action.newKey);
      return { ...state, conversations, threads, currentKey: action.newKey };
    }

    // 이름 바꾸기 — 목록과 열려 있는 그 대화 머리를 함께(목록 순서는 그대로).
    case "thread/renamed": {
      const key = threadKey(action.threadId);
      const conv = state.conversations[key];
      return {
        ...state,
        threads: state.threads.map((t) => (t.id === action.threadId ? { ...t, title: action.title } : t)),
        conversations: conv ? { ...state.conversations, [key]: { ...conv, title: action.title } } : state.conversations,
      };
    }
  }
}

/** 지금 보는 대화(없으면 빈 새 대화 모양). */
export function currentConversation(state: AssistantState): Conversation {
  return state.conversations[state.currentKey] ?? emptyConversation(state.currentKey);
}

/** 답을 받는 차례가 이 대화에 있나. */
export function isConversationStreaming(state: AssistantState, conv: Conversation): boolean {
  return !!state.inflight && conv.turns.some((t) => t.key === state.inflight!.turnKey);
}

// ───────────────────────────── 진행 단계 요약 ─────────────────────────────

/** 걸린 시간 글자 — 10초 미만 `3.4초` · 1분 미만 `18초` · 그 위 `1분 5초`. */
export function formatDuration(ms: number): string {
  const sec = Math.max(0, ms) / 1000;
  if (sec < 10) return `${sec.toFixed(1)}초`;
  if (sec < 60) return `${Math.round(sec)}초`;
  const whole = Math.round(sec);
  const m = Math.floor(whole / 60);
  const r = whole % 60;
  return r ? `${m}분 ${r}초` : `${m}분`;
}

/**
 * 막힌 단계 하나의 뜻(원장 2026-11-06 *"왜 없는 칸을 썼다고 나오는지"* — 답은 잘 나왔는데 빨간 오류가 남아 문제처럼 보였다):
 * - `limit` = 시간·조회 한도로 여기서 멈춤(서버 표식 `cause` — 고칠 실수가 아니라 분석이 잘렸다는 신호).
 * - `retried` = **답이 보고서로 끝났고**(settled) 뒤에 같은 종류 단계가 끝까지 됐다 — 다른 조회로 이어 갔다.
 *   🔴 답 전체가 실패한 차례는 늘 `failed` — 실패 안내는 '어디서 막혔나'를 보여 주는 자리다(적대 리뷰 2026-11-06).
 * - `failed` = 나머지. 막히지 않았으면 null.
 */
export function stepTrouble(steps: readonly AskStep[], index: number, settled: boolean): "retried" | "limit" | "failed" | null {
  const s = steps[index];
  if (!s || s.state !== "error") return null;
  if (s.cause === "limit") return "limit";
  const family = (k: AskStep["kind"]) => (k === "fix" ? "report" : k);
  if (settled && steps.slice(index + 1).some((t) => t.state === "done" && family(t.kind) === family(s.kind))) return "retried";
  return "failed";
}

/**
 * 끝난 답의 과정 한 줄 재료 — 조회 횟수(조회 실행 단계 수) · 본 표 수(겹치지 않게) · 걸린 시간(가장 늦게 끝난 단계의 끝) ·
 * 막힌 단계를 `stepTrouble`로 가른 수(다시 시도 · 한도로 멈춤 · 막힘). `settled` = 답이 보고서로 끝난 차례.
 * 같은 id가 여러 번 온 단계는 이미 하나로 합쳐져 있다(리듀서).
 */
export function stepSummary(
  steps: readonly AskStep[],
  settled = false,
): { queries: number; tables: number; ms: number; retried: number; limited: number; failed: number } {
  const tables = new Set<string>();
  let ms = 0;
  const count = { retried: 0, limit: 0, failed: 0 };
  steps.forEach((s, i) => {
    for (const t of s.tables ?? []) tables.add(t.name);
    ms = Math.max(ms, s.at + (s.ms ?? 0));
    const trouble = stepTrouble(steps, i, settled);
    if (trouble) count[trouble]++;
  });
  return {
    queries: steps.filter((s) => s.kind === "query").length,
    tables: tables.size,
    ms,
    retried: count.retried,
    limited: count.limit,
    failed: count.failed,
  };
}

/** 과정 한 줄 — `조회 3번 · 표 5개 · 18초`(0인 칸은 뺀다 · 다시 시도·한도로 멈춤·막힌 단계가 있으면 덧붙인다). */
export function stepSummaryText(steps: readonly AskStep[], settled = false): string {
  const s = stepSummary(steps, settled);
  return [
    s.queries ? `조회 ${s.queries}번` : null,
    s.tables ? `표 ${s.tables}개` : null,
    formatDuration(s.ms),
    s.retried ? `다시 시도 ${s.retried}번` : null,
    s.limited ? `시간·한도로 여기까지` : null,
    s.failed ? `막힌 단계 ${s.failed}개` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

// ───────────────────────────── 지난 대화 묶음 ─────────────────────────────

export type ThreadGroup = { label: string; items: { thread: ThreadSummary; when: string }[] };

/**
 * 지난 대화를 KST 날짜로 묶는다 — 오늘 · 어제 · 지난 7일 · 이전(최근 순). 항목 옆 글자는 오늘이면 `14:30`, 그 밖은 `11/3`.
 * `today`(YYYY-MM-DD)는 부르는 쪽이 열 때 한 번 정한다(렌더 중에 '지금'을 읽지 않게).
 */
export function groupThreadsByDay(threads: readonly ThreadSummary[], today: string): ThreadGroup[] {
  const yesterday = addDays(today, -1);
  const weekAgo = addDays(today, -7);
  const groups: ThreadGroup[] = [
    { label: "오늘", items: [] },
    { label: "어제", items: [] },
    { label: "지난 7일", items: [] },
    { label: "이전", items: [] },
  ];
  // 최근 순 — 시각을 읽지 못하는 값은 맨 뒤.
  const at = (t: ThreadSummary) => {
    const ms = Date.parse(t.updatedAt);
    return Number.isNaN(ms) ? -Infinity : ms;
  };
  const sorted = [...threads].sort((a, b) => at(b) - at(a) || 0);
  for (const thread of sorted) {
    const day = kstDateOf(thread.updatedAt);
    const when = day === today ? (kstTimeOf(thread.updatedAt) ?? "") : day ? monthDayLabel(day) : "";
    const g = !day ? 3 : day === today ? 0 : day === yesterday ? 1 : day >= weekAgo ? 2 : 3;
    groups[g]!.items.push({ thread, when });
  }
  return groups.filter((g) => g.items.length > 0);
}

// ───────────────────────────── NDJSON ─────────────────────────────

/** 받은 조각을 줄로 — 끝의 덜 온 줄은 `rest`로 남긴다(다음 조각과 이어 붙인다). 빈 줄은 버린다. */
export function splitNdjson(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.map((l) => l.trim()).filter(Boolean), rest };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const STEP_KINDS: readonly AskStep["kind"][] = ["understand", "schema", "write_sql", "query", "analyze", "report", "fix", "survey"];
const STEP_STATES: readonly AskStep["state"][] = ["running", "done", "error"];

/** 단계 하나 — 모양이 틀리면 null. 표 칩은 이름·라벨이 글자인 것만 남긴다. */
export function parseStep(v: unknown): AskStep | null {
  if (!isObj(v) || !str(v.id) || !str(v.label) || !num(v.at)) return null;
  if (!STEP_KINDS.includes(v.kind as AskStep["kind"]) || !STEP_STATES.includes(v.state as AskStep["state"])) return null;
  const tables = Array.isArray(v.tables)
    ? v.tables.filter((t): t is { name: string; label: string } => isObj(t) && str(t.name) && str(t.label)).map((t) => ({ name: t.name, label: t.label }))
    : undefined;
  return {
    id: v.id,
    kind: v.kind as AskStep["kind"],
    label: v.label,
    state: v.state as AskStep["state"],
    at: v.at,
    ...(tables && tables.length ? { tables } : {}),
    ...(str(v.detail) ? { detail: v.detail } : {}),
    ...(num(v.ms) ? { ms: v.ms } : {}),
    ...(v.cause === "limit" ? { cause: "limit" as const } : {}),
  };
}

/**
 * 한 줄 → 이벤트. 알 수 없는 줄·모양이 틀린 줄은 null(버린다 — 흐름 하나가 화면을 깨뜨리지 않게).
 * 보고서 본문은 서버가 검증한 것이라 여기서는 뼈대(제목·블록 배열·자료 묶음)만 본다 — 블록은 그리는 쪽이 모르는 종류를 건너뛴다.
 */
export function parseAskEvent(line: string): AskEvent | null {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isObj(v) || !str(v.type)) return null;
  switch (v.type) {
    case "started":
      return str(v.messageId) ? { type: "started", messageId: v.messageId } : null;
    case "thread":
      return str(v.threadId) && str(v.title) ? { type: "thread", threadId: v.threadId, title: v.title } : null;
    case "step": {
      const step = parseStep(v.step);
      return step ? { type: "step", step } : null;
    }
    case "report": {
      const r = v.report;
      if (!str(v.messageId) || !isObj(r) || !str(r.title) || !Array.isArray(r.blocks) || !isObj(r.datasets)) return null;
      return { type: "report", messageId: v.messageId, report: r as unknown as SettledReport };
    }
    case "error":
      return str(v.message) ? { type: "error", message: v.message, ...(str(v.messageId) ? { messageId: v.messageId } : {}) } : null;
    default:
      return null;
  }
}
