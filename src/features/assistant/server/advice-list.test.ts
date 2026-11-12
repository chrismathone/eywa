// '지난 의견' 읽기 — 본인 의견만 · 지운 대화 제외 · 전건 페이징(제안 → 결과 → 학습 3단계 첫 조각 · 2026-11-10).
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
type Call = { table: string; filters: Array<[string, ...unknown[]]>; range: [number, number] | null; select: string };
const state: { advice: Row[]; threads: Row[]; calls: Call[] } = { advice: [], threads: [], calls: [] };

function builder(table: string) {
  const call: Call = { table, filters: [], range: null, select: "" };
  state.calls.push(call);
  const api: Record<string, unknown> = {};
  api.select = (s: string) => ((call.select = s), api);
  for (const m of ["eq", "is", "order"]) api[m] = (...args: unknown[]) => (call.filters.push([m, ...args]), api);
  api.range = (from: number, to: number) => ((call.range = [from, to]), api);
  api.returns = () => api;
  api.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
    const all = table === "assistant_advice" ? state.advice : state.threads;
    const [from, to] = call.range ?? [0, all.length - 1];
    return Promise.resolve({ data: all.slice(from, to + 1), error: null }).then(res, rej);
  };
  return api;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/report-error", () => ({ reportError: vi.fn(), reportWarning: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (t: string) => builder(t) }) }));

import { listAdvice } from "./advice-list";

const owner = { tenantId: "00000000-0000-0000-0000-00000000000a", userId: "20000000-0000-0000-0000-000000000001" };
const row = (id: string, threadId: string, over: Row = {}): Row => ({
  id,
  message_id: `m-${threadId}`,
  thread_id: threadId,
  item_no: 0,
  status: "open",
  status_at: "2026-11-09T06:00:00+00:00",
  measure_state: "none",
  no_check_reason: "확인 지표를 받지 못했습니다",
  action: `의견 ${id}`,
  why: "근거",
  created_at: "2026-11-09T05:00:00+00:00",
  ...over,
});

beforeEach(() => {
  state.advice = [];
  state.threads = [];
  state.calls = [];
});

describe("listAdvice", () => {
  it("본인·이 지점 의견만 · 지운(목록에 없는) 대화의 의견은 뺀다 · 제목이 비면 '제목 없는 대화'", async () => {
    state.advice = [row("a1", "t1"), row("a2", "t-deleted"), row("a3", "t2")];
    state.threads = [
      { id: "t1", title: "학생 감소 원인" },
      { id: "t2", title: "  " },
    ];
    const items = await listAdvice(owner, ["master"]);
    expect(items.map((i) => [i.view.id, i.threadTitle, i.action])).toEqual([
      ["a1", "학생 감소 원인", "의견 a1"],
      ["a3", "제목 없는 대화", "의견 a3"],
    ]);
    const adviceCall = state.calls.find((c) => c.table === "assistant_advice")!;
    expect(adviceCall.filters).toEqual(expect.arrayContaining([["eq", "tenant_id", owner.tenantId], ["eq", "asked_by", owner.userId], ["order", "id"]]));
    // 조회문 원문(check_sql)은 읽지 않는다
    expect(adviceCall.select).not.toMatch(/check_sql/);
    const threadCall = state.calls.find((c) => c.table === "assistant_threads")!;
    expect(threadCall.filters).toEqual(expect.arrayContaining([["eq", "tenant_id", owner.tenantId], ["eq", "user_id", owner.userId], ["is", "deleted_at", null]]));
  });

  it("1,000줄을 넘어도 끝까지 읽는다(침묵 절단 없음)", async () => {
    state.threads = [{ id: "t1", title: "긴 대화" }];
    state.advice = Array.from({ length: 1_203 }, (_, i) => row(`a${i}`, "t1"));
    expect(await listAdvice(owner, ["master"])).toHaveLength(1_203);
    expect(state.calls.filter((c) => c.table === "assistant_advice").length).toBeGreaterThan(1);
  });
});
