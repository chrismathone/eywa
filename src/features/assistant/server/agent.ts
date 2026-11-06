/**
 * 학원 비서 AI 루프 — Claude가 `describe_table`·`run_sql`로 이 지점 DB를 확인하고 `render_report`로 보고서를 낸다.
 * DB·Claude 클라이언트·이벤트는 밖에서 받는다(시험이 가짜를 넣는다). 권한·라이선스·저장·사용량 장부는 부르는 쪽(`ask.ts`) 몫.
 *
 * - 진행 단계(`step` 이벤트)를 실시간으로 내보낸다 — 원장 *"진짜 Ai 대화하는것처럼 어떤 db를 조회중이고 어떤 프로그레스중인지 단계가 표시"*.
 *   AI가 도구 입력을 쓰기 시작하는 순간(스트림의 content_block_start) 단계를 열고, 입력이 들어오는 대로(inputJson) 목적을 붙인다.
 * - 대화 기록은 덧붙이기만 한다(이전 차례의 응답 블록을 고치거나 빼지 않는다 — 생각 블록이 그 대화에 묶여 있다).
 * - 도구 입력은 즉시 스트리밍(`eager_input_streaming`)이라 서버가 검증하지 않는다 → 여기서 zod로 검증하고, 틀리면 오류 결과로 돌려준다.
 * - 조회는 한 연결에서 차례로(병렬 도구 호출도 순서대로 실행).
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { REPORT_TOOL_SCHEMA, settleReport, type QueryResult, type SettledReport } from "../report";
import type { AskStep, StepKind, StepTable } from "../protocol";
import type { AssistantTableDoc } from "../catalog/types";
import { clipText } from "../text";
import { checkAssistantSql } from "./sql-gate";
import { buildSystemPrompt, catalogLines, pastAnswerText, questionMessage, type PastTurn } from "./prompt";

export const MAX_ROUNDS = 14;
export const MAX_QUERIES = 12;
/**
 * 이 시간이 지나면 더 조회하지 말고 보고서를 내라고 하고, 그 뒤의 조회·표 구조 요청은 실행하지 않는다.
 * 고정 기한(250초 — 부르는 쪽이 signal로 끊는다 · protocol.ts ASSISTANT_HARD_DEADLINE_MS)과 따로 둔 '마무리' 시각.
 */
export const SOFT_DEADLINE_MS = 150_000;
const AI_ROWS = 200;
const AI_CELL_CHARS = 1000;
const AI_RESULT_CHARS = 20_000;

export class AssistantError extends Error {}
/** 조회 실패 — `message`는 화면(한국어), `detail`은 AI에게 줄 원문(칸 이름 등 고칠 단서). */
export class AssistantQueryError extends Error {
  constructor(
    message: string,
    readonly detail: string,
  ) {
    super(message);
  }
}

export type Row = Record<string, string | number | boolean | null>;
export type AssistantDb = {
  /** 비서가 읽을 수 있는 보기 이름(이 지점 · 비밀 칸을 뺀). */
  views(): Promise<ReadonlySet<string>>;
  describe(tables: string[]): Promise<Array<{ table: string; columns: Array<{ name: string; type: string }> }>>;
  /** 검사를 통과한 SQL을 읽기 전용으로 돌린다. 실패는 `AssistantQueryError`(또는 한국어 Error)로 던진다. */
  run(sql: string): Promise<{ columns: string[]; rows: Row[]; rowCount: number; truncated: boolean; ms: number }>;
};

export type AgentEvent = { type: "step"; step: AskStep };
export type AgentUsage = { model: string; usage: Anthropic.Usage };

export type AgentInput = {
  client: Pick<Anthropic, "messages">;
  model: string;
  effort: "low" | "medium" | "high";
  db: AssistantDb;
  docs: readonly AssistantTableDoc[];
  question: string;
  history: readonly PastTurn[];
  emit: (event: AgentEvent) => void;
  onUsage: (entry: AgentUsage) => Promise<void> | void;
  signal?: AbortSignal;
  now?: () => number;
};

export type AgentResult = { report: SettledReport; queries: QueryResult[] };

const DescribeInput = z.object({ tables: z.array(z.string().min(1)).min(1).max(6) });
const RunSqlInput = z.object({ purpose: z.string().trim().min(1).max(80), sql: z.string().min(1) });

export const ASSISTANT_TOOLS: Anthropic.Tool[] = [
  {
    name: "describe_table",
    description: "보기(표)의 칸 이름·타입과 읽는 법을 본다. SQL을 쓰기 전에 쓸 표마다 먼저 확인한다. 한 번에 6개까지.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: { tables: { type: "array", items: { type: "string" }, description: "보기 이름(예: students)" } },
      required: ["tables"],
    },
  },
  {
    name: "run_sql",
    description:
      "이 지점 DB를 SELECT 한 문장으로 조회한다(읽기 전용 · 8초 · 2,000행까지 저장, 200행까지 보임). 결과에는 조회 번호(q1, q2…)가 붙는다 — 보고서의 차트·표가 이 번호를 가리킨다. purpose를 sql보다 먼저 쓴다(원장 화면의 진행 단계에 바로 뜬다).",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        purpose: { type: "string", description: "이 조회로 알고 싶은 것 — 짧은 한국어(원장 화면의 진행 단계와 근거에 보인다)" },
        sql: { type: "string", description: "SELECT 문 하나" },
      },
      required: ["purpose", "sql"],
    },
  },
  {
    name: "render_report",
    description: "최종 답을 보고서 블록으로 낸다(한 번만 · 비서 의견 advice 블록 하나 포함). 차트·표는 query에 조회 번호를 쓰고 칸 이름으로 가리킨다.",
    eager_input_streaming: true,
    input_schema: REPORT_TOOL_SCHEMA as Anthropic.Tool.InputSchema,
  },
];

function clip(value: unknown): unknown {
  return typeof value === "string" ? clipText(value, AI_CELL_CHARS, "…(잘림)") : value;
}

/** AI에게 보낼 조회 결과(행·셀·전체 길이를 줄인다). */
export function resultForModel(r: QueryResult): string {
  let rows = r.rows.slice(0, AI_ROWS).map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, clip(v)])));
  const note = () =>
    rows.length < r.rowCount || r.truncated
      ? `전체 ${r.truncated ? `${r.rowCount}행 이상` : `${r.rowCount}행`} 중 ${rows.length}행만 보입니다 — 필요하면 집계하거나 조건을 좁히세요. 표·차트는 저장된 전체(최대 2,000행)로 그립니다.`
      : undefined;
  let body = JSON.stringify({ query: r.id, columns: r.columns, rows, row_count: r.rowCount, note: note() });
  while (body.length > AI_RESULT_CHARS && rows.length > 1) {
    rows = rows.slice(0, Math.max(1, Math.floor(rows.length / 2)));
    body = JSON.stringify({ query: r.id, columns: r.columns, rows, row_count: r.rowCount, note: note() });
  }
  return body;
}

function describeText(docs: readonly AssistantTableDoc[], found: Awaited<ReturnType<AssistantDb["describe"]>>, asked: string[], views: ReadonlySet<string>) {
  const out = asked.map((name) => {
    const live = found.find((f) => f.table === name);
    if (!live || !views.has(name)) {
      const near = [...views].filter((v) => v.includes(name) || name.includes(v)).slice(0, 8);
      return { table: name, error: `없는 보기입니다${near.length ? ` — 비슷한 이름: ${near.join(", ")}` : ""}` };
    }
    const doc = docs.find((d) => d.name === name);
    return {
      table: name,
      ko: doc?.ko,
      notes: doc?.notes,
      columns: live.columns.map((c) => ({ name: c.name, type: c.type, ...(doc?.columns?.[c.name] ? { ko: doc.columns[c.name] } : {}) })),
    };
  });
  return JSON.stringify(out);
}

/** 보고서 대신 글로 끝났을 때 — 글을 요약 블록 하나로. */
function textOnlyReport(text: string): SettledReport {
  return { title: "답변", blocks: [{ type: "summary", text: clipText(text, 800) }], datasets: {} };
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}초`;
const TOOL_STEP: Record<string, { kind: StepKind; label: string }> = {
  describe_table: { kind: "schema", label: "쓸 표를 고르는 중" },
  run_sql: { kind: "write_sql", label: "조회문을 쓰는 중" },
  render_report: { kind: "report", label: "보고서와 비서 의견을 쓰는 중" },
};

export async function runAssistantAgent(input: AgentInput): Promise<AgentResult> {
  const now = input.now ?? Date.now;
  const started = now();
  const docByName = new Map(input.docs.map((d) => [d.name, d]));
  const tableChip = (name: string): StepTable => ({ name, label: docByName.get(name)?.label ?? name });

  // ── 진행 단계 ──
  let seq = 0;
  const steps = new Map<string, AskStep>();
  const put = (step: AskStep) => {
    steps.set(step.id, step);
    input.emit({ type: "step", step });
  };
  const open = (kind: StepKind, label: string, extra: Partial<AskStep> = {}): string => {
    const id = `s${++seq}`;
    put({ id, kind, label, state: "running", at: now() - started, ...extra });
    return id;
  };
  const update = (id: string, patch: Partial<AskStep>) => {
    const prev = steps.get(id);
    if (prev && prev.state === "running") put({ ...prev, ...patch });
  };
  const close = (id: string, patch: Partial<AskStep> = {}) => {
    const prev = steps.get(id);
    if (!prev || prev.state !== "running") return;
    put({ ...prev, state: "done", ms: now() - started - prev.at, ...patch });
  };

  const views = await input.db.views();
  if (views.size === 0) throw new AssistantError("조회할 수 있는 자료가 없습니다. 비서 DB 설정을 확인해 주세요");
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: buildSystemPrompt(catalogLines(input.docs, views)), cache_control: { type: "ephemeral" } },
  ];
  const messages: Anthropic.MessageParam[] = [];
  for (const turn of input.history) {
    messages.push({ role: "user", content: turn.question }, { role: "assistant", content: pastAnswerText(turn) });
  }
  messages.push({ role: "user", content: questionMessage(input.question, new Date(now())) });

  const queries: QueryResult[] = [];
  const byId = new Map<string, QueryResult>();
  let jsonRetries = 0;
  let askedForReport = false;
  let reportFailed = false;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (input.signal?.aborted) throw new AssistantError("질문을 멈췄습니다");
    const thinking = open(round === 0 ? "understand" : "analyze", round === 0 ? "질문을 이해하는 중" : "결과를 살펴보는 중");
    /** 이번 차례에 열린 도구 단계(content_block 순서 = 응답의 tool_use 순서). */
    const toolSteps: Array<{ name: string; stepId: string }> = [];
    let currentTool: { name: string; stepId: string } | null = null;

    const stream = input.client.messages.stream(
      {
        model: input.model,
        max_tokens: 32_000,
        thinking: { type: "adaptive" },
        output_config: { effort: input.effort },
        // 대화 기록(앞 차례의 조회 결과 — 각 최대 2만 자) 캐시 — 마지막 블록에 표시가 자동으로 붙는다. 시스템 앞부분은 위에서 따로 캐시.
        cache_control: { type: "ephemeral" },
        system,
        tools: ASSISTANT_TOOLS,
        messages,
      },
      { signal: input.signal },
    );
    if (typeof stream.on === "function") {
      stream.on("streamEvent", (event) => {
        if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
          close(thinking);
          const name = event.content_block.name;
          const spec = name === "render_report" && reportFailed ? { kind: "fix" as const, label: "보고서를 고쳐 다시 쓰는 중" } : TOOL_STEP[name];
          if (!spec) return;
          currentTool = { name, stepId: open(spec.kind, spec.label) };
          toolSteps.push(currentTool);
        } else if (event.type === "content_block_stop") {
          currentTool = null;
        }
      });
      stream.on("inputJson", (_partial, snapshot) => {
        const tool = currentTool;
        if (!tool || !snapshot || typeof snapshot !== "object") return;
        const s = snapshot as { purpose?: unknown; tables?: unknown };
        if (tool.name === "run_sql" && typeof s.purpose === "string" && s.purpose.trim()) {
          update(tool.stepId, { label: `조회문을 쓰는 중 · ${clipText(s.purpose.trim(), 80)}` });
        } else if (tool.name === "describe_table" && Array.isArray(s.tables)) {
          const names = s.tables.filter((t): t is string => typeof t === "string" && views.has(t));
          if (names.length) update(tool.stepId, { tables: names.map(tableChip) });
        }
      });
    }

    let message: Anthropic.Message;
    try {
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (error) {
      for (const t of toolSteps) close(t.stepId, { state: "error", detail: "AI 응답을 끝까지 받지 못했습니다" });
      close(thinking);
      // 끝까지 못 받은 차례도 쓴 토큰은 적는다(멈춤·끊김·도구 입력 JSON 재시도 — 적대 리뷰 2026-11-06).
      const partial = stream.currentMessage;
      if (partial?.usage) await input.onUsage({ model: partial.model || input.model, usage: partial.usage });
      if (error instanceof Anthropic.APIError || jsonRetries++ >= 2) throw error;
      continue; // 도구 입력 JSON을 끝까지 읽지 못한 차례 — 다시 묻는다
    }
    close(thinking);
    await input.onUsage({ model: message.model || input.model, usage: message.usage });

    if (message.stop_reason === "refusal") throw new AssistantError("AI가 이 질문에는 답하지 않았습니다. 질문을 바꿔 다시 물어봐 주세요");
    if (message.stop_reason === "max_tokens") throw new AssistantError("답이 너무 길어 끊겼습니다. 질문을 나눠서 물어봐 주세요");

    const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0) {
      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (!askedForReport) {
        askedForReport = true;
        messages.push({ role: "assistant", content: message.content }, { role: "user", content: "render_report 도구로 답을 보고서로 내 주세요." });
        continue;
      }
      if (text) return { report: textOnlyReport(text), queries };
      throw new AssistantError("AI가 답을 내지 못했습니다. 잠시 뒤 다시 물어봐 주세요");
    }

    // 스트림 이벤트가 없던 경우(시험 · 끊긴 스트림)에도 도구마다 단계 하나.
    const stepFor = toolUses.map((call, i) => {
      const seen = toolSteps[i];
      if (seen && seen.name === call.name) return seen.stepId;
      const spec = call.name === "render_report" && reportFailed ? { kind: "fix" as const, label: "보고서를 고쳐 다시 쓰는 중" } : (TOOL_STEP[call.name] ?? { kind: "analyze" as const, label: call.name });
      return open(spec.kind, spec.label);
    });

    messages.push({ role: "assistant", content: message.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    const reportCalls: Array<{ call: Anthropic.ToolUseBlock; stepId: string }> = [];
    for (const [i, call] of toolUses.entries()) {
      if (call.name === "render_report") {
        reportCalls.push({ call, stepId: stepFor[i]! });
        continue;
      }
      results.push(await runTool(call, stepFor[i]!));
    }
    for (const { call, stepId } of reportCalls) {
      const settled = settleReport(call.input, byId);
      if (settled.ok) {
        close(stepId, { label: "보고서 · 비서 의견 작성", detail: `블록 ${settled.report.blocks.length}개` });
        return { report: settled.report, queries };
      }
      reportFailed = true;
      close(stepId, { state: "error", label: "보고서 확인", detail: "조회 결과와 맞지 않는 곳이 있어 고칩니다" });
      results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: `보고서를 고쳐 다시 내 주세요:\n${settled.errors.join("\n")}` });
    }
    const wrapUp = round >= MAX_ROUNDS - 2 || queries.length >= MAX_QUERIES || now() - started > SOFT_DEADLINE_MS;
    messages.push({
      role: "user",
      content: wrapUp ? [...results, { type: "text", text: "이제 더 조회하지 말고 지금까지의 결과로 render_report를 호출하세요." }] : results,
    });
  }
  throw new AssistantError("조회를 너무 많이 해서 멈췄습니다. 질문을 좁혀 다시 물어봐 주세요");

  async function runTool(call: Anthropic.ToolUseBlock, stepId: string): Promise<Anthropic.ToolResultBlockParam> {
    const fail = (content: string): Anthropic.ToolResultBlockParam => ({ type: "tool_result", tool_use_id: call.id, is_error: true, content });
    if ((call.name === "describe_table" || call.name === "run_sql") && now() - started > SOFT_DEADLINE_MS) {
      close(stepId, { state: "error", detail: "시간이 다 돼 더 조회하지 않습니다" });
      return fail("시간이 다 됐습니다. 더 조회하지 말고 지금까지의 결과로 render_report를 호출하세요.");
    }
    if (call.name === "describe_table") {
      const parsed = DescribeInput.safeParse(call.input);
      if (!parsed.success) {
        close(stepId, { state: "error", detail: "표 이름을 읽지 못했습니다" });
        return fail(`INVALID_INPUT: tables는 보기 이름 1~6개입니다 — ${clipText(JSON.stringify(call.input), 300)}`);
      }
      const asked = [...new Set(parsed.data.tables)];
      const known = asked.filter((t) => views.has(t));
      let found: Awaited<ReturnType<AssistantDb["describe"]>>;
      try {
        found = await input.db.describe(known);
      } catch {
        // 일시적인 DB 오류로 질문 전체를 버리지 않는다 — 이 도구만 실패로 돌려준다(적대 리뷰 2026-11-06).
        close(stepId, { state: "error", detail: "표 구조를 읽지 못했습니다" });
        return fail("표 구조를 읽지 못했습니다(일시 오류). 한 번 더 시도하거나, 이미 아는 칸으로 조회하세요.");
      }
      close(stepId, { label: "표 구조 확인", tables: known.map(tableChip), detail: `${known.length}개` });
      return { type: "tool_result", tool_use_id: call.id, content: describeText(input.docs, found, asked, views) };
    }
    if (call.name === "run_sql") {
      const parsed = RunSqlInput.safeParse(call.input);
      if (!parsed.success) {
        close(stepId, { state: "error", detail: "조회문을 읽지 못했습니다" });
        return fail(`INVALID_INPUT: purpose·sql이 필요합니다 — ${clipText(JSON.stringify(call.input), 300)}`);
      }
      const purpose = parsed.data.purpose;
      if (queries.length >= MAX_QUERIES) {
        close(stepId, { state: "error", label: `조회문 작성 · ${purpose}`, detail: `조회는 질문당 ${MAX_QUERIES}번까지` });
        return fail(`조회는 질문당 ${MAX_QUERIES}번까지입니다. 지금까지의 결과로 render_report를 호출하세요.`);
      }
      let gate: Awaited<ReturnType<typeof checkAssistantSql>>;
      try {
        gate = await checkAssistantSql(parsed.data.sql, views);
      } catch {
        // 검사기(wasm) 로드 실패 등 — 검사하지 못한 조회는 돌리지 않고 이 도구만 실패로 돌려준다.
        close(stepId, { state: "error", label: `조회문 작성 · ${purpose}`, detail: "조회문을 검사하지 못했습니다" });
        return fail("조회문을 검사하지 못했습니다(일시 오류). 같은 조회를 한 번 더 시도하세요.");
      }
      if (!gate.ok) {
        close(stepId, { state: "error", label: `조회문 작성 · ${purpose}`, detail: `쓸 수 없는 조회라 고칩니다 — ${gate.reason}` });
        return fail(`조회를 실행하지 않았습니다: ${gate.reason}`);
      }
      close(stepId, { label: `조회문 작성 · ${purpose}` });
      const id = `q${queries.length + 1}`;
      const queryStep = open("query", `조회 ${queries.length + 1} · ${purpose}`, { tables: gate.tables.map(tableChip) });
      try {
        const out = await input.db.run(gate.sql);
        const result: QueryResult = { id, purpose, sql: gate.sql, ...out };
        queries.push(result);
        byId.set(id, result);
        close(queryStep, { detail: `${out.truncated ? `${out.rowCount}행 이상` : `${out.rowCount}행`} · ${seconds(out.ms)}` });
        return { type: "tool_result", tool_use_id: call.id, content: resultForModel(result) };
      } catch (error) {
        const shown = error instanceof Error ? error.message : "조회 오류";
        const forModel = error instanceof AssistantQueryError ? `${error.message} — ${error.detail}` : shown;
        close(queryStep, { state: "error", detail: shown });
        return fail(`조회 오류: ${forModel}`);
      }
    }
    close(stepId, { state: "error", detail: "모르는 도구" });
    return fail(`모르는 도구입니다: ${call.name}`);
  }
}
