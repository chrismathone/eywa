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

  it("마무리 시각(여기선 150초)이 지나면 조회를 실행하지 않고 보고서를 내라고 돌려준다", async () => {
    const run = vi.mocked(db.run);
    run.mockClear();
    let t = Date.parse("2026-11-06T06:00:00Z");
    // 두 번째 차례의 보고서 — 첫 차례(늦은 조회)는 아래 mockImplementationOnce가 낸다.
    const { client, calls } = fakeClient([
      msg([tool("t2", "render_report", { title: "t", blocks: [{ type: "summary", text: "s" }, { type: "advice", items: [{ action: "a", why: "b" }] }] })]),
    ]);
    const input = { ...base(client), now: () => t, softDeadlineMs: 150_000 };
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

  it("조회 횟수 한도는 없다 · 읽은 분량이 많으면(입력 15만 토큰 초과) 그때 마무리를 부탁한다(원장 2026-11-06 '한도 두지마')", async () => {
    const run = vi.mocked(db.run);
    run.mockClear();
    const sqlCall = (id: string) => tool(id, "run_sql", { purpose: `조회 ${id}`, sql: "select count(*) as n from students" });
    // 조회 20번(옛 한도 12번을 넘는다) — 모두 실행된다.
    const many = Array.from({ length: 20 }, (_, i) => msg([sqlCall(`q${i}`)]));
    const big = msg([sqlCall("big")]);
    (big as unknown as { usage: Anthropic.Usage }).usage = { input_tokens: 2_000, cache_read_input_tokens: 160_000, output_tokens: 5 } as Anthropic.Usage;
    const { client, calls } = fakeClient([
      ...many,
      big,
      msg([sqlCall("after")]),
      msg([tool("r", "render_report", { title: "t", blocks: [{ type: "summary", text: "s" }, { type: "advice", items: [{ action: "a", why: "b" }] }] })]),
    ]);
    await runAssistantAgent(base(client));
    // 20번 모두 실행 · 분량이 넘은 차례(big)부터는 실행하지 않고 마무리를 부탁한다
    expect(run).toHaveBeenCalledTimes(20);
    const afterBig = calls.at(-2)!.messages.at(-1)!.content as Array<Anthropic.ToolResultBlockParam | Anthropic.TextBlockParam>;
    expect(JSON.stringify(afterBig)).toMatch(/읽은 자료가 많아/);
    const last = calls.at(-1)!.messages.at(-1)!.content as Array<Anthropic.ToolResultBlockParam | Anthropic.TextBlockParam>;
    expect(last[0]).toMatchObject({ type: "tool_result", is_error: true });
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

  it("마무리 시각이 차례 도중에 오면 쓰던 응답(다음 조회)을 끊고 기록에 넣지 않은 채 곧장 보고서를 부탁한다(적대 리뷰 2026-11-09)", async () => {
    const calls: Anthropic.MessageCreateParams[] = [];
    let n = 0;
    const client = {
      messages: {
        stream: (params: Anthropic.MessageCreateParams, opts?: { signal?: AbortSignal }) => {
          calls.push(structuredClone(params));
          n += 1;
          if (n === 1) {
            // 끝나지 않는 응답 — 마무리 시각(30ms)에 끊긴다
            return { finalMessage: () => new Promise((_, reject) => opts?.signal?.addEventListener("abort", () => reject(new Error("aborted")))) };
          }
          return { finalMessage: async () => msg([tool("r", "render_report", { title: "t", blocks: [{ type: "summary", text: "s" }, { type: "advice", items: [{ action: "a", why: "b" }] }] })]) };
        },
      },
    } as unknown as Pick<Anthropic, "messages">;
    const events: AgentEvent[] = [];
    const r = await runAssistantAgent({ ...base(client, events), now: Date.now, softDeadlineMs: 30 });
    expect(r.report.title).toBe("t");
    expect(calls).toHaveLength(2);
    // 끊은 응답은 기록에 없다 — 둘째 요청도 사람 차례 하나(질문)에 마무리 부탁이 덧붙었다(앞 블록은 그대로 — 캐시 접두가 같다)
    expect(calls[1]!.messages).toHaveLength(1);
    const first = calls[0]!.messages[0]!.content;
    const second = calls[1]!.messages[0]!.content as Anthropic.TextBlockParam[];
    expect(second[0]).toMatchObject({ type: "text", text: typeof first === "string" ? first : (first[0] as Anthropic.TextBlockParam).text });
    expect(second.at(-1)!.text).toMatch(/시간이 다 됐습니다/);
    const last = [...new Map(events.map((e) => [e.step.id, e.step])).values()];
    expect(last.some((st) => st.label === "지금까지 조회한 내용으로 보고서를 쓰는 중")).toBe(true);
  });

  it("'적음'처럼 분량 기준을 낮게 주면(contextWrapTokens) 그 앞에서 마무리한다", async () => {
    const sqlCall = (id: string) => tool(id, "run_sql", { purpose: `조회 ${id}`, sql: "select count(*) as n from students" });
    const mid = msg([sqlCall("mid")]);
    (mid as unknown as { usage: Anthropic.Usage }).usage = { input_tokens: 2_000, cache_read_input_tokens: 98_000, output_tokens: 5 } as Anthropic.Usage;
    const { client, calls } = fakeClient([mid, msg([tool("r", "render_report", { title: "t", blocks: [{ type: "summary", text: "s" }, { type: "advice", items: [{ action: "a", why: "b" }] }] })])]);
    await runAssistantAgent({ ...base(client), contextWrapTokens: 95_000 });
    expect(JSON.stringify(calls[1]!.messages.at(-1)!.content)).toMatch(/읽은 자료가 많아/);
  });

  it("보고서를 쓰기 시작한 응답은 마무리 시각이 와도 끊지 않는다(그게 곧 결과다)", async () => {
    let n = 0;
    const client = {
      messages: {
        stream: (_p: unknown, opts?: { signal?: AbortSignal }) => {
          n += 1;
          const listeners: Record<string, (...a: unknown[]) => void> = {};
          const stream = {
            on: (name: string, fn: (...a: unknown[]) => void) => ((listeners[name] = fn), stream),
            finalMessage: () =>
              new Promise((resolve, reject) => {
                opts?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
                // 보고서 도구를 쓰기 시작한 뒤 마무리 시각(20ms)이 지나고, 그 뒤에 끝난다
                listeners.streamEvent?.({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "r", name: "render_report", input: {} } });
                setTimeout(
                  () => resolve(msg([tool("r", "render_report", { title: "끝까지 쓴 보고서", blocks: [{ type: "summary", text: "s" }, { type: "advice", items: [{ action: "a", why: "b" }] }] })])),
                  60,
                );
              }),
          };
          return stream;
        },
      },
    } as unknown as Pick<Anthropic, "messages">;
    const r = await runAssistantAgent({ ...base(client), now: Date.now, softDeadlineMs: 20 });
    expect(n).toBe(1);
    expect(r.report.title).toBe("끝까지 쓴 보고서");
  });

  describe("전수 조회(survey_entity)", () => {
    const T = "20000000-0000-4000-8000-000000000001";
    const C = "30000000-0000-4000-8000-000000000001";
    const COLS: Record<string, Array<{ name: string; type: string }>> = {
      attendance_records: [{ name: "id", type: "uuid" }, { name: "class_id", type: "uuid" }, { name: "taught_by", type: "uuid" }, { name: "session_date", type: "date" }],
      video_homework_marks: [{ name: "id", type: "uuid" }, { name: "class_id", type: "uuid" }, { name: "homework_date", type: "date" }],
      classes: [{ name: "id", type: "uuid" }, { name: "teacher_id", type: "uuid" }],
      users: [{ name: "id", type: "uuid" }, { name: "display_name", type: "text" }],
      onto_class_teachers: [{ name: "class_id", type: "uuid" }, { name: "teacher_id", type: "uuid" }],
    };
    const surveyDb = (opts: { self: Array<Record<string, string | number>>; classes?: string[] }) => {
      const sqls: string[] = [];
      const sdb: AssistantDb = {
        views: async () => new Set(["students", "classes", "users", "onto_class_teachers", "attendance_records", "video_homework_marks"]),
        describe: async (tables) => tables.map((t) => ({ table: t, columns: COLS[t] ?? [{ name: "id", type: "uuid" }] })),
        run: vi.fn(async (sql: string) => {
          sqls.push(sql);
          if (/ as 이름/.test(sql)) return { columns: [], rows: opts.self, rowCount: opts.self.length, truncated: false, ms: 1 };
          if (/ as 반수 /.test(sql)) return { columns: ["반수"], rows: [{ 반수: (opts.classes ?? []).length }], rowCount: 1, truncated: false, ms: 1 };
          if (/ as 표/.test(sql)) {
            const keys = [...sql.matchAll(/select '([a-z0-9_@반]+)'::text as 표/g)].map((m) => m[1]!);
            return { columns: ["표"], rows: keys.map((k) => ({ 표: k, 전체: 4, 기간: 2, 최근: "2026-11-01" })), rowCount: keys.length, truncated: false, ms: 1 };
          }
          return { columns: ["n"], rows: [{ n: 1 }], rowCount: 1, truncated: false, ms: 1 };
        }),
      };
      return { sdb, sqls };
    };
    const report = () => msg([tool("r", "render_report", { title: "t", blocks: [{ type: "summary", text: "s" }, { type: "advice", items: [{ action: "a", why: "b" }] }] })]);

    it("강사 — DB 이름으로 · 맡은 반을 거친 표(영상 숙제 검사)도 센다 · 그 뒤 조회만 '자세히 봄'", async () => {
      const { sdb, sqls } = surveyDb({ self: [{ 이름: "김윤하", 같은이름: 1 }], classes: [C] });
      const { client, calls } = fakeClient([
        msg([tool("s1", "survey_entity", { target: "teacher", id: T, name: "김 선생" })]),
        msg([tool("q1", "run_sql", { purpose: "영상 숙제 검사", sql: "select count(*) as n from video_homework_marks" })]),
        report(),
      ]);
      const r = await runAssistantAgent({ ...base(client), db: sdb });
      const result = JSON.stringify(calls[1]!.messages.at(-1)!.content);
      expect(result).toContain("강사 김윤하");
      expect(result).toContain("video_homework_marks(video_homework_marks(맡은 반)) · 맡은 반을 거쳐");
      expect(result).toContain("이 기간에 맡은(맡았던) 반 1개를 거친 자료도 셌다");
      // 맡은 반은 SQL 안에서 같은 조건으로 다시 고른다(반 id를 늘어놓지 않는다)
      expect(sqls.some((q) => q.startsWith("with taught_classes as") || q.includes("with taught_classes as"))).toBe(true);
      const cov = r.report.coverage!.surveys[0]!;
      expect(cov.name).toBe("김윤하");
      expect(cov.tables.find((t) => t.table === "video_homework_marks")!.examined).toBe(true);
      expect(cov.tables.find((t) => t.table === "attendance_records")!.examined).toBe(false);
    });

    it("대상 id가 그 종류의 표에 없으면 세지 않고 돌려보낸다(모든 표 0건 → '자료 없음'으로 보고하지 않게)", async () => {
      const { sdb, sqls } = surveyDb({ self: [] });
      const { client, calls } = fakeClient([msg([tool("s1", "survey_entity", { target: "class", id: T, name: "PS3A" })]), report()]);
      await runAssistantAgent({ ...base(client), db: sdb });
      const result = calls[1]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
      expect(result[0]).toMatchObject({ is_error: true });
      expect(String(result[0]!.content)).toMatch(/대상을 찾지 못했습니다/);
      expect(sqls.some((q) => / as 표/.test(q))).toBe(false);
    });

    it("이름이 같은 강사가 있으면 이름 글자로 적힌 기록은 세지 않고 그렇게 알린다 · 없는 날짜는 받지 않는다", async () => {
      const { sdb } = surveyDb({ self: [{ 이름: "김윤하", 같은이름: 2 }], classes: [] });
      const { client, calls } = fakeClient([
        msg([
          tool("s1", "survey_entity", { target: "teacher", id: T, name: "김윤하" }),
          tool("s2", "survey_entity", { target: "class", id: C, name: "PS3A", from: "2026-02-01", to: "2026-02-29" }),
        ]),
        report(),
      ]);
      await runAssistantAgent({ ...base(client), db: sdb });
      const results = calls[1]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
      expect(String(results[0]!.content)).toContain("이름이 같은 사용자가 2명");
      expect(results[1]).toMatchObject({ is_error: true });
      expect(String(results[1]!.content)).toMatch(/INVALID_INPUT/);
    });
  });

  it("'바로 결과 보기'(원장 2026-11-06) — 조회 사이에 누르면 남은 조회는 하지 않고 다음 요청에 마무리 부탁 · 보고서에 cutShort", async () => {
    const events: AgentEvent[] = [];
    const run = vi.mocked(db.run);
    run.mockClear();
    const wrap = new AbortController();
    // 첫 조회가 도는 사이 원장이 누른다.
    run.mockImplementationOnce(async () => {
      wrap.abort();
      return { columns: ["n"], rows: [{ n: 1 }], rowCount: 1, truncated: false, ms: 3 };
    });
    const sqlCall = (id: string) => tool(id, "run_sql", { purpose: `조회 ${id}`, sql: "select count(*) as n from students" });
    const { client, calls } = fakeClient([
      msg([sqlCall("a"), sqlCall("b")]),
      msg([tool("r", "render_report", { title: "t", blocks: [{ type: "summary", text: "s" }, { type: "advice", items: [{ action: "a", why: "b" }] }] })]),
    ]);
    const r = await runAssistantAgent({ ...base(client, events), wrapSignal: wrap.signal });
    expect(run).toHaveBeenCalledTimes(1);
    expect(r.report.cutShort).toBe("user");
    const sent = calls[1]!.messages.at(-1)!.content as Array<Anthropic.ToolResultBlockParam | Anthropic.TextBlockParam>;
    expect(sent[1]).toMatchObject({ type: "tool_result", tool_use_id: "b", is_error: true });
    expect(JSON.stringify(sent)).toMatch(/원장님이 '여기서 끝내고 결과 보기'를 누르셨습니다/);
    const last = [...new Map(events.map((e) => [e.step.id, e.step])).values()];
    expect(last.find((st) => st.cause === "user")).toMatchObject({ state: "error", detail: "여기서 조회를 끝냈습니다" });
    expect(last.some((st) => st.label.startsWith("원장님 요청으로 여기서 조회를 끝냈습니다"))).toBe(true);
    expect(last.some((st) => st.label === "지금까지 조회한 내용으로 보고서를 쓰는 중")).toBe(true);
  });

  it("'바로 결과 보기' — AI가 다음 조회를 쓰는 중이면 그 응답을 버리고(기록에 넣지 않는다) 곧장 보고서를 부탁한다", async () => {
    const wrap = new AbortController();
    const calls: Anthropic.MessageCreateParams[] = [];
    let n = 0;
    const report = msg([tool("r", "render_report", { title: "t", blocks: [{ type: "summary", text: "s" }, { type: "advice", items: [{ action: "a", why: "b" }] }] })]);
    const client = {
      messages: {
        stream: (params: Anthropic.MessageCreateParams, opts?: { signal?: AbortSignal }) => {
          calls.push(structuredClone(params));
          n += 1;
          // 1) 조회 하나 → 2) 다음 조회를 쓰는 중에 원장이 누른다(끊긴다) → 3) 보고서
          if (n === 1) return { finalMessage: async () => msg([tool("q1", "run_sql", { purpose: "재원생", sql: "select count(*) as n from students" })]) };
          if (n === 2) {
            return {
              finalMessage: () =>
                new Promise((_, reject) => {
                  opts?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
                  setTimeout(() => wrap.abort(), 0);
                }),
            };
          }
          return { finalMessage: async () => report };
        },
      },
    } as unknown as Pick<Anthropic, "messages">;
    const r = await runAssistantAgent({ ...base(client), wrapSignal: wrap.signal });
    expect(r.report.cutShort).toBe("user");
    expect(calls).toHaveLength(3);
    // 버린 응답은 기록에 없다 — 셋째 요청도 둘째와 같은 차례 수이고, 마지막 사람 차례(조회 결과)에 마무리 부탁이 덧붙었다(앞 블록은 그대로).
    expect(calls[2]!.messages).toHaveLength(calls[1]!.messages.length);
    const before = calls[1]!.messages.at(-1)!.content as Anthropic.ContentBlockParam[];
    const after = calls[2]!.messages.at(-1)!.content as Anthropic.ContentBlockParam[];
    expect(after.slice(0, before.length)).toEqual(before);
    expect((after.at(-1) as Anthropic.TextBlockParam).text).toMatch(/원장님이 '여기서 끝내고 결과 보기'를 누르셨습니다/);
  });

  it("'바로 결과 보기'를 자료를 읽기 전에 누르면 끊지 않고 첫 자료를 읽은 뒤에 든다(근거 없는 보고서 금지 · 재리뷰 2026-11-09)", async () => {
    const wrap = new AbortController();
    wrap.abort(); // 다른 탭 버튼처럼 처음부터 눌린 채
    const { client, calls } = fakeClient([
      msg([tool("q1", "run_sql", { purpose: "재원생", sql: "select count(*) as n from students" })]),
      msg([tool("r", "render_report", { title: "t", blocks: [{ type: "summary", text: "s" }, { type: "advice", items: [{ action: "a", why: "b" }] }] })]),
    ]);
    const run = vi.mocked(db.run);
    run.mockClear();
    const r = await runAssistantAgent({ ...base(client), wrapSignal: wrap.signal });
    expect(run).toHaveBeenCalledTimes(1); // 첫 조회는 돌았다
    expect(JSON.stringify(calls[0]!.messages)).not.toMatch(/원장님이 '여기서 끝내고/); // 첫 요청엔 부탁이 없다
    expect(JSON.stringify(calls[1]!.messages.at(-1)!.content)).toMatch(/원장님이 '여기서 끝내고 결과 보기'를 누르셨습니다/);
    expect(r.report.cutShort).toBe("user");
  });

  it("'멈춤'(signal)은 여전히 질문째 끝낸다 — '바로 결과 보기'와 다르다", async () => {
    const stop = new AbortController();
    const client = {
      messages: {
        stream: (_p: unknown, opts?: { signal?: AbortSignal }) => ({
          finalMessage: () =>
            new Promise((_, reject) => {
              opts?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
              setTimeout(() => stop.abort(), 0);
            }),
        }),
      },
    } as unknown as Pick<Anthropic, "messages">;
    await expect(runAssistantAgent({ ...base(client), signal: stop.signal })).rejects.toThrow();
  });

  it("거절(refusal)·잘림(max_tokens)은 한국어 오류", async () => {
    await expect(runAssistantAgent(base(fakeClient([msg([], "refusal")]).client))).rejects.toThrow(/답하지 않았습니다/);
    await expect(runAssistantAgent(base(fakeClient([msg([], "max_tokens")]).client))).rejects.toThrow(/끊겼습니다/);
  });
});
