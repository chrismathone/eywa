import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { writeUiPrefsNs } from "./write";

type Call = { fn: string; args: unknown };
function fakeAdmin(opts: { rpcError?: { code: string; message: string } | null; stored?: unknown }) {
  const calls: Call[] = [];
  let written: unknown = undefined;
  const admin = {
    rpc: (fn: string, args: unknown) => {
      calls.push({ fn, args });
      return Promise.resolve({ error: opts.rpcError ?? null });
    },
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: { ui_prefs: opts.stored ?? null }, error: null }),
        update: (v: { ui_prefs: unknown }) => {
          written = v.ui_prefs;
          return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
        },
      };
      return chain;
    },
  };
  return { admin: admin as never, calls, written: () => written };
}
const who = { userId: "u1", tenantId: "t1" };

describe("writeUiPrefsNs — 네임스페이스 단위 쓰기(B16)", () => {
  it("키 단위: set·unset을 DB 함수에 그대로 넘긴다", async () => {
    const f = fakeAdmin({});
    await writeUiPrefsNs(f.admin, who, "staff", { set: { sort: "name" }, unset: ["dir"] });
    expect(f.calls).toEqual([
      { fn: "ui_prefs_patch", args: { p_user: "u1", p_tenant: "t1", p_ns: "staff", p_set: { sort: "name" }, p_unset: ["dir"], p_replace: false } },
    ]);
  });

  it("교체: replace 값 그대로 · p_replace=true", async () => {
    const f = fakeAdmin({});
    await writeUiPrefsNs(f.admin, who, "acks", { replace: ["a", "b"] });
    expect(f.calls[0]!.args).toMatchObject({ p_set: ["a", "b"], p_unset: [], p_replace: true });
  });

  it("함수가 아직 없으면(#95) 종전처럼 읽고 합쳐 쓰되 다른 네임스페이스는 그대로", async () => {
    const f = fakeAdmin({
      rpcError: { code: "PGRST202", message: "Could not find the function public.ui_prefs_patch" },
      stored: { other: { x: 1 }, staff: { sort: "id", dir: "asc" } },
    });
    const r = await writeUiPrefsNs(f.admin, who, "staff", { set: { sort: "name" }, unset: ["dir"] });
    expect(r.error).toBeNull();
    expect(f.written()).toEqual({ other: { x: 1 }, staff: { sort: "name" } });
  });

  it("폴백에서 빈 결과면 네임스페이스를 지운다", async () => {
    const f = fakeAdmin({ rpcError: { code: "42883", message: "function ui_prefs_patch does not exist" }, stored: { staff: { dir: "asc" }, k: 1 } });
    await writeUiPrefsNs(f.admin, who, "staff", { unset: ["dir"] });
    expect(f.written()).toEqual({ k: 1 });
  });

  it("다른 오류는 폴백하지 않고 돌려준다", async () => {
    const f = fakeAdmin({ rpcError: { code: "42501", message: "permission denied for function ui_prefs_patch" } });
    const r = await writeUiPrefsNs(f.admin, who, "staff", { set: { a: 1 } });
    expect(r.error?.code).toBe("42501");
    expect(f.written()).toBeUndefined();
  });
});
