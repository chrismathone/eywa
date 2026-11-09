// 비서 의견 결과 재측정(제안 → 결과 → 학습 2단계 · 2026-11-09) — 가짜 관리자 DB · 가짜 비서 실행기.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
type Call = { table: string; op: "select" | "update"; patch: Row | null; filters: Array<[string, string, unknown]> };
const state: { due: Row[]; threads: Row[]; calls: Call[]; staleIds: Set<string> } = { due: [], threads: [], calls: [], staleIds: new Set() };

/** 가짜 PostgREST 체인 — 거르는 조건을 모두 적어 두고(시험이 확인한다) 표·동작마다 정해진 답. */
function builder(table: string) {
  const c: Call = { table, op: "select", patch: null, filters: [] };
  const api: Record<string, unknown> = {};
  for (const m of ["select", "order", "limit", "returns"]) api[m] = () => api;
  for (const m of ["eq", "lte", "in"]) {
    api[m] = (col: string, v: unknown) => {
      c.filters.push([m, col, v]);
      return api;
    };
  }
  api.not = (col: string, op: string, v: unknown) => {
    c.filters.push(["not", col, `${op} ${v}`]);
    return api;
  };
  api.update = (patch: Row) => {
    c.op = "update";
    c.patch = patch;
    return api;
  };
  api.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
    state.calls.push(c);
    let out: unknown;
    if (table === "assistant_threads") out = { data: state.threads, error: null };
    else if (c.op === "update") {
      const id = c.filters.find(([, col]) => col === "id")?.[2] as string;
      out = { data: state.staleIds.has(id) ? [] : [{ id }], error: null };
    } else out = { data: state.due, error: null };
    return Promise.resolve(out).then(res, rej);
  };
  return api;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (t: string) => builder(t) }) }));

import { AssistantQueryError, type AssistantDb } from "./agent";
import { runAdviceOutcomes } from "./advice-outcomes";

const T = "00000000-0000-0000-0000-00000000000a";
const due = (over: Row = {}): Row => ({
  id: "a1",
  thread_id: "t1",
  check_sql: "select count(*) as 값 from students where created_at >= {{시작}} and created_at < {{끝}}",
  check_unit: "count",
  check_better: "up",
  window_days: 14,
  check_after_days: 28,
  baseline_from: "2026-10-24",
  baseline_to: "2026-11-07",
  baseline_value: "10",
  baseline_sample: null,
  measure_anchor: null,
  next_check_on: "2026-12-08",
  checks_done: 0,
  fail_count: 0,
  ...over,
});
const fakeDb = (run: AssistantDb["run"]) => ({ views: async () => new Set(["students"]), describe: async () => [], run: vi.fn(run), close: vi.fn(async () => undefined) });
const ok = (값: number) => ({ columns: ["값"], rows: [{ 값 }], rowCount: 1, truncated: false, ms: 2 });
const input = (db: ReturnType<typeof fakeDb>, over: Partial<Parameters<typeof runAdviceOutcomes>[0]> = {}) => ({
  tenantId: T,
  today: "2026-12-09",
  limit: 20,
  deadline: Date.parse("2026-12-09T00:00:00Z") + 60_000,
  holidays: new Set<string>(),
  openDb: vi.fn(async () => db),
  now: () => Date.parse("2026-12-09T00:00:00Z"),
  ...over,
});
const updates = () => state.calls.filter((c) => c.op === "update");

beforeEach(() => {
  state.due = [];
  state.threads = [{ id: "t1", deleted_at: null }];
  state.calls = [];
  state.staleIds = new Set();
});

describe("runAdviceOutcomes", () => {
  it("다시 잴 날이 된 기다림만 고른다(지점 · 확인 지표 · 기준값 있는 것)", async () => {
    await runAdviceOutcomes(input(fakeDb(async () => ok(1))));
    const pick = state.calls.find((c) => c.table === "assistant_advice" && c.op === "select")!;
    expect(pick.filters).toEqual(
      expect.arrayContaining([
        ["eq", "tenant_id", T],
        ["eq", "measure_state", "waiting"],
        ["lte", "next_check_on", "2026-12-09"],
        ["not", "check_sql", "is null"],
        ["not", "baseline_value", "is null"],
      ]),
    );
  });

  it("재측정 기간을 재어 저장된 기준값과 견준다 · 기준 기간도 같은 날 다시 재 흔들림만 본다", async () => {
    state.due = [due()];
    // 재측정 기간 [11-23, 12-07) → 30건 · 기준 기간 다시 [10-24, 11-07) → 11건(저장값 10 — 문턱 안)
    const db = fakeDb(async (sql) => ok(sql.includes("'2026-11-23'") ? 30 : 11));
    const tally = await runAdviceOutcomes(input(db));
    expect(tally).toMatchObject({ measured: 1, failed: 0 });
    const sqls = db.run.mock.calls.map((c) => c[0]);
    expect(sqls[0]).toContain("'2026-11-23'");
    expect(sqls[0]).toContain("'2026-12-07'");
    expect(sqls[1]).toContain("'2026-10-24'");
    expect(updates()[0]!.patch).toMatchObject({ measure_state: "measured", latest_verdict: "improved", latest_value: 30, latest_base: 11, latest_from: "2026-11-23", latest_to: "2026-12-07", latest_delta: 20, checks_done: 1, last_error: null });
    // 다른 실행이 먼저 바꿨거나 그 사이 원장이 기준일을 다시 잡은 줄은 덮지 않는다(기다림 · 읽은 다시 잴 날 · 지점 조건)
    expect(updates()[0]!.filters).toEqual(expect.arrayContaining([["eq", "tenant_id", T], ["eq", "measure_state", "waiting"], ["eq", "next_check_on", "2026-12-08"]]));
    expect(db.close).toHaveBeenCalled();
  });

  it("완료로 다시 잡은 기준일(measure_anchor)부터 잰다", async () => {
    state.due = [due({ measure_anchor: "2026-11-20", check_after_days: 14 })];
    const db = fakeDb(async (sql) => ok(sql.includes("'2026-11-20'") ? 30 : 10));
    await runAdviceOutcomes(input(db));
    expect(updates()[0]!.patch).toMatchObject({ latest_from: "2026-11-20", latest_to: "2026-12-04" });
  });

  it("늦은 입력으로 기준이 크게 바뀌었으면 판정 보류 · 휴원일 수가 다르면 판정 보류", async () => {
    state.due = [due(), due({ id: "a2" })];
    const db = fakeDb(async (sql) => ok(sql.includes("'2026-11-23'") ? 30 : 40));
    await runAdviceOutcomes(input(db, { holidays: new Set(["2026-11-25"]) }));
    expect(updates()[0]!.patch).toMatchObject({ latest_verdict: "unknown", latest_reason: expect.stringMatching(/^휴원일 수가 달라/) });
    state.calls = [];
    state.due = [due()];
    await runAdviceOutcomes(input(fakeDb(async (sql) => ok(sql.includes("'2026-11-23'") ? 30 : 40))));
    expect(updates()[0]!.patch).toMatchObject({ latest_verdict: "unknown", latest_reason: "늦게 들어온 기록으로 기준값이 바뀌어(10 → 40) 판정하지 않습니다" });
  });

  it("조회가 틀리면 다음 날 다시 — 세 번째면 '다시 재지 못함' · 기준은 다시 재지 않는다", async () => {
    state.due = [due(), due({ id: "a2", fail_count: 2 })];
    const db = fakeDb(async () => ({ columns: ["인원"], rows: [{ 인원: 1 }], rowCount: 1, truncated: false, ms: 2 }));
    const tally = await runAdviceOutcomes(input(db));
    expect(tally).toMatchObject({ failed: 1, broken: 1, measured: 0 });
    expect(db.run).toHaveBeenCalledTimes(2);
    expect(updates()[0]!.patch).toMatchObject({ fail_count: 1, next_check_on: "2026-12-10", last_error: expect.stringMatching(/^재측정 기간: 결과에 칸 '값'이 없습니다/) });
    expect(updates()[1]!.patch).toMatchObject({ fail_count: 3, measure_state: "broken" });
    expect(updates()[1]!.patch).not.toHaveProperty("next_check_on");
  });

  it("연결 문제는 세지 않는다 — 그 지점은 멈추고 아무 줄도 고치지 않는다(다음 날 그대로)", async () => {
    state.due = [due(), due({ id: "a2" })];
    const db = fakeDb(async () => {
      throw new AssistantQueryError("비서 DB 연결이 끊겼습니다", "ECONNRESET", "connection");
    });
    const tally = await runAdviceOutcomes(input(db));
    expect(tally).toMatchObject({ left: 2, failed: 0, measured: 0, paused: "비서 DB 연결이 끊겼습니다" });
    // 멈춘 줄에 까닭만 적는다(실패 셈·다시 잴 날은 그대로)
    expect(updates()).toHaveLength(1);
    expect(updates()[0]!.patch).toEqual({ last_error: "일시 문제(실패로 세지 않음): 비서 DB 연결이 끊겼습니다" });
    expect(db.close).toHaveBeenCalled();
  });

  it("조회 자체가 틀린 오류(kind query)는 실패로 센다", async () => {
    state.due = [due()];
    const db = fakeDb(async () => {
      throw new AssistantQueryError("조회가 8초를 넘었습니다", "57014", "query");
    });
    expect(await runAdviceOutcomes(input(db))).toMatchObject({ failed: 1, left: 0 });
    expect(updates()[0]!.patch).toMatchObject({ fail_count: 1, next_check_on: "2026-12-10", last_error: "재측정 기간: 조회가 8초를 넘었습니다" });
  });

  it("재측정 기간이 끝나고 이틀이 안 지났으면(맞지 않는 다시 잴 날) 재지 않는다", async () => {
    state.due = [due({ measure_anchor: "2026-12-01", check_after_days: 7, window_days: 7 })];
    const db = fakeDb(async () => ok(1));
    await runAdviceOutcomes(input(db));
    expect(db.run).not.toHaveBeenCalled();
    expect(updates()).toEqual([]);
  });

  it("지운 대화의 의견은 재지 않는다 · 잴 것이 없으면 비서 DB에 연결하지 않는다", async () => {
    state.due = [due()];
    state.threads = [{ id: "t1", deleted_at: "2026-11-20T00:00:00Z" }];
    const run = input(fakeDb(async () => ok(1)));
    expect(await runAdviceOutcomes(run)).toMatchObject({ stopped: 1, measured: 0 });
    expect(updates()[0]!.patch).toMatchObject({ measure_state: "stopped" });
    expect(run.openDb).not.toHaveBeenCalled();
  });

  it("다른 실행이 먼저 바꿔 0줄이면 세지 않는다 · 시간 예산을 넘으면 남은 의견은 다음 날로", async () => {
    state.due = [due()];
    state.staleIds = new Set(["a1"]);
    expect(await runAdviceOutcomes(input(fakeDb(async (sql) => ok(sql.includes("'2026-11-23'") ? 30 : 10))))).toMatchObject({ measured: 0 });
    state.calls = [];
    state.staleIds = new Set();
    state.due = [due(), due({ id: "a2" })];
    const db = fakeDb(async () => ok(5));
    expect(await runAdviceOutcomes(input(db, { deadline: 0 }))).toMatchObject({ left: 2, measured: 0 });
    expect(updates()).toEqual([]);
    expect(db.run).not.toHaveBeenCalled();
  });
});
