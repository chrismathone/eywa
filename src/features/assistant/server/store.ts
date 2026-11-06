import "server-only";
/**
 * 학원 비서 대화 저장 — 표 `assistant_threads` · `assistant_messages`(SQL s2_NNNN_academy_assistant). RLS 정책 0 · 권한 회수라
 * 서버 키로 읽고 쓰되 **지점 · 본인을 늘 함께 거른다**(업무 비서와 같은 방식 — [[#104]]).
 * 표가 아직 없는 DB(SQL 적용 전)면 `enabled: false`로 버튼째 쉰다(#95).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { isAssistantLevel, type AssistantLevel } from "../levels";
import { ASSISTANT_RUNNING_MS, type AskStep, type QuerySummary, type ThreadDetailResponse, type ThreadMessage, type ThreadSummary } from "../protocol";
import type { AssistantReport, QueryResult, SettledReport } from "../report";
import { clipText } from "../text";
import type { PastTurn } from "./prompt";

export const THREADS = "assistant_threads";
export const MESSAGES = "assistant_messages";
/** 사람당 하루(한국 날짜) 질문 상한 · 아직 도는 질문으로 보는 시간. */
export const DAY_MAX = 100;
export const RUNNING_MS = ASSISTANT_RUNNING_MS;
/** 다음 질문에 이어 줄 지난 차례 수. */
const HISTORY_TURNS = 6;
/** 메시지에 저장하는 조회 결과 행 상한(화면이 다시 그린다). */
const STORED_ROWS = 2000;
/**
 * 저장·화면 크기 상한(적대 리뷰 2026-11-06 — 긴 글 칸 2천 행이 쌓이면 대화가 수 MB가 돼 다시 열리지 않는다).
 * 셀은 2천 자, 보고서 한 편은 글자 수 40만(JSON)까지 — 넘으면 가장 큰 자료부터 행을 반씩 줄이고 '일부만'으로 표시한다.
 * 대화를 다시 읽을 때 표·차트 자료는 최근 답 `DETAIL_DATASET_TURNS`편만, 합쳐 `DETAIL_DATASET_CHARS`까지 싣는다(3초 다시 읽기 포함).
 */
const STORED_CELL_CHARS = 2000;
const STORED_REPORT_CHARS = 400_000;
const STORED_SQL_CHARS = 20_000;
const DETAIL_MESSAGES = 100;
const DETAIL_DATASET_TURNS = 8;
const DETAIL_DATASET_CHARS = 2_500_000;

export type Owner = { tenantId: string; userId: string };

type ThreadRow = { id: string; title: string; level: string; updated_at: string };
/** 대화 읽기용 — 보고서는 글(제목·블록)만 읽고 표·차트 자료(datasets)는 따로 최근 것만 읽는다. */
type MessageRow = {
  id: string;
  question: string;
  level: string;
  status: "running" | "done" | "failed";
  report_title: string | null;
  report_blocks: AssistantReport["blocks"] | null;
  error: string | null;
  queries: Array<QuerySummary & { sql?: string }> | null;
  steps: AskStep[] | null;
  created_at: string;
};
type Datasets = SettledReport["datasets"];

const level = (v: string): AssistantLevel => (isAssistantLevel(v) ? v : "normal");
const missingTable = (e: { code?: string; message?: string } | null) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache/i.test(e.message ?? ""));

/**
 * 저장·전송할 보고서로 줄인다 — 셀 2천 자 · 자료 2천 행 · 전체 `STORED_REPORT_CHARS`. 줄인 자료는 `truncated`(화면 '일부만').
 * 흘려보내는 답과 저장본이 같도록 ask.ts가 내보내기 전에 부른다.
 */
export function compactReport(report: SettledReport): SettledReport {
  const datasets: Datasets = {};
  for (const [key, d] of Object.entries(report.datasets)) {
    const rows = d.rows.slice(0, STORED_ROWS).map((row) => {
      const out: (typeof d.rows)[number] = {};
      for (const [c, v] of Object.entries(row)) out[c] = typeof v === "string" ? clipText(v, STORED_CELL_CHARS, "…") : v;
      return out;
    });
    datasets[key] = { ...d, rows, truncated: d.truncated || rows.length < d.rows.length };
  }
  // 자료마다 크기를 한 번 재 두고, 줄인 자료만 다시 잰다(돌 때마다 행이 줄거나 멈추므로 반드시 끝난다).
  const sizes = new Map(Object.entries(datasets).map(([k, d]) => [k, JSON.stringify(d).length]));
  const rest = JSON.stringify({ ...report, datasets: {} }).length;
  const total = () => rest + [...sizes.values()].reduce((a, b) => a + b + 8, 0);
  while (total() > STORED_REPORT_CHARS) {
    let key: string | null = null;
    for (const [k, n] of sizes) if (datasets[k]!.rows.length > 1 && (key === null || n > sizes.get(key)!)) key = k;
    if (key === null) break;
    const d = datasets[key]!;
    datasets[key] = { ...d, rows: d.rows.slice(0, Math.floor(d.rows.length / 2)), truncated: true };
    sizes.set(key, JSON.stringify(datasets[key]).length);
  }
  return { ...report, datasets };
}

export async function listThreads(owner: Owner): Promise<{ enabled: boolean; threads: ThreadSummary[] }> {
  const { data, error } = await createAdminClient()
    .from(THREADS)
    .select("id, title, level, updated_at")
    .eq("tenant_id", owner.tenantId)
    .eq("user_id", owner.userId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (missingTable(error)) return { enabled: false, threads: [] };
  if (error) throw new Error(error.message);
  return { enabled: true, threads: ((data ?? []) as ThreadRow[]).map((t) => ({ id: t.id, title: t.title, level: level(t.level), updatedAt: t.updated_at })) };
}

async function ownThread(owner: Owner, threadId: string): Promise<ThreadRow | null> {
  const { data, error } = await createAdminClient()
    .from(THREADS)
    .select("id, title, level, updated_at")
    .eq("id", threadId)
    .eq("tenant_id", owner.tenantId)
    .eq("user_id", owner.userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ThreadRow | null) ?? null;
}

function toMessage(m: MessageRow, now: number, datasets: ReadonlyMap<string, Datasets>): ThreadMessage {
  const running = m.status === "running" && now - Date.parse(m.created_at) < RUNNING_MS;
  const data = datasets.get(m.id);
  const report: SettledReport | null =
    m.status === "done" && m.report_title !== null && Array.isArray(m.report_blocks)
      ? { title: m.report_title, blocks: m.report_blocks, datasets: data ?? {}, ...(data ? {} : { datasetsOmitted: true }) }
      : null;
  return {
    id: m.id,
    question: m.question,
    level: level(m.level),
    createdAt: m.created_at,
    report,
    error: m.status === "failed" ? m.error : m.status === "running" && !running ? "답을 끝내지 못했습니다. 다시 물어봐 주세요" : null,
    running,
    queries: (m.queries ?? []).map(({ id, purpose, rowCount, ms, error }) => ({ id, purpose, rowCount, ms, ...(error ? { error } : {}) })),
    steps: m.steps ?? [],
  };
}

export async function threadDetail(owner: Owner, threadId: string): Promise<ThreadDetailResponse | null> {
  const thread = await ownThread(owner, threadId);
  if (!thread) return null;
  const db = createAdminClient();
  const { data, error } = await db
    .from(MESSAGES)
    .select("id, question, level, status, report_title:report->>title, report_blocks:report->blocks, error, queries, steps, created_at")
    .eq("thread_id", threadId)
    .eq("tenant_id", owner.tenantId)
    .eq("user_id", owner.userId)
    .order("created_at", { ascending: false })
    .limit(DETAIL_MESSAGES);
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as unknown as MessageRow[]).reverse();
  // 표·차트 자료는 최근 답 몇 편만(응답 크기 상한 — 오래된 답은 '생략' 안내).
  const recent = rows.filter((m) => m.status === "done").slice(-DETAIL_DATASET_TURNS).map((m) => m.id);
  const datasets = new Map<string, Datasets>();
  if (recent.length) {
    const { data: sets, error: setsError } = await db
      .from(MESSAGES)
      .select("id, datasets:report->datasets")
      .in("id", recent)
      .eq("tenant_id", owner.tenantId)
      .eq("user_id", owner.userId);
    if (setsError) throw new Error(setsError.message);
    const byId = new Map(((sets ?? []) as unknown as Array<{ id: string; datasets: Datasets | null }>).map((s) => [s.id, s.datasets ?? {}]));
    let budget = DETAIL_DATASET_CHARS;
    for (const id of [...recent].reverse()) {
      const d = byId.get(id);
      if (!d) continue;
      const size = JSON.stringify(d).length;
      if (size > budget) continue;
      budget -= size;
      datasets.set(id, d);
    }
  }
  const now = Date.now();
  return {
    thread: { id: thread.id, title: thread.title, level: level(thread.level), updatedAt: thread.updated_at },
    messages: rows.map((m) => toMessage(m, now, datasets)),
  };
}

export async function deleteThread(owner: Owner, threadId: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from(THREADS)
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", threadId)
    .eq("tenant_id", owner.tenantId)
    .eq("user_id", owner.userId)
    .is("deleted_at", null)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** 다음 질문에 붙일 지난 차례(끝난 것만 · 최근 6). */
export async function pastTurns(owner: Owner, threadId: string): Promise<PastTurn[]> {
  const { data, error } = await createAdminClient()
    .from(MESSAGES)
    .select("question, report_title:report->>title, report_blocks:report->blocks, queries, status, created_at")
    .eq("thread_id", threadId)
    .eq("tenant_id", owner.tenantId)
    .eq("user_id", owner.userId)
    .in("status", ["done", "failed"])
    .order("created_at", { ascending: false })
    .limit(HISTORY_TURNS);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Array<Pick<MessageRow, "question" | "report_title" | "report_blocks" | "queries" | "status">>)
    .reverse()
    .map((m) => ({
      question: m.question,
      report: m.status === "done" && m.report_title !== null && Array.isArray(m.report_blocks) ? { title: m.report_title, blocks: m.report_blocks } : null,
      queries: (m.queries ?? []).filter((q) => q.sql).map((q) => ({ id: q.id, purpose: q.purpose, sql: q.sql! })),
    }));
}

/** 한국 날짜 오늘 0시(UTC 시각). */
function kstDayStartIso(now: Date): string {
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 3_600_000).toISOString();
}

export const BUSY_MESSAGE = "앞 질문의 답을 아직 만드는 중입니다. 끝난 뒤 물어봐 주세요";
const STALE_MESSAGE = "답을 끝내지 못했습니다. 다시 물어봐 주세요";

/**
 * 하루 상한 · 겹친 질문 확인. 막히면 한국어 이유.
 * 먼저 함수가 죽어 남은 '도는 중'(5분 넘은 것)을 실패로 닫는다 — 사람당 '도는 질문 하나' 고유 색인(s2_0031)이 영영 막히지 않게.
 * '멈춤'을 누른 질문은 마무리 중이어도 도는 것으로 세지 않는다(멈추고 바로 다시 물을 수 있게 · 적대 리뷰 2026-11-06).
 * 동시에 두 번 들어오는 경우는 이 확인이 아니라 고유 색인이 막는다(`startMessage` → "busy").
 */
export async function admission(owner: Owner, now = new Date()): Promise<string | null> {
  const db = createAdminClient();
  const { error: staleError } = await db
    .from(MESSAGES)
    .update({ status: "failed", error: STALE_MESSAGE, finished_at: now.toISOString() })
    .eq("tenant_id", owner.tenantId)
    .eq("user_id", owner.userId)
    .eq("status", "running")
    .lt("created_at", new Date(now.getTime() - RUNNING_MS).toISOString());
  if (staleError) throw new Error(staleError.message);
  const { data, error } = await db
    .from(MESSAGES)
    .select("status, created_at, cancel_requested_at")
    .eq("tenant_id", owner.tenantId)
    .eq("user_id", owner.userId)
    .gte("created_at", kstDayStartIso(now))
    .order("created_at", { ascending: false })
    .limit(DAY_MAX);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ status: string; created_at: string; cancel_requested_at: string | null }>;
  if (rows.some((r) => r.status === "running" && !r.cancel_requested_at && now.getTime() - Date.parse(r.created_at) < RUNNING_MS)) return BUSY_MESSAGE;
  if (rows.length >= DAY_MAX) return `오늘은 질문을 ${DAY_MAX}번 해서 더 물을 수 없습니다. 내일 다시 써 주세요`;
  return null;
}

const titleOf = (question: string) => clipText(question.replace(/\s+/g, " ").trim(), 40, "…");

/**
 * 대화(없으면 새로) + '도는 중' 메시지 한 줄. 대화가 없으면 "no_thread", 이미 도는 질문이 있으면(고유 색인 23505) "busy" —
 * 이때 방금 만든 빈 대화는 지운다.
 */
export async function startMessage(
  owner: Owner,
  input: { threadId?: string | null; question: string; level: AssistantLevel },
): Promise<{ threadId: string; title: string; messageId: string; created: boolean } | "no_thread" | "busy"> {
  const db = createAdminClient();
  let threadId = input.threadId ?? null;
  let title = titleOf(input.question);
  let created = false;
  if (threadId) {
    const thread = await ownThread(owner, threadId);
    if (!thread) return "no_thread";
    title = thread.title;
  } else {
    const { data, error } = await db
      .from(THREADS)
      .insert({ tenant_id: owner.tenantId, user_id: owner.userId, title, level: input.level })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    threadId = (data as { id: string }).id;
    created = true;
  }
  const { data, error } = await db
    .from(MESSAGES)
    .insert({ tenant_id: owner.tenantId, user_id: owner.userId, thread_id: threadId, question: input.question, level: input.level, status: "running" })
    .select("id")
    .single();
  if (error) {
    if (created) await db.from(THREADS).delete().eq("id", threadId).eq("tenant_id", owner.tenantId).eq("user_id", owner.userId);
    if (error.code === "23505") return "busy";
    throw new Error(error.message);
  }
  return { threadId, title, messageId: (data as { id: string }).id, created };
}

export type Usage = { model: string; input: number; output: number; cacheRead: number; cacheWrite: number };

/**
 * 답(또는 실패)을 저장한다. 보고서는 `compactReport`로 줄인 것(ask.ts) — 조회 결과 행은 보고서가 가리키는 것만 보고서 안에 있다.
 * 실패하면 `markFailed`로 상태만이라도 닫는다(ask.ts).
 */
export async function finishMessage(
  owner: Owner,
  input: { threadId: string; messageId: string; level: AssistantLevel; report: SettledReport | null; error: string | null; queries: QueryResult[]; steps: AskStep[]; usage: Usage[] },
): Promise<void> {
  const db = createAdminClient();
  const { error } = await db
    .from(MESSAGES)
    .update({
      status: input.report ? "done" : "failed",
      report: input.report,
      error: input.error,
      queries: input.queries.map((q) => ({ id: q.id, purpose: q.purpose, sql: clipText(q.sql, STORED_SQL_CHARS, "…"), rowCount: q.rowCount, ms: q.ms })),
      // 아직 '도는 중'으로 남은 단계는 끝난 것으로 닫아 둔다(다시 열었을 때 돌아가는 표시가 남지 않게).
      steps: input.steps.map((st) => (st.state === "running" ? { ...st, state: input.report ? "done" : "error" } : st)),
      usage: input.usage,
      finished_at: new Date().toISOString(),
    })
    .eq("id", input.messageId)
    .eq("tenant_id", owner.tenantId)
    .eq("user_id", owner.userId);
  if (error) throw new Error(error.message);
  await db
    .from(THREADS)
    .update({ updated_at: new Date().toISOString(), level: input.level })
    .eq("id", input.threadId)
    .eq("tenant_id", owner.tenantId)
    .eq("user_id", owner.userId);
}

/** 저장이 실패했을 때(크기·일시 오류) 상태만이라도 '실패'로 닫는다 — '도는 중'으로 남아 새 질문을 막지 않게. */
export async function markFailed(owner: Owner, messageId: string, message: string): Promise<void> {
  const { error } = await createAdminClient()
    .from(MESSAGES)
    .update({ status: "failed", error: message, finished_at: new Date().toISOString() })
    .eq("id", messageId)
    .eq("tenant_id", owner.tenantId)
    .eq("user_id", owner.userId);
  if (error) throw new Error(error.message);
}

/**
 * 이 대화에 아직 도는 질문이 있나 — 화면의 3초 다시 읽기용(가볍게: 줄 하나만 본다 · 재리뷰 2026-11-06).
 * 없으면 화면이 대화 전체(표·차트 자료 포함)를 한 번 읽는다.
 */
export async function threadRunning(owner: Owner, threadId: string, now = new Date()): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from(MESSAGES)
    .select("id")
    .eq("thread_id", threadId)
    .eq("tenant_id", owner.tenantId)
    .eq("user_id", owner.userId)
    .eq("status", "running")
    .gte("created_at", new Date(now.getTime() - RUNNING_MS).toISOString())
    .limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/**
 * '지금 도는 내 질문' 멈춤 — 화면이 질문 번호를 모를 때(번호를 받기 전 · 번호로 보낸 멈춤이 실패) 쓴다.
 * 사람당 도는 질문은 하나(고유 색인)라 본인의 '도는 중' 줄에 표시하면 그 질문이다.
 */
export async function requestStopCurrent(owner: Owner): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from(MESSAGES)
    .update({ cancel_requested_at: new Date().toISOString() })
    .eq("tenant_id", owner.tenantId)
    .eq("user_id", owner.userId)
    .eq("status", "running")
    .is("cancel_requested_at", null)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** '멈춤' — 다른 서버 인스턴스에서 도는 질문도 멈추게 표시만 남긴다(도는 쪽이 몇 초마다 본다). */
export async function requestStop(owner: Owner, messageId: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from(MESSAGES)
    .update({ cancel_requested_at: new Date().toISOString() })
    .eq("id", messageId)
    .eq("tenant_id", owner.tenantId)
    .eq("user_id", owner.userId)
    .eq("status", "running")
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

export async function stopRequested(owner: Owner, messageId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from(MESSAGES)
    .select("cancel_requested_at")
    .eq("id", messageId)
    .eq("tenant_id", owner.tenantId)
    .eq("user_id", owner.userId)
    .maybeSingle();
  return !!(data as { cancel_requested_at: string | null } | null)?.cancel_requested_at;
}
