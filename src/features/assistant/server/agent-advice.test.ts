// 학원 비서 — 비서 의견의 확인 지표 기준값(제안 → 결과 → 학습 1단계 · 2026-11-09). 가짜 Claude · 가짜 DB.
// 🔴 보고서가 나온 뒤에는 답을 버리지 않는다 — 틀린 지표는 다시 쓰게 하지 않고 기준값 없이 넘긴다(적대 리뷰 2026-11-09).
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { CHECK_FAILED } from "../advice";
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

const CHECK = {
  label: "최근 14일 새 등록",
  sql: "select count(*) as 값 from students where created_at >= {{시작}} and created_at < {{끝}}",
  unit: "count",
  better: "up",
  windowDays: 14,
  checkAfterDays: 28,
};
const report = (...items: Array<Record<string, unknown>>) =>
  msg([tool("r", "render_report", { title: "t", blocks: [{ type: "summary", text: "s" }, { type: "advice", items: items.map((it) => ({ action: "a", why: "b", topic: "enrollment", ...it })) }] })]);

const dbWith = (run: AssistantDb["run"]): AssistantDb => ({
  views: async () => new Set(["students"]),
  describe: async (tables) => tables.map((t) => ({ table: t, columns: [{ name: "id", type: "uuid" }] })),
  run: vi.fn(run),
});

const base = (client: Pick<Anthropic, "messages">, db: AssistantDb, events: AgentEvent[] = [], signal?: AbortSignal) => ({
  client,
  model: "claude-sonnet-5-5",
  effort: "medium" as const,
  db,
  docs: [{ name: "students", label: "원생", ko: "원생 기본 정보", notes: "" }],
  question: "신규 등록 어때?",
  history: [],
  emit: (e: AgentEvent) => events.push(e),
  onUsage: vi.fn(),
  signal,
  // 한국 시각 2026-11-06 15:00 — 질문일 2026-11-06 → 기준값 기간 [10-21, 11-04)(갓 지난 이틀을 비운다).
  now: () => Date.parse("2026-11-06T06:00:00Z"),
});

const adviceItems = (out: Awaited<ReturnType<typeof runAssistantAgent>>) => {
  const block = out.report.blocks.find((b) => b.type === "advice");
  return block?.type === "advice" ? block.items : [];
};

describe("비서 의견 확인 지표 — 기준값", () => {
  it("[질문일 − 2일 − 기간, 질문일 − 2일)로 채워 같은 실행기로 잰다 · 보고서에서는 조회문을 뺀다", async () => {
    const db = dbWith(async () => ({ columns: ["값"], rows: [{ 값: 7 }], rowCount: 1, truncated: false, ms: 3 }));
    const events: AgentEvent[] = [];
    const { client } = fakeClient([report({ check: CHECK })]);
    const out = await runAssistantAgent(base(client, db, events));
    expect(out.askedOn).toBe("2026-11-06");
    expect(out.checks).toEqual([{ itemNo: 0, check: CHECK, baseline: { from: "2026-10-21", to: "2026-11-04", value: 7, sample: null } }]);
    const ran = vi.mocked(db.run).mock.calls[0]![0];
    expect(ran).toContain("'2026-10-21'");
    expect(ran).toContain("'2026-11-04'");
    expect(ran).not.toContain("{{");
    const step = events.map((e) => e.step).find((s) => s.label.startsWith("확인 지표 기준값") && s.state === "done");
    expect(step).toMatchObject({ kind: "report", detail: "기준값 7" });
    // 조회문 원문은 화면·대화 저장본으로 가지 않는다(의견 표에만)
    expect(adviceItems(out)[0]!.check).toBeUndefined();
    expect(JSON.stringify(out.report)).not.toContain("created_at");
  });

  it("틀린 지표는 다시 쓰게 하지 않는다 — 기준값 없이 넘기고 답은 그대로(AI 차례 한 번)", async () => {
    const db = dbWith(async () => ({ columns: ["값"], rows: [{ 값: 1 }, { 값: 2 }], rowCount: 2, truncated: false, ms: 3 }));
    const events: AgentEvent[] = [];
    const { client, calls } = fakeClient([report({ check: CHECK })]);
    const out = await runAssistantAgent(base(client, db, events));
    expect(calls).toHaveLength(1);
    expect(out.checks[0]).toMatchObject({ itemNo: 0, baseline: null });
    const step = events.map((e) => e.step).findLast((s) => s.label.startsWith("확인 지표 기준값"));
    // 막힌 단계로 세지 않는다(답은 성공 — '막힌 단계 N개'에 붙지 않게)
    expect(step).toMatchObject({ state: "done", detail: expect.stringMatching(/^재지 못해 확인 지표 없이 둡니다 — 결과가 2줄입니다/) });
  });

  it("쓸 수 없는 조회(보기 밖 표)는 실행하지 않는다", async () => {
    const db = dbWith(async () => ({ columns: ["값"], rows: [{ 값: 1 }], rowCount: 1, truncated: false, ms: 3 }));
    const bad = { ...CHECK, sql: "select count(*) as 값 from secrets where created_at >= {{시작}} and created_at < {{끝}}" };
    const { client } = fakeClient([report({ check: bad })]);
    const out = await runAssistantAgent(base(client, db));
    expect(db.run).not.toHaveBeenCalled();
    expect(out.checks[0]!.baseline).toBeNull();
  });

  it("지표 형식이 틀려도 보고서는 돌려보내지 않는다 — 그 지표만 빼고 까닭", async () => {
    const db = dbWith(async () => ({ columns: ["값"], rows: [{ 값: 1 }], rowCount: 1, truncated: false, ms: 3 }));
    const { client, calls } = fakeClient([report({ check: { ...CHECK, sql: "select 1 as 값" } }, { check: { ...CHECK, windowDays: 10 } })]);
    const out = await runAssistantAgent(base(client, db));
    expect(calls).toHaveLength(1);
    expect(out.checks).toEqual([]);
    expect(adviceItems(out).map((i) => i.noCheck)).toEqual([CHECK_FAILED, CHECK_FAILED]);
  });

  it("비율 지표는 표본이 있어야 하고 0~100이어야 한다", async () => {
    const db = dbWith(async () => ({ columns: ["값", "표본"], rows: [{ 값: "92.4", 표본: 120 }], rowCount: 1, truncated: false, ms: 3 }));
    const { client } = fakeClient([report({ check: { ...CHECK, unit: "percent" } })]);
    const out = await runAssistantAgent(base(client, db));
    expect(out.checks[0]!.baseline).toMatchObject({ value: 92.4, sample: 120 });
  });

  it("재는 도중 멈춤·기한 신호가 오면 남은 지표만 빼고 답은 돌려준다(버리지 않는다)", async () => {
    const stop = new AbortController();
    const db = dbWith(async () => {
      stop.abort();
      return { columns: ["값"], rows: [{ 값: 4 }], rowCount: 1, truncated: false, ms: 3 };
    });
    const { client } = fakeClient([report({ check: CHECK }, { check: { ...CHECK, label: "둘째" } })]);
    const out = await runAssistantAgent(base(client, db, [], stop.signal));
    expect(out.report.title).toBe("t");
    expect(out.checks.map((c) => c.baseline?.value ?? null)).toEqual([4, null]);
    expect(db.run).toHaveBeenCalledTimes(1);
  });
});
