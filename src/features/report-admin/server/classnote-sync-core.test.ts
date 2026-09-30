import { describe, expect, it, vi } from "vitest";
import type { SyncRequestRow } from "../classnote-sync";

vi.mock("server-only", () => ({}));

import { mergeIntoPending } from "./classnote-sync-core";

/**
 * 합치기(0313a) — 대기 중이면 scope, 실행 중이면 next_scope(워커가 끝나며 이어서 돈다). 2026-09-30 적대 리뷰:
 * 실행 중에 합류한 반이 조용히 버려지고, 끝난 뒤엔 쿨다운이 재요청까지 막았다.
 */
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function fakeAdmin() {
  const updates: { patch: Record<string, unknown>; eqs: [string, unknown][] }[] = [];
  const admin = {
    from() {
      const cur = { patch: {} as Record<string, unknown>, eqs: [] as [string, unknown][] };
      const b = {
        update(p: Record<string, unknown>) {
          cur.patch = p;
          updates.push(cur);
          return b;
        },
        eq(k: string, v: unknown) {
          cur.eqs.push([k, v]);
          return b;
        },
        select() {
          return Promise.resolve({ data: [{ id: "r1" }], error: null });
        },
      };
      return b;
    },
  };
  return { admin: admin as never, updates };
}

const row = (p: Partial<SyncRequestRow>): SyncRequestRow => ({
  id: "r1",
  status: "pending",
  requestedAt: new Date().toISOString(),
  startedAt: null,
  finishedAt: null,
  result: null,
  error: null,
  scope: { full: false, classIds: [A], studentIds: [] },
  mergeCount: 2,
  nextScope: null,
  ...p,
});

describe("mergeIntoPending", () => {
  it("대기 중 = scope에 합친다(상태·merge_count 조건부)", async () => {
    const { admin, updates } = fakeAdmin();
    const ok = await mergeIntoPending(admin, "t1", row({}), { full: false, classIds: [B], studentIds: [] });
    expect(ok).toBe(true);
    expect(updates[0].patch).toMatchObject({ scope: { classIds: [A, B] }, merge_count: 3 });
    expect(updates[0].patch).not.toHaveProperty("next_scope");
    expect(updates[0].eqs).toEqual(expect.arrayContaining([["tenant_id", "t1"], ["status", "pending"], ["merge_count", 2]]));
  });

  it("🔴 실행 중 = scope는 건드리지 않고 next_scope에 적는다(워커가 끝나며 새 요청으로 잇는다)", async () => {
    const { admin, updates } = fakeAdmin();
    const ok = await mergeIntoPending(admin, "t1", row({ status: "running" }), { full: false, classIds: [B], studentIds: [] });
    expect(ok).toBe(true);
    expect(updates[0].patch).toMatchObject({ next_scope: { full: false, classIds: [B] }, merge_count: 3 });
    expect(updates[0].patch).not.toHaveProperty("scope");
    expect(updates[0].eqs).toEqual(expect.arrayContaining([["status", "running"]]));
  });

  it("실행 중 · 이미 같은 범위가 next_scope에 있으면 쓰지 않는다", async () => {
    const { admin, updates } = fakeAdmin();
    const r = row({ status: "running", nextScope: { full: false, classIds: [B], studentIds: [] } });
    expect(await mergeIntoPending(admin, "t1", r, { full: false, classIds: [B], studentIds: [] })).toBe(false);
    expect(updates).toHaveLength(0);
  });
});
