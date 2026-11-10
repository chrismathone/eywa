// 비서 의견 처리 — '완료'를 누르면 재측정 기준일을 그 날로 다시 잡는다(제안 → 결과 → 학습 2단계 · 적대 리뷰 2026-11-09).
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const state: { current: Row | null; patches: Row[]; threadAlive: boolean } = { current: null, patches: [], threadAlive: true };

function builder(table: string) {
  let patch: Row | null = null;
  let insert = false;
  const api: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "returns", "in", "is"]) api[m] = () => api;
  api.update = (p: Row) => {
    patch = p;
    return api;
  };
  api.insert = () => {
    insert = true;
    return api;
  };
  const answer = () => {
    if (table === "assistant_advice_events" || insert) return { data: null, error: null };
    if (table === "assistant_threads") return { data: state.threadAlive ? { id: "t1" } : null, error: null };
    if (patch) {
      state.patches.push(patch);
      return { data: { id: "a1", message_id: "m1", item_no: 0, status: patch.status, status_at: "2026-11-20T01:00:00+00:00", measure_state: patch.measure_state ?? "waiting" }, error: null };
    }
    return { data: state.current, error: null };
  };
  api.maybeSingle = () => Promise.resolve(answer());
  api.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(answer()).then(res, rej);
  return api;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/report-error", () => ({ reportError: vi.fn(), reportWarning: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (t: string) => builder(t) }) }));

import { updateAdvice } from "./advice-store";

const owner = { tenantId: "00000000-0000-0000-0000-00000000000a", userId: "20000000-0000-0000-0000-000000000001" };
const base = { status: "open", status_at: "2026-11-09T06:00:00+00:00", done_on: null, check_sql: "select 1 as 값 where {{시작}} < {{끝}}", check_after_days: 14, baseline_to: "2026-11-07", measure_state: "waiting" };

beforeEach(() => {
  state.current = null;
  state.patches = [];
  state.threadAlive = true;
});

describe("updateAdvice — 지운 대화", () => {
  it("대화를 지웠으면(다른 탭에서) 처리하지 않는다 — 까닭 '지운 대화'", async () => {
    state.current = { ...base, thread_id: "t1" };
    state.threadAlive = false;
    expect(await updateAdvice(owner, "a1", { status: "adopted", statusAt: base.status_at })).toEqual({ ok: false, reason: "deleted" });
    expect(state.patches).toEqual([]);
  });
});

describe("updateAdvice — 완료하면 재측정 기준일을 다시 잡는다", () => {
  it("완료한 날부터 · 다시 잴 날 = 그 날 + checkAfterDays + 2 · 이미 잰 결과는 비운다", async () => {
    state.current = { ...base, measure_state: "measured" };
    const out = await updateAdvice(owner, "a1", { status: "done", statusAt: base.status_at, doneOn: "2026-11-20" });
    expect(out.ok).toBe(true);
    expect(state.patches[0]).toMatchObject({ status: "done", done_on: "2026-11-20", measure_anchor: "2026-11-20", next_check_on: "2026-12-06", measure_state: "waiting", latest_verdict: null, fail_count: 0 });
  });
  it("질문일보다 이른 완료일이면 기준일이 그대로(질문일)라 다시 잡지 않는다 · 처리 전 ↔ 완료 왕복(같은 날)도 그대로", async () => {
    state.current = { ...base };
    await updateAdvice(owner, "a1", { status: "done", statusAt: base.status_at, doneOn: "2026-11-01" });
    expect(state.patches[0]).not.toHaveProperty("measure_anchor");
    state.patches = [];
    state.current = { ...base, status: "open", measure_anchor: "2026-11-20" };
    await updateAdvice(owner, "a1", { status: "done", statusAt: base.status_at, doneOn: "2026-11-20" });
    expect(state.patches[0]).not.toHaveProperty("measure_anchor");
  });
  it("이미 잰 결과가 완료일 뒤 기간이면 그 결과를 남긴다(평가를 남기려 완료를 눌러도)", async () => {
    state.current = { ...base, measure_state: "measured", latest_from: "2026-11-23" };
    await updateAdvice(owner, "a1", { status: "done", statusAt: base.status_at, doneOn: "2026-11-20" });
    expect(state.patches[0]).not.toHaveProperty("measure_anchor");
    expect(state.patches[0]).not.toHaveProperty("latest_verdict");
  });
  it("채택·보류 · 같은 완료일로 다시 저장(메모만) · 확인 지표 없음 · 다시 재지 못함이면 그대로", async () => {
    for (const [current, patch] of [
      [{ ...base }, { status: "adopted" as const }],
      [{ ...base, status: "done", done_on: "2026-11-20", measure_anchor: "2026-11-20" }, { status: "done" as const, doneOn: "2026-11-20", memo: "메모만" }],
      [{ ...base, check_sql: null }, { status: "done" as const, doneOn: "2026-11-20" }],
      [{ ...base, measure_state: "broken" }, { status: "done" as const, doneOn: "2026-11-20" }],
    ] as const) {
      state.current = current;
      state.patches = [];
      await updateAdvice(owner, "a1", { statusAt: base.status_at, ...patch });
      expect(state.patches[0]).not.toHaveProperty("measure_anchor");
    }
  });
});
