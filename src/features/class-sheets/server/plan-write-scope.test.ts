import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 계획 줄 쓰기의 **범위(날짜·교시) 잠금**.
 *
 * 🔴 왜 필요한가: 줄 id는 **반에만** 묶여 있다. 그래서 "오늘 그 교시"까지 좁혀서 문을 연 경로
 *    (비로그인 자리 PIN `/seat/jj`)가 범위를 안 넘기면, 통과한 사람이 id만 알면 그 반의 **지난 날짜
 *    계획 줄**을 고치거나 지울 수 있다 — 화면만 잠그고 액션은 열어 둔 꼴(#77)이고 게이트가 거짓말이 된다.
 * ⚠️ 반대로 로그인 ECS 경로는 애초에 **반 단위** 게이트라 범위를 안 넘긴다 — 그 동작은 그대로여야 한다.
 */

const TENANT = "11111111-1111-4111-8111-111111111111";
const CLASS = "c1111111-1111-4111-8111-111111111111";
const TODAY = "2026-08-25";
const SLOT = "16:00";

const TODAY_LINE = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const PAST_LINE = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb";
const OTHER_SLOT_LINE = "cccccccc-1111-4111-8111-cccccccccccc";

type Row = Record<string, unknown>;
const ROWS: Row[] = [
  { id: TODAY_LINE, tenant_id: TENANT, class_id: CLASS, plan_date: TODAY, slot_start: "16:00:00", progress: "오늘" },
  { id: PAST_LINE, tenant_id: TENANT, class_id: CLASS, plan_date: "2026-08-18", slot_start: "16:00:00", progress: "지난주" },
  { id: OTHER_SLOT_LINE, tenant_id: TENANT, class_id: CLASS, plan_date: TODAY, slot_start: "20:20:00", progress: "다른 교시" },
];

const updates: { id: unknown; patch: Row }[] = [];
const rpcCalls: { name: string; args: Row }[] = [];

/** 최소 PostgREST 흉내 — 체이닝 + thenable(`fetchInChunks`·`maybeSingle`이 그대로 쓴다). */
function makeBuilder() {
  const filters: { col: string; op: "eq" | "in" | "is"; val: unknown }[] = [];
  let patch: Row | null = null;
  const rows = () =>
    ROWS.filter((r) =>
      filters.every((f) =>
        f.op === "eq" ? r[f.col] === f.val : f.op === "is" ? r[f.col] == null : (f.val as unknown[]).includes(r[f.col]),
      ),
    );
  const api = {
    select: () => api,
    update: (p: Row) => ((patch = p), api),
    eq: (col: string, val: unknown) => (filters.push({ col, op: "eq", val }), api),
    in: (col: string, val: unknown[]) => (filters.push({ col, op: "in", val }), api),
    is: (col: string) => (filters.push({ col, op: "is", val: null }), api),
    order: () => api,
    maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
    then: (ok: (v: { data: Row[]; error: null }) => unknown, err?: (e: unknown) => unknown) => {
      const found = rows();
      if (patch) for (const r of found) updates.push({ id: r.id, patch: patch! });
      return Promise.resolve({ data: found, error: null }).then(ok, err);
    },
  };
  return api;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => makeBuilder(),
    rpc: (name: string, args: Row) => {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: [], error: null });
    },
  }),
}));

const { applyPlanPatches, relocatePlanLine, removePlanLine } = await import("./plan-write");

const GRANT = { tenantId: TENANT, classId: CLASS, actorId: null };
const SCOPE = { planDate: TODAY, slotStart: SLOT };

// CAS라 expectedValue가 실제 서버값과 같아야 갱신된다(픽스처의 현재 progress를 그대로 싣는다).
const patch = (lineId: string) => [
  {
    lineId,
    field: "progress",
    expectedValue: ROWS.find((r) => r.id === lineId)!.progress as string,
    newValue: "새 값",
    saveKey: `${lineId}:progress`,
    clientRev: 1,
  },
];

beforeEach(() => {
  updates.length = 0;
  rpcCalls.length = 0;
});

describe("계획 줄 쓰기 범위 잠금", () => {
  it("범위 안 줄은 그대로 저장된다", async () => {
    const r = await applyPlanPatches(GRANT, patch(TODAY_LINE), SCOPE);
    expect(r.ok).toBe(true);
    expect(updates).toHaveLength(1);
    // 공개 PIN 경로의 작성자는 null(계정 없는 사람을 이름 붙이지 않는다).
    expect(updates[0]!.patch.updated_by).toBeNull();
  });

  it("🔴 범위 밖(지난 날짜) 줄이 섞이면 배치를 통째로 거부한다", async () => {
    const r = await applyPlanPatches(GRANT, patch(PAST_LINE), SCOPE);
    expect(r).toEqual({ ok: false, error: "다른 날짜·교시의 행이 섞여 있어 저장을 거부했습니다" });
    expect(updates).toHaveLength(0);
  });

  it("🔴 범위 밖(다른 교시) 줄이 섞여도 거부한다 — 같은 날이라도", async () => {
    const r = await applyPlanPatches(GRANT, patch(OTHER_SLOT_LINE), SCOPE);
    expect(r.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("범위를 안 넘기는 로그인 경로는 종전대로 반 단위다(회귀 금지)", async () => {
    const r = await applyPlanPatches(GRANT, patch(PAST_LINE));
    expect(r.ok).toBe(true);
    expect(updates).toHaveLength(1);
  });

  it("🔴 지난 날짜 줄 삭제는 '없는 줄'이 아니라 거절이다(멱등 성공으로 위장하면 안 된다)", async () => {
    const r = await removePlanLine(GRANT, { lineId: PAST_LINE }, SCOPE);
    expect(r).toEqual({ ok: false, error: "이 교시의 행이 아닙니다" });
    expect(rpcCalls).toHaveLength(0);
  });

  it("🔴 지난 날짜 줄 이동도 거절한다", async () => {
    const r = await relocatePlanLine(GRANT, { lineId: PAST_LINE, termMode: "exam", lineNo: 1 }, SCOPE);
    expect(r).toEqual({ ok: false, error: "이 교시의 행이 아닙니다" });
    expect(rpcCalls).toHaveLength(0);
  });

  it("범위 안 줄은 삭제·이동이 실제 RPC로 간다", async () => {
    expect((await removePlanLine(GRANT, { lineId: TODAY_LINE }, SCOPE)).ok).toBe(true);
    expect((await relocatePlanLine(GRANT, { lineId: TODAY_LINE, termMode: "exam", lineNo: 1 }, SCOPE)).ok).toBe(true);
    expect(rpcCalls.map((c) => c.name)).toEqual(["ecs_delete_plan_line", "ecs_move_plan_line"]);
    // 작성자는 RPC에도 null로 넘어간다.
    expect(rpcCalls[1]!.args.p_actor).toBeNull();
  });
});
