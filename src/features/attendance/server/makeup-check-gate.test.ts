import { beforeEach, describe, expect, it, vi } from "vitest";

/** 보고서 발송의 보강 진행 여부 확인 서버 겹(원장 2026-10-27) — `makeupCheckPending`. */
const m = vi.hoisted(() => ({ result: { data: [] as unknown[], error: null as { message: string } | null }, calls: [] as Record<string, unknown>[], mode: "off" }));

vi.mock("server-only", () => ({}));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ makeups: { mode: m.mode } }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const call: Record<string, unknown> = { table };
      m.calls.push(call);
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (k: string, v: unknown) => ((call[k] = v), b),
        in: (k: string, v: unknown) => ((call[`${k}:in`] = v), b),
        is: (k: string, v: unknown) => ((call[`${k}:is`] = v), b),
        or: (v: string) => ((call.or = v), b),
        limit: () => Promise.resolve(m.result),
      };
      return b;
    },
  }),
}));

import { makeupCheckPending } from "./makeup-check-gate";

const base = { tenantId: "t1", studentId: "s1", date: "2026-10-27" };

beforeEach(() => {
  m.result = { data: [], error: null };
  m.calls = [];
  m.mode = "off";
});

describe("makeupCheckPending", () => {
  it("정규 줄 = 그 반 그날 합침 예약 중 확인 전이 있으면 막는다(분리 예약은 보지 않는다)", async () => {
    m.result = { data: [{ id: "r1" }], error: null };
    expect(await makeupCheckPending({ ...base, classId: "BS2P", makeupClassId: null })).toBe(true);
    expect(m.calls[0]).toMatchObject({ tenant_id: "t1", student_id: "s1", class_id: "BS2P", makeup_date: "2026-10-27", "checked_at:is": null, or: "report_mode.is.null,report_mode.eq.merge" });
  });
  it("보강 줄 = 앵커 반의 그날 예약 전부(분리 포함) · 확인됐으면 통과", async () => {
    expect(await makeupCheckPending({ ...base, classId: null, makeupClassId: "JJ2L" })).toBe(false);
    expect(m.calls[0]).toMatchObject({ class_id: "JJ2L" });
    expect(m.calls[0]).not.toHaveProperty("or");
  });
  it("🔴 보강관리(신규)가 켜진 지점은 막지 않는다 — 연결 예약은 확인을 쓸 수 없다(리뷰)", async () => {
    m.result = { data: [{ id: "r1" }], error: null };
    m.mode = "on";
    expect(await makeupCheckPending({ ...base, classId: "BS2P", makeupClassId: null })).toBe(false);
    expect(m.calls).toHaveLength(0);
  });
  it("확인 칸 미적용·조회 실패·반 없음은 막지 않는다(fail-open)", async () => {
    m.result = { data: [], error: { message: "column makeup_reservations.checked_at does not exist" } };
    expect(await makeupCheckPending({ ...base, classId: "BS2P", makeupClassId: null })).toBe(false);
    expect(await makeupCheckPending({ ...base, classId: null, makeupClassId: null })).toBe(false);
  });
});
