// 강사뷰 쓰기 클라이언트 고르기 — 세션 먼저, RLS에 막힐 때만 관리 클라이언트(teacher-view-db.ts).
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ viewAs: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/view-as", () => ({ viewAsTeacher: m.viewAs }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => "session" }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => "admin" }));

import { blockedByRls, writeSessionFirst } from "./teacher-view-db";

beforeEach(() => {
  vi.clearAllMocks();
  m.viewAs.mockResolvedValue({ id: "x1", access: "full" });
});

describe("blockedByRls", () => {
  it("insert는 42501만 막힘 — 0행·표현 없음은 막힘이 아니다(다시 쓰면 두 번 들어간다)", () => {
    expect(blockedByRls("insert", { data: null, error: { code: "42501", message: "rls" } })).toBe(true);
    expect(blockedByRls("insert", { data: null, error: null })).toBe(false);
    expect(blockedByRls("insert", { data: null, error: { code: "23505", message: "dup" } })).toBe(false);
  });
  it("update·delete는 42501 또는 에러 없는 0행", () => {
    expect(blockedByRls("mutate", { data: [], error: null })).toBe(true);
    expect(blockedByRls("mutate", { data: null, error: null })).toBe(true);
    expect(blockedByRls("mutate", { data: null, error: { code: "42501", message: "rls" } })).toBe(true);
    expect(blockedByRls("mutate", { data: [{ id: "1" }], error: null })).toBe(false);
    expect(blockedByRls("mutate", { data: null, error: { code: "23503", message: "fk" } })).toBe(false);
  });
});

describe("writeSessionFirst", () => {
  it("세션이 통과하면 세션으로 끝난다(관리 클라이언트를 만들지 않는다)", async () => {
    const run = vi.fn(async (db: unknown) => ({ data: [{ id: db }], error: null }));
    expect(await writeSessionFirst("mutate", run as never)).toMatchObject({ via: "session", data: [{ id: "session" }] });
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("강사뷰에서 막히면 같은 문장을 관리 클라이언트로 다시", async () => {
    const run = vi.fn(async (db: unknown) => (db === "session" ? { data: [], error: null } : { data: [{ id: "admin" }], error: null }));
    expect(await writeSessionFirst("mutate", run as never)).toMatchObject({ via: "admin", data: [{ id: "admin" }] });
    expect(run.mock.calls.map((c) => c[0])).toEqual(["session", "admin"]);
  });
  it("강사뷰가 아니면 막혀도 세션 결과 그대로", async () => {
    m.viewAs.mockResolvedValue(null);
    const run = vi.fn(async () => ({ data: null, error: { code: "42501", message: "rls" } }));
    expect(await writeSessionFirst("insert", run as never)).toMatchObject({ via: "session", error: { code: "42501" } });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
