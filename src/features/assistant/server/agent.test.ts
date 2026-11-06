// 학원 비서 AI 루프 — 가짜 Claude · 가짜 DB로 차례 흐름을 본다.
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { runAssistantAgent, type AgentEvent, type AssistantDb } from "./agent";

type Block = Record<string, unknown>;
const msg = (content: Block[], stop: string = "tool_use") =>
  ({ id: "m", model: "claude-sonnet-5-5", role: "assistant", content, stop_reason: stop, usage: { input_tokens: 10, output_tokens: 5 } }) as unknown as Anthropic.Message;
const tool = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input });

function fakeClient(script: Anthropic.Message[]) {
  const calls: Anthropic.MessageCreateParams[] = [];
  const client = {
    messages: {
      stream: vi.fn((params: Anthropic.MessageCreateParams) => {
        calls.push(structuredClone(params));
        const next = script.shift();
        return { finalMessage: async () => next ?? msg([{ type: "text", text: "끝" }], "end_turn") };
      }),
    },
  } as unknown as Pick<Anthropic, "messages">;
  return { client, calls };
}

const db: AssistantDb = {
  views: async () => new Set(["students"]),
  describe: async (tables) => tables.map((t) => ({ table: t, columns: [{ name: "id", type: "uuid" }, { name: "status", type: "text" }] })),
  run: vi.fn(async () => ({ columns: ["상태", "인원"], rows: [{ 상태: "재원", 인원: 31 }], rowCount: 1, truncated: false, ms: 4 })),
};

const base = (client: Pick<Anthropic, "messages">, events: AgentEvent[] = []) => ({
  client,
  model: "claude-sonnet-5-5",
  effort: "medium" as const,
  db,
  docs: [{ name: "students", label: "원생", ko: "원생 기본 정보", notes: "status: active=재원" }],
  question: "재원생 몇 명?",
  history: [],
  emit: (e: AgentEvent) => events.push(e),
  onUsage: vi.fn(),
  now: () => Date.parse("2026-11-06T06:00:00Z"),
});

describe("runAssistantAgent", () => {
  it("표 확인 → 조회 → 보고서(KPI ref는 조회 값)", async () => {
    const events: AgentEvent[] = [];
    const { client, calls } = fakeClient([
      msg([tool("t1", "describe_table", { tables: ["students"] })]),
      msg([tool("t2", "run_sql", { purpose: "상태별 인원", sql: "select status as 상태, count(*) as 인원 from students group by 1;" })]),
      msg([
        tool("t3", "render_report", {
          title: "재원생",
          blocks: [
            { type: "summary", text: "재원생은 31명입니다." },
            { type: "kpi", items: [{ label: "재원생", value: 30, ref: { query: "q1", row: 0, column: "인원" } }] },
            { type: "table", title: "상태별", query: "q1", columns: [{ column: "상태", label: "상태" }, { column: "인원", label: "인원" }] },
            { type: "advice", items: [{ action: "다음 달도 같은 기준으로 보기", why: "추이를 이어 보려면" }] },
          ],
        }),
      ]),
    ]);
    const input = base(client, events);
    const r = await runAssistantAgent(input);
    expect(r.queries.map((q) => q.sql)).toEqual(["select status as 상태, count(*) as 인원 from students group by 1"]);
    expect(r.report.blocks[1]).toMatchObject({ items: [{ value: 31 }] });
    expect(Object.keys(r.report.datasets)).toEqual(["q1"]);
    expect(input.onUsage).toHaveBeenCalledTimes(3);
    // 오늘 날짜는 질문 메시지에, 시스템 프롬프트는 차례마다 같다(캐시)
    expect(JSON.stringify(calls[0]!.messages.at(-1))).toContain("2026-11-06(금)");
    expect(calls[1]!.system).toEqual(calls[0]!.system);
    expect(JSON.stringify(calls[0]!.system)).not.toContain("2026-11-06");
    // 대화는 덧붙이기만 — 두 번째 요청의 앞부분이 첫 요청 그대로
    expect(calls[1]!.messages.slice(0, calls[0]!.messages.length)).toEqual(calls[0]!.messages);
    // 진행 단계 — 같은 id의 마지막 모습만 보면: 이해 → 표 확인 → 결과 살펴보기 → 조회문 → 조회(표 칩 · 행 수) → … → 보고서
    const last = new Map(events.map((e) => [e.step.id, e.step]));
    const final = [...last.values()];
    expect(final.every((st) => st.state === "done")).toBe(true);
    expect(final.map((st) => st.kind)).toEqual(["understand", "schema", "analyze", "write_sql", "query", "analyze", "report"]);
    expect(final.find((st) => st.kind === "schema")).toMatchObject({ label: "표 구조 확인", tables: [{ name: "students", label: "원생" }] });
    expect(final.find((st) => st.kind === "query")).toMatchObject({ label: "조회 1 · 상태별 인원", tables: [{ name: "students", label: "원생" }], detail: "1행 · 0.0초" });
    expect(final.at(-1)).toMatchObject({ kind: "report", label: "보고서 · 비서 의견 작성" });
  });

  it("스트림 중에 단계를 연다 — 도구 입력을 쓰기 시작하면 '조회문을 쓰는 중', 목적이 들어오면 그 목적을 붙인다", async () => {
    const events: AgentEvent[] = [];
    let listeners: Record<string, (...a: unknown[]) => void> = {};
    const script = [
      msg([tool("t1", "run_sql", { purpose: "재원생 수", sql: "select count(*) as 재원생 from students" })]),
      msg([tool("t2", "render_report", { title: "t", blocks: [{ type: "summary", text: "31명" }, { type: "advice", items: [{ action: "다음 달도 같은 기준으로 보기", why: "추이를 이어 보려면" }] }] })]),
    ];
    const seenDuringStream: string[] = [];
    const client = {
      messages: {
        stream: () => {
          listeners = {};
          const next = script.shift()!;
          const stream = {
            on: (name: string, fn: (...a: unknown[]) => void) => ((listeners[name] = fn), stream),
            finalMessage: async () => {
              const block = next.content[0] as unknown as { name: string; input: unknown };
              listeners.streamEvent?.({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "x", name: block.name, input: {} } });
              seenDuringStream.push(events.at(-1)!.step.label);
              listeners.inputJson?.("", { purpose: "재원생 수" });
              seenDuringStream.push(events.at(-1)!.step.label);
              listeners.streamEvent?.({ type: "content_block_stop", index: 0 });
              return next;
            },
          };
          return stream;
        },
      },
    } as unknown as Pick<Anthropic, "messages">;
    await runAssistantAgent(base(client, events));
    expect(seenDuringStream.slice(0, 2)).toEqual(["조회문을 쓰는 중", "조회문을 쓰는 중 · 재원생 수"]);
    expect(seenDuringStream[2]).toBe("보고서와 비서 의견을 쓰는 중");
  });

  it("검사에 걸린 SQL은 돌리지 않고 이유를 돌려준다", async () => {
    const run = vi.mocked(db.run);
    run.mockClear();
    const { client, calls } = fakeClient([
      msg([tool("t1", "run_sql", { purpose: "몰래", sql: "select set_config('assistant.nonce','x',true)" })]),
      msg([tool("t2", "render_report", { title: "t", blocks: [{ type: "summary", text: "조회할 수 없었습니다." }, { type: "advice", items: [{ action: "다음 달도 같은 기준으로 보기", why: "추이를 이어 보려면" }] }] })]),
    ]);
    await runAssistantAgent(base(client));
    expect(run).not.toHaveBeenCalled();
    const results = calls[1]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
    expect(results[0]).toMatchObject({ is_error: true });
    expect(String(results[0]!.content)).toMatch(/set_config/);
  });

  it("보고서가 없는 조회를 가리키면 고쳐 내라고 돌려보낸다", async () => {
    const { client, calls } = fakeClient([
      msg([tool("t1", "render_report", { title: "t", blocks: [{ type: "chart", kind: "bar", title: "a", query: "q1", x: "x", series: [{ column: "y", label: "y" }] }] })]),
      msg([tool("t2", "render_report", { title: "t", blocks: [{ type: "summary", text: "고쳤습니다." }, { type: "advice", items: [{ action: "다음 달도 같은 기준으로 보기", why: "추이를 이어 보려면" }] }] })]),
    ]);
    const r = await runAssistantAgent(base(client));
    expect(String((calls[1]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0]!.content)).toMatch(/q1가 없습니다/);
    expect(r.report.blocks[0]).toEqual({ type: "summary", text: "고쳤습니다." });
  });

  it("글로만 답하면 한 번 보고서를 청하고, 그래도 글이면 요약 한 블록", async () => {
    const { client, calls } = fakeClient([msg([{ type: "text", text: "재원생은 31명입니다." }], "end_turn"), msg([{ type: "text", text: "31명입니다." }], "end_turn")]);
    const r = await runAssistantAgent(base(client));
    expect(JSON.stringify(calls[1]!.messages.at(-1))).toContain("render_report");
    expect(r.report.blocks).toEqual([{ type: "summary", text: "31명입니다." }]);
  });

  it("대화 기록도 캐시한다(요청 최상위 cache_control) · 시스템 앞부분은 따로", async () => {
    const { client, calls } = fakeClient([msg([{ type: "text", text: "31명" }], "end_turn"), msg([{ type: "text", text: "31명" }], "end_turn")]);
    await runAssistantAgent(base(client));
    expect((calls[0] as unknown as { cache_control?: unknown }).cache_control).toEqual({ type: "ephemeral" });
    expect((calls[0]!.system as Anthropic.TextBlockParam[])[0]!.cache_control).toEqual({ type: "ephemeral" });
  });

  it("표 구조 조회가 실패해도 질문 전체를 버리지 않고 그 도구만 실패로 돌려준다", async () => {
    const { client, calls } = fakeClient([
      msg([tool("t1", "describe_table", { tables: ["students"] })]),
      msg([tool("t2", "render_report", { title: "t", blocks: [{ type: "summary", text: "s" }, { type: "advice", items: [{ action: "a", why: "b" }] }] })]),
    ]);
    const broken: AssistantDb = { ...db, describe: async () => Promise.reject(new Error("connection reset")) };
    const r = await runAssistantAgent({ ...base(client), db: broken });
    expect(r.report.title).toBe("t");
    const results = calls[1]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
    expect(results[0]).toMatchObject({ tool_use_id: "t1", is_error: true });
    expect(String(results[0]!.content)).toMatch(/표 구조를 읽지 못했습니다/);
  });

  it("마무리 시각(150초)이 지나면 조회를 실행하지 않고 보고서를 내라고 돌려준다", async () => {
    const run = vi.mocked(db.run);
    run.mockClear();
    let t = Date.parse("2026-11-06T06:00:00Z");
    // 두 번째 차례의 보고서 — 첫 차례(늦은 조회)는 아래 mockImplementationOnce가 낸다.
    const { client, calls } = fakeClient([
      msg([tool("t2", "render_report", { title: "t", blocks: [{ type: "summary", text: "s" }, { type: "advice", items: [{ action: "a", why: "b" }] }] })]),
    ]);
    const input = { ...base(client), now: () => t };
    // 첫 응답을 받는 사이 160초가 흘렀다.
    vi.mocked(client.messages.stream).mockImplementationOnce(((params: Anthropic.MessageCreateParams) => {
      calls.push(structuredClone(params));
      const next = msg([tool("t1", "run_sql", { purpose: "늦은 조회", sql: "select count(*) as n from students" })]);
      return { finalMessage: async () => ((t += 160_000), next) };
    }) as never);
    await runAssistantAgent(input);
    expect(run).not.toHaveBeenCalled();
    const results = calls[1]!.messages.at(-1)!.content as Array<Anthropic.ToolResultBlockParam | Anthropic.TextBlockParam>;
    expect(results[0]).toMatchObject({ type: "tool_result", is_error: true });
    expect(JSON.stringify(results)).toMatch(/시간이 다 됐습니다/);
  });

  it("끝까지 못 받은 차례(도구 입력 JSON 깨짐)도 쓴 토큰을 적고 다시 묻는다", async () => {
    let n = 0;
    const client = {
      messages: {
        stream: () => {
          n += 1;
          if (n === 1) return { currentMessage: msg([]), finalMessage: async () => Promise.reject(new SyntaxError("bad json")) };
          return { finalMessage: async () => msg([tool("t2", "render_report", { title: "t", blocks: [{ type: "summary", text: "s" }, { type: "advice", items: [{ action: "a", why: "b" }] }] })]) };
        },
      },
    } as unknown as Pick<Anthropic, "messages">;
    const input = base(client);
    await runAssistantAgent(input);
    expect(input.onUsage).toHaveBeenCalledTimes(2);
  });

  it("거절(refusal)·잘림(max_tokens)은 한국어 오류", async () => {
    await expect(runAssistantAgent(base(fakeClient([msg([], "refusal")]).client))).rejects.toThrow(/답하지 않았습니다/);
    await expect(runAssistantAgent(base(fakeClient([msg([], "max_tokens")]).client))).rejects.toThrow(/끊겼습니다/);
  });
});
