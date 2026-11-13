import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import type { Response, ResponseCreateParamsBase, ResponseOutputItem, ResponseStreamEvent, ResponseUsage } from "openai/resources/responses/responses";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assistantKeyEnv, createTerraClient, terraUsage } from "./terra-client";
import { runAssistantAgent } from "./agent";

const response = (output: ResponseOutputItem[], patch: Partial<Response> = {}) => ({ id: "resp1", model: "gpt-6.1-terra", status: "completed", output, usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 80 }, output_tokens: 30, output_tokens_details: { reasoning_tokens: 20 }, total_tokens: 130 }, ...patch }) as Response;
const call = (args = '{"purpose":"현재 원생","sql":"select 1"}') => ({ type: "function_call", id: "fc1", call_id: "call1", name: "run_sql", arguments: args, status: "completed" }) as const;
const params: Anthropic.MessageCreateParams = { model: "old-model", max_tokens: 32000, system: [{ type: "text", text: "고정 규칙", cache_control: { type: "ephemeral" } }], tools: [{ name: "run_sql", input_schema: { type: "object", properties: { sql: { type: "string" } } } }], messages: [{ role: "user", content: "원생 현황?" }] };
function fake(scripts: Array<{ response: Response; events?: ResponseStreamEvent[]; error?: Error }>) {
  const calls: Array<{ params: ResponseCreateParamsBase; signal?: AbortSignal }> = [];
  const stream = vi.fn((p: ResponseCreateParamsBase, options?: { signal?: AbortSignal }) => {
    calls.push({ params: p, signal: options?.signal });
    const script = scripts.shift()!;
    let listener: ((e: ResponseStreamEvent) => void) | undefined;
    return { on: (_event: string, cb: typeof listener) => { listener = cb; }, finalResponse: async () => {
      for (const event of script.events ?? []) listener?.(event);
      if (script.error) throw script.error;
      return script.response;
    } };
  });
  return { client: createTerraClient({ responses: { stream } } as unknown as Pick<OpenAI, "responses">), calls };
}
afterEach(() => vi.unstubAllEnvs());

describe("비서 전용 Terra low 연결", () => {
  it("실제 실행기에서 조회→잘못된 보고서→같은 Terra 재작성까지 도구 결과·대상을 이어 준다", async () => {
    const student = "11111111-1111-4111-8111-111111111111";
    const render = (args: string, id: string) => ({ ...call(args), id, call_id: id, name: "render_report" });
    const report = { title: "학생 명단", blocks: [
      { type: "summary", text: "현재 수학반과 담당을 확인했습니다." },
      { type: "table", title: "수학만 듣는 학생", query: "q1", columns: [{ column: "학생", label: "이름", link: { entity: "student", idColumn: "student_id" } }, ...["학교", "학년", "반", "담당"].map(column => ({ column, label: column }))] },
      { type: "advice", items: [{ action: "미배정 반의 담당을 정해 주세요", why: "A반의 현재 담당은 미배정입니다" }] },
    ] };
    const { client, calls } = fake([
      { response: response([call('{"purpose":"학생 명단","sql":"select id as student_id, name as 학생 from students"}')]) },
      { response: response([render('{"title":', "bad")]) },
      { response: response([render(JSON.stringify(report), "fixed")]) },
    ]);
    const out = await runAssistantAgent({ client, question: "수학만 듣는 학생 명단", history: [], docs: [], emit: () => {}, onUsage: () => {}, now: () => Date.parse("2026-11-13T01:00:00Z"), db: {
      views: async () => new Set(["students"]), describe: async () => [],
      run: async () => ({ columns: ["student_id", "학생", "학교", "학년", "반", "담당"], rows: [{ student_id: student, 학생: "민수", 학교: "가초", 학년: "초5", 반: "A반", 담당: "미배정" }], rowCount: 1, truncated: false, ms: 1 }),
    } });
    expect(calls).toHaveLength(3);
    expect(calls.every(c => c.params.model === "gpt-6.1-terra" && c.params.reasoning?.effort === "low")).toBe(true);
    expect(calls[2]!.params.input).toEqual(expect.arrayContaining([expect.objectContaining({ type: "function_call_output", call_id: "bad", output: expect.stringContaining("보고서를 고쳐") })]));
    expect(out.report.datasets.q1?.rows[0]?.student_id).toBe(student);
    expect(out.report.blocks[1]).toMatchObject({ type: "table", columns: expect.arrayContaining([{ column: "담당", label: "담당" }]) });
  });

  it("외부 모델/강도 대신 Terra low와 Responses 도구만 보내고 결과를 기존 실행기에 돌려준다", async () => {
    const { client, calls } = fake([{ response: response([call()]) }]);
    const out = await client.messages.stream({ ...params, output_config: { effort: "high" } }).finalMessage();
    expect(calls[0]!.params).toMatchObject({ model: "gpt-6.1-terra", reasoning: { effort: "low" }, instructions: "고정 규칙", store: false, include: ["reasoning.encrypted_content"], parallel_tool_calls: false, max_output_tokens: 32000 });
    expect(calls[0]!.params).not.toHaveProperty("effort");
    expect(calls[0]!.params.tools?.[0]).toMatchObject({ type: "function", name: "run_sql", strict: false });
    expect(out.content[0]).toMatchObject({ type: "tool_use", id: "call1", name: "run_sql", input: { purpose: "현재 원생", sql: "select 1" } });
    expect(out.stop_reason).toBe("tool_use");
  });

  it("암호화 reasoning·도구 호출과 결과를 같은 call_id로 다음 차례에 그대로 이어 준다", async () => {
    const opaque = { type: "reasoning", id: "rs1", summary: [], encrypted_content: "opaque-test-only" } as const;
    const output = [opaque, call()] as ResponseOutputItem[];
    const { client, calls } = fake([{ response: response(output) }, { response: response([]) }]);
    const first = await client.messages.stream(params).finalMessage();
    expect(first.content.some(b=>b.type === "thinking")).toBe(false);
    await client.messages.stream({ ...params, messages: [...params.messages, { role: "assistant", content: first.content }, { role: "user", content: [{ type: "tool_result", tool_use_id: "call1", content: '{"rows":1}' }, { type: "text", text: "이제 보고서" }] }] }).finalMessage();
    expect(calls[1]!.params.input).toEqual([{ role: "user", content: "원생 현황?" }, ...output, { type: "function_call_output", call_id: "call1", output: '{"rows":1}' }, { role: "user", content: "이제 보고서" }]);
  });

  it("도구 입력을 받는 동안 목적을 진행 줄에 전달하고 abort signal을 그대로 전달한다", async () => {
    const events = [{ type: "response.output_item.added", output_index: 0, item: { ...call(""), status: "in_progress" }, sequence_number: 1 }, { type: "response.function_call_arguments.delta", item_id: "fc1", output_index: 0, delta: '{"purpose":"현재 원생","sql":', sequence_number: 2 }, { type: "response.output_item.done", item: call(), output_index: 0, sequence_number: 3 }] as ResponseStreamEvent[];
    const { client, calls } = fake([{ response: response([call()]), events }]);
    const stop = new AbortController(), stream = client.messages.stream(params, { signal: stop.signal }), stages = vi.fn(), json = vi.fn();
    stream.on?.("streamEvent", stages); stream.on?.("inputJson", json);
    await stream.finalMessage();
    expect(calls[0]!.signal).toBe(stop.signal);
    expect(stages.mock.calls.map(c=>c[0].type)).toEqual(["content_block_start", "content_block_stop"]);
    expect(json).toHaveBeenCalledWith(expect.any(String), { purpose: "현재 원생" });
  });

  it("완료되지 않은 JSON도 실행기의 zod/보고서 재작성 검사로 넘기며 숫자나 내용을 복구해 지어내지 않는다", async () => {
    const { client } = fake([{ response: response([call('{"sql":')]) }]);
    expect((await client.messages.stream(params).finalMessage()).content[0]).toMatchObject({ type: "tool_use", input: '{"sql":' });
  });

  it("거절·출력 한도를 실행기에 알리고 실패를 정상 완료로 바꾸지 않는다", async () => {
    const refused: ResponseOutputItem = { type: "message", id: "m1", role: "assistant", status: "completed", content: [{ type: "refusal", refusal: "declined" }] };
    const { client } = fake([{ response: response([refused]) }, { response: response([], { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }) }, { response: response([], { status: "failed" }) }]);
    expect((await client.messages.stream(params).finalMessage()).stop_reason).toBe("refusal");
    expect((await client.messages.stream(params).finalMessage()).stop_reason).toBe("max_tokens");
    await expect(client.messages.stream(params).finalMessage()).rejects.toThrow("끝까지");
  });

  it("중도 오류에서 사용량이 제공됐으면 보존하고 다른 모델 결과는 거절한다", async () => {
    const failed = response([], { status: "failed" });
    const { client } = fake([{ response: failed, events: [{ type: "response.failed", response: failed, sequence_number: 1 }], error: new Error("transport") }, { response: response([], { model: "claude-sonnet-5-5" }) }]);
    const stream = client.messages.stream(params);
    await expect(stream.finalMessage()).rejects.toThrow("transport");
    expect(stream.currentMessage?.usage).toMatchObject({ input_tokens: 20, cache_read_input_tokens: 80, output_tokens: 30 });
    await expect(client.messages.stream(params).finalMessage()).rejects.toThrow("응답 모델");
  });

  it("캐시·추론을 이중 계상하지 않는다", () => {
    expect(terraUsage(response([]).usage as ResponseUsage)).toEqual({ input_tokens: 20, cache_read_input_tokens: 80, cache_creation_input_tokens: 0, output_tokens: 30 });
  });

  it("비서 전용 OpenAI 키를 우선하며 다른 회사 키를 사용하지 않는다", () => {
    vi.stubEnv("OPENAI_API_KEY_ASSISTANT", ""); vi.stubEnv("OPENAI_API_KEY", ""); vi.stubEnv("ANTHROPIC_API_KEY", "test-only");
    expect(assistantKeyEnv()).toBeNull();
    vi.stubEnv("OPENAI_API_KEY", "default-test-only"); expect(assistantKeyEnv()).toBe("OPENAI_API_KEY");
    vi.stubEnv("OPENAI_API_KEY_ASSISTANT", "assistant-test-only"); expect(assistantKeyEnv()).toBe("OPENAI_API_KEY_ASSISTANT");
  });
});
