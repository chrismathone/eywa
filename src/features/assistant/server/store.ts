import "server-only";
/**
 * 학원 비서 대화 저장 — 표 `assistant_threads` · `assistant_messages`(SQL s2_NNNN_academy_assistant). RLS 정책 0 · 권한 회수라
 * 서버 키로 읽고 쓰되 **지점 · 본인을 늘 함께 거른다**(업무 비서와 같은 방식 — [[#104]]).
 * 표가 아직 없는 DB(SQL 적용 전)면 `enabled: false`로 버튼째 쉰다(#95).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { reportWarning } from "@/lib/observability/report-error";
import { labelDatasets } from "../code-labels";
import { isAssistantLevel, type AssistantLevel } from "../levels";
import { ASSISTANT_MAX_RUNNING, ASSISTANT_RUNNING_MS, type AskStep, type QuerySummary, type ThreadDetailResponse, type ThreadMessage, type ThreadSummary } from "../protocol";
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
  /** 확인한 자료 범위(전수 조회를 한 답만 · 작다 — 글과 함께 읽는다). */
  report_coverage: SettledReport["coverage"] | null;
  /** 조회를 일찍 끝내고 정리한 답이면 그 까닭(원장이 누른 '바로 결과 보기' · 시간 · 읽은 분량). */
  report_cut: string | null;
  /** 멈춤을 누른 때(도는 중이어도 마무리 중이다). */
  cancel_requested_at: string | null;
  error: string | null;
  queries: Array<QuerySummary & { sql?: string }> | null;
  steps: AskStep[] | null;
  created_at: string;
};
type Datasets = SettledReport["datasets"];

const level = (v: string): AssistantLevel => (isAssistantLevel(v) ? v : "normal");
const isCutShort = (v: string | null): v is NonNullable<SettledReport["cutShort"]> => v === "user" || v === "time" || v === "context";
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
  // 아직 답을 만드는 대화 — 다른 탭·기기에서 물었거나 새로 고친 뒤에도 목록·보내기 막기가 맞게(원장 2026-11-06 *"정상적인 동작으로 인식되게"*).
  // 목록과 따로 읽는다(서로 기다리지 않게) · 이것만 실패하면 표시 없이 목록은 낸다(적대 리뷰 2026-11-09).
  const [{ data, error }, running] = await Promise.all([
    createAdminClient()
      .from(THREADS)
      .select("id, title, level, updated_at")
      .eq("tenant_id", owner.tenantId)
      .eq("user_id", owner.userId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(100),
    runningThreadIds(owner).catch((e: unknown) => {
      reportWarning("학원 비서 도는 대화 읽기 실패", { scope: "assistant.threads.running", tenantId: owner.tenantId, error: e instanceof Error ? e.message : String(e) });
      return new Set<string>();
    }),
  ]);
  if (missingTable(error)) return { enabled: false, threads: [] };
  if (error) throw new Error(error.message);
  return {
    enabled: true,
    threads: ((data ?? []) as ThreadRow[]).map((t) => ({
      id: t.id,
      title: t.title,
      level: level(t.level),
      updatedAt: t.updated_at,
      ...(running.has(t.id) ? { running: true } : {}),
    })),
  };
}

/** 지금 답을 만드는 본인 질문의 대화(멈춤을 누른 것 · 15분 넘은 것은 뺀다 — 자리를 차지하지 않는다). */
async function runningThreadIds(owner: Owner, now = Date.now()): Promise<Set<string>> {
  const { data, error } = await createAdminClient()
    .from(MESSAGES)
    .select("thread_id")
    .eq("tenant_id", owner.tenantId)
    .eq("user_id", owner.userId)
    .eq("status", "running")
    .is("cancel_requested_at", null)
    .gte("created_at", new Date(now - RUNNING_MS).toISOString());
  if (error) throw new Error(error.message);
  return new Set(((data ?? []) as Array<{ thread_id: string }>).map((r) => r.thread_id));
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

/**
 * KPI `ref` 글자 값을 (다시 열 때 한국어 이름으로 바꾼) 자료와 맞춘다 — 안전망 전에 저장된 답이 표는 '수학', KPI는 'math'로
 * 갈리지 않게(재리뷰 2026-11-06). settleReport가 처음에 한 일(ref = 그 칸 값)과 같은 뜻이라 글자 값만 다시 잇는다.
 */
export function kpiFromData(blocks: AssistantReport["blocks"], data: Datasets): AssistantReport["blocks"] {
  return blocks.map((b) =>
    b.type !== "kpi"
      ? b
      : {
          ...b,
          items: b.items.map((item) => {
            const v = item.ref ? data[item.ref.query]?.rows[item.ref.row]?.[item.ref.column] : undefined;
            return typeof v === "string" && v !== item.value ? { ...item, value: v } : item;
          }),
        },
  );
}

function toMessage(m: MessageRow, now: number, datasets: ReadonlyMap<string, Datasets>): ThreadMessage {
  // 멈춤을 누른 질문은 정리 중이어도 '멈춤'으로 보인다(도는 중으로 막지 않는다 · 적대 리뷰 2026-11-09).
  const stopped = m.status === "running" && !!m.cancel_requested_at;
  const running = m.status === "running" && !stopped && now - Date.parse(m.created_at) < RUNNING_MS;
  const data = datasets.get(m.id);
  const report: SettledReport | null =
    m.status === "done" && m.report_title !== null && Array.isArray(m.report_blocks)
      ? {
          title: m.report_title,
          blocks: data ? kpiFromData(m.report_blocks, data) : m.report_blocks,
          datasets: data ?? {},
          ...(data ? {} : { datasetsOmitted: true }),
          ...(m.report_coverage && Array.isArray(m.report_coverage.surveys) ? { coverage: m.report_coverage } : {}),
          ...(isCutShort(m.report_cut) ? { cutShort: m.report_cut } : {}),
        }
      : null;
  return {
    id: m.id,
    question: m.question,
    level: level(m.level),
    createdAt: m.created_at,
    report,
    error: m.status === "failed" ? m.error : stopped ? "질문을 멈췄습니다" : m.status === "running" && !running ? "답을 끝내지 못했습니다. 다시 물어봐 주세요" : null,
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
    .select("id, question, level, status, report_title:report->>title, report_blocks:report->blocks, report_coverage:report->coverage, report_cut:report->>cutShort, cancel_requested_at, error, queries, steps, created_at")
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
      // 코드 칸 한국어 이름 — 안전망(code-labels) 전에 저장된 답도 다시 열면 같은 이름으로(적대 리뷰 2026-11-06).
      datasets.set(id, labelDatasets(d));
    }
  }
  const now = Date.now();
  return {
    thread: { id: thread.id, title: thread.title, level: level(thread.level), updatedAt: thread.updated_at },
    messages: rows.map((m) => toMessage(m, now, datasets)),
  };
}

/**
 * 대화 지우기 — 🔴 아직 답을 만드는 질문(멈춤 안 누름 · 15분 안)이 있으면 지우지 않는다: 지우면 목록에서 사라져 멈출 화면이 없는 질문이
 * 동시 자리(3개)를 최대 13분 차지한다(적대 리뷰 2026-11-09). 화면도 도는 대화엔 x를 감추지만 다른 탭은 모를 수 있다.
 */
export async function deleteThread(owner: Owner, threadId: string): Promise<"ok" | "missing" | "running"> {
  if (await threadRunning(owner, threadId)) return "running";
  const { data, error } = await createAdminClient()
    .from(THREADS)
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", threadId)
    .eq("tenant_id", owner.tenantId)
    .eq("user_id", owner.userId)
    .is("deleted_at", null)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0 ? "ok" : "missing";
}

/** 대화 제목 길이 상한 — DB `assistant_threads.title` check(1~80자)와 같다. */
export const THREAD_TITLE_MAX = 80;

/**
 * 대화 이름 바꾸기(원장 2026-11-06 *"대화 이름 변경도 가능하게"*) — 본인 대화 · 지우지 않은 것만. 바뀐 이름을 돌려준다(없으면 null).
 * 목록 순서(updated_at)는 건드리지 않는다 — 이름만 고쳤는데 '오늘' 맨 위로 올라가지 않게.
 */
export async function renameThread(owner: Owner, threadId: string, title: string): Promise<string | null> {
  const clean = clipText(title.replace(/\s+/g, " ").trim(), THREAD_TITLE_MAX);
  if (!clean) return null;
  const { data, error } = await createAdminClient()
    .from(THREADS)
    .update({ title: clean })
    .eq("id", threadId)
    .eq("tenant_id", owner.tenantId)
    .eq("user_id", owner.userId)
    .is("deleted_at", null)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0 ? clean : null;
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

/** 동시에 만들 수 있는 답이 다 찼다(원장 2026-11-06 '동시에 3개까지'). */
export const BUSY_FULL_MESSAGE = `답은 동시에 ${ASSISTANT_MAX_RUNNING}개까지 만들 수 있습니다. 하나가 끝나면 물어봐 주세요`;
/** 이 대화에 아직 도는 질문이 있다 — 같은 대화는 앞 답을 알고 이어 답하도록 하나씩. */
export const BUSY_THREAD_MESSAGE = "이 대화는 아직 앞 질문의 답을 만드는 중입니다. 끝난 뒤 물어보거나 새 대화에서 물어봐 주세요";
const STALE_MESSAGE = "답을 끝내지 못했습니다. 다시 물어봐 주세요";

/** 막힌 까닭 — `busy`(자리 없음 · 같은 대화가 도는 중)는 실패가 아니라 '잠시 뒤' 안내다(화면이 글을 되돌려 놓는다). */
export type Admission = { error: string; code: "busy" | "day" };

/**
 * 하루 상한 · 겹친 질문 확인. 막히면 한국어 이유.
 * 먼저 함수가 죽어 남은 '도는 중'(RUNNING_MS — 15분 넘은 것)을 실패로 닫는다 — 자리 색인(s2_0033)이 영영 막히지 않게.
 * '멈춤'을 누른 질문은 마무리 중이어도 도는 것으로 세지 않는다(멈추고 바로 다시 물을 수 있게 · 적대 리뷰 2026-11-06).
 * 동시에 들어오는 경우는 이 확인이 아니라 고유 색인이 막는다(`startMessage` → "busy" · "busy_thread").
 */
export async function admission(owner: Owner, threadId: string | null | undefined, now = new Date()): Promise<Admission | null> {
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
    .select("status, created_at, cancel_requested_at, thread_id")
    .eq("tenant_id", owner.tenantId)
    .eq("user_id", owner.userId)
    .gte("created_at", kstDayStartIso(now))
    .order("created_at", { ascending: false })
    .limit(DAY_MAX);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ status: string; created_at: string; cancel_requested_at: string | null; thread_id: string }>;
  // 자정 전에 시작해 아직 도는 질문은 오늘 줄에 없다 — 빈 자리는 startMessage가 색인 조건으로 따로 센다(여기는 보통의 경우를 먼저 안내).
  const live = rows.filter((r) => r.status === "running" && !r.cancel_requested_at && now.getTime() - Date.parse(r.created_at) < RUNNING_MS);
  if (threadId && live.some((r) => r.thread_id === threadId)) return { error: BUSY_THREAD_MESSAGE, code: "busy" };
  if (live.length >= ASSISTANT_MAX_RUNNING) return { error: BUSY_FULL_MESSAGE, code: "busy" };
  if (rows.length >= DAY_MAX) return { error: `오늘은 질문을 ${DAY_MAX}번 해서 더 물을 수 없습니다. 내일 다시 써 주세요`, code: "day" };
  return null;
}

const titleOf = (question: string) => clipText(question.replace(/\s+/g, " ").trim(), 40, "…");
const SLOTS = Array.from({ length: ASSISTANT_MAX_RUNNING }, (_, i) => i + 1);
/** 23505가 '대화마다 하나' 색인에서 났나(아니면 자리 색인 — 다음 자리를 해 본다). */
const threadClash = (e: { message?: string; details?: string }) => /running_thread_idx/.test(`${e.message ?? ""} ${e.details ?? ""}`);

/**
 * 대화(없으면 새로) + '도는 중' 메시지 한 줄. 대화가 없으면 "no_thread".
 * 자리(run_slot 1~3)는 비어 있는 것부터 넣어 보고, 고유 색인 23505면 다음 자리 — 다 차면 "busy", 같은 대화가 도는 중이면 "busy_thread".
 * 막히면 방금 만든 빈 대화는 지운다.
 */
export async function startMessage(
  owner: Owner,
  input: { threadId?: string | null; question: string; level: AssistantLevel; clientRef?: string | null },
): Promise<{ threadId: string; title: string; messageId: string; created: boolean } | "no_thread" | "busy" | "busy_thread"> {
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
  const dropThread = async () => {
    if (created) await db.from(THREADS).delete().eq("id", threadId).eq("tenant_id", owner.tenantId).eq("user_id", owner.userId);
  };
  // 지금 쓰는 자리 — 색인과 같은 조건(도는 중 · 멈춤 안 누름). 15분 넘은 줄은 admission이 방금 닫았다.
  const { data: usedRows, error: usedError } = await db
    .from(MESSAGES)
    .select("run_slot")
    .eq("tenant_id", owner.tenantId)
    .eq("user_id", owner.userId)
    .eq("status", "running")
    .is("cancel_requested_at", null);
  if (usedError) {
    await dropThread();
    throw new Error(usedError.message);
  }
  const used = new Set(((usedRows ?? []) as Array<{ run_slot: number | null }>).map((r) => r.run_slot));
  for (const slot of SLOTS.filter((n) => !used.has(n))) {
    const { data, error } = await db
      .from(MESSAGES)
      .insert({
        tenant_id: owner.tenantId,
        user_id: owner.userId,
        thread_id: threadId,
        question: input.question,
        level: input.level,
        status: "running",
        run_slot: slot,
        client_ref: input.clientRef ?? null,
      })
      .select("id")
      .single();
    if (!error) return { threadId, title, messageId: (data as { id: string }).id, created };
    if (error.code !== "23505") {
      await dropThread();
      throw new Error(error.message);
    }
    if (threadClash(error)) {
      await dropThread();
      return "busy_thread";
    }
    // 다른 탭이 방금 이 자리를 가져갔다 — 다음 자리.
  }
  await dropThread();
  return "busy";
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
    // 멈춤을 누른 질문은 정리 중이어도 도는 것으로 보지 않는다 — 서버는 바로 새 질문을 받는데 화면만 막히지 않게(적대 리뷰 2026-11-09).
    .is("cancel_requested_at", null)
    .gte("created_at", new Date(now.getTime() - RUNNING_MS).toISOString())
    .limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/**
 * 멈춤·마무리를 보낼 곳 — 질문 번호, 또는 번호를 받기 전이면 화면이 보낼 때 만든 번호(client_ref · s2_0033).
 * `latest` = 배포 전에 열린 옛 화면의 `/messages/current/stop`(그 화면은 한 번에 하나만 묻는다) — 가장 최근에 시작한 본인 질문 하나.
 */
export type MessageTarget = { messageId: string } | { clientRef: string } | { latest: true };

/** 도는 본인 질문 하나에 표시를 남긴다(도는 쪽이 2초마다 본다 — 다른 서버 인스턴스에서 돌아도 같다). 맞는 줄이 있었나. */
async function markRunning(owner: Owner, target: MessageTarget, patch: Record<string, string>): Promise<boolean> {
  const base = createAdminClient()
    .from(MESSAGES)
    .update(patch)
    .eq("tenant_id", owner.tenantId)
    .eq("user_id", owner.userId)
    .eq("status", "running");
  let q;
  if ("messageId" in target) q = base.eq("id", target.messageId);
  else if ("clientRef" in target) q = base.eq("client_ref", target.clientRef);
  else {
    const { data: last, error: lastError } = await createAdminClient()
      .from(MESSAGES)
      .select("id")
      .eq("tenant_id", owner.tenantId)
      .eq("user_id", owner.userId)
      .eq("status", "running")
      .is("cancel_requested_at", null)
      .order("created_at", { ascending: false })
      .limit(1);
    if (lastError) throw new Error(lastError.message);
    const id = (last as Array<{ id: string }> | null)?.[0]?.id;
    if (!id) return false;
    q = base.eq("id", id);
  }
  const { data, error } = await q.select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** '멈춤' — 질문을 버린다('질문을 멈췄습니다'로 저장). */
export function requestStop(owner: Owner, target: MessageTarget): Promise<boolean> {
  return markRunning(owner, target, { cancel_requested_at: new Date().toISOString() });
}

/** '여기서 끝내고 결과 보기'(원장 2026-11-06) — 더 조회하지 않고 지금까지의 결과로 보고서를 쓴다. */
export function requestWrap(owner: Owner, target: MessageTarget): Promise<boolean> {
  return markRunning(owner, target, { wrap_requested_at: new Date().toISOString() });
}

/** 도는 쪽이 2초마다 묻는다 — 멈춤 · 마무리 표시. 읽지 못하면 둘 다 아니다(다음 차례에 다시). */
export async function controlFlags(owner: Owner, messageId: string): Promise<{ cancel: boolean; wrap: boolean }> {
  const { data } = await createAdminClient()
    .from(MESSAGES)
    .select("cancel_requested_at, wrap_requested_at")
    .eq("id", messageId)
    .eq("tenant_id", owner.tenantId)
    .eq("user_id", owner.userId)
    .maybeSingle();
  const row = data as { cancel_requested_at: string | null; wrap_requested_at: string | null } | null;
  return { cancel: !!row?.cancel_requested_at, wrap: !!row?.wrap_requested_at };
}
