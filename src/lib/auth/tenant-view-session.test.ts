import { beforeEach, describe, expect, it, vi } from "vitest";
import { TENANT_VIEW_COOKIE, TENANT_VIEW_MARK_COOKIE, parseTenantViewMark, tenantViewCookieValue, tenantViewMarkValue } from "./tenant-view-shared";

/**
 * 운영 콘솔의 '지점 보기'(읽기 전용) — 보기를 **열고 닫는** 쪽(쿠키 두 개 + 보기 기록 한 줄)과 끝내기 · 맞추기 주소.
 *
 * 지키려는 것:
 * - 기록을 만드는 것만으로는 아무것도 닫지 않는다(여는 데 실패해도 앞선 보기가 그대로다 · 다른 브라우저의 보기를 끝내지 않는다).
 * - 쿠키를 쓰는 순간 이 브라우저의 앞선 보기만 닫는다. 쿠키 둘은 늘 함께 쓰고 함께 지운다.
 * - 닫을 때는 기록을 못 닫아도 쿠키는 지운다.
 * - 끝내기 · 맞추기 주소는 상태에 맞는 곳으로 보낸다(끝난 보기의 쿠키를 지운다 · 바깥 주소로 보내지 않는다).
 */
const OPERATOR = "11111111-0000-4000-8000-000000000001";
const TENANT = "bbbbbbbb-0000-4000-8000-000000000002";
const OLD_TOKEN = "0a000000-0000-4000-8000-00000000000a";
const NEW_TOKEN = "0b000000-0000-4000-8000-00000000000b";

type Row = { token: string; operator_id: string; tenant_id: string; expires_at: string; ended_at: string | null; created_at: string };
type CookieOptions = { httpOnly?: boolean; maxAge?: number; path?: string; sameSite?: string; secure?: boolean };

const db = vi.hoisted(() => ({
  rows: [] as Row[],
  insertError: false,
  selectThrows: false,
  nextToken: "",
  ops: [] as string[],
}));
const jar = vi.hoisted(() => ({
  values: new Map<string, string>(),
  set: [] as { name: string; value: string; options: CookieOptions }[],
  deleted: [] as string[],
}));
const view = vi.hoisted(() => ({ state: "none" as "none" | "live" | "ended" | "unknown", tenantId: "", operatorId: "", asked: 0 }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.values.has(name) ? { value: jar.values.get(name)! } : undefined),
    set: (name: string, value: string, options: CookieOptions) => { jar.values.set(name, value); jar.set.push({ name, value, options }); },
    delete: (name: string) => { jar.values.delete(name); jar.deleted.push(name); },
  }),
}));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); } }));
vi.mock("@/lib/auth/tenant-view", () => ({
  tenantViewState: async () => {
    view.asked++;
    return view.state === "live" ? { state: "live", view: { tenantId: view.tenantId, operatorId: view.operatorId } } : { state: view.state };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createRawAdminClient: () => ({
    from: (table: string) => {
      if (table !== "operator_tenant_views") throw new Error(`뜻밖의 표: ${table}`);
      const filters: [string, string, unknown][] = [];
      let action: "select" | "update" | "delete" | "insert" = "select";
      let patch: Partial<Row> = {};
      let inserted: Row | null = null;
      const match = (r: Row) => filters.every(([op, col, val]) => {
        const v = (r as Record<string, unknown>)[col];
        return op === "eq" ? v === val : op === "is" ? v === val : op === "lt" ? String(v) < String(val) : true;
      });
      const run = () => {
        if (action === "update") { db.ops.push("update"); for (const r of db.rows.filter(match)) Object.assign(r, patch); return { data: null, error: null }; }
        if (action === "delete") { db.ops.push("delete"); db.rows = db.rows.filter((r) => !match(r)); return { data: null, error: null }; }
        return { data: null, error: null };
      };
      const q = {
        select: () => q,
        insert: (values: { operator_id: string; tenant_id: string; expires_at: string }) => {
          action = "insert";
          db.ops.push("insert");
          if (!db.insertError) {
            inserted = { token: db.nextToken, ...values, ended_at: null, created_at: new Date().toISOString() };
            db.rows.push(inserted);
          }
          return q;
        },
        update: (values: Partial<Row>) => { action = "update"; patch = values; return q; },
        delete: () => { action = "delete"; return q; },
        eq: (col: string, val: unknown) => { filters.push(["eq", col, val]); return q; },
        is: (col: string, val: unknown) => { filters.push(["is", col, val]); return q; },
        lt: (col: string, val: unknown) => { filters.push(["lt", col, val]); return q; },
        single: async () => (inserted ? { data: { token: inserted.token }, error: null } : { data: null, error: { message: "relation does not exist" } }),
        maybeSingle: async () => {
          if (db.selectThrows) throw new Error("fetch failed");
          db.ops.push("select");
          return { data: db.rows.find(match) ?? null, error: null };
        },
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
      };
      return q;
    },
  }),
}));

import { closeTenantView, createTenantViewRow, endTenantViewRow, hasTenantViewCookie, setTenantViewCookies } from "./tenant-view-session";
import { GET as exitRoute } from "@/app/tenant-view/exit/route";
import { GET as syncRoute } from "@/app/tenant-view/sync/route";

const liveRow = (token: string, operatorId = OPERATOR): Row => ({
  token, operator_id: operatorId, tenant_id: TENANT, expires_at: new Date(Date.now() + 3_600_000).toISOString(), ended_at: null, created_at: new Date().toISOString(),
});
const request = (url: string) => ({ nextUrl: new URL(url, "https://app.example") }) as unknown as Parameters<typeof syncRoute>[0];
const redirectOf = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (e) {
    const m = /^REDIRECT:(.*)$/.exec((e as Error).message);
    if (m) return m[1]!;
    throw e;
  }
  throw new Error("이동하지 않았다");
};

beforeEach(() => {
  db.rows = [];
  db.insertError = false;
  db.selectThrows = false;
  db.nextToken = NEW_TOKEN;
  db.ops = [];
  jar.values = new Map();
  jar.set = [];
  jar.deleted = [];
  view.state = "none";
  view.tenantId = TENANT;
  view.operatorId = OPERATOR;
  view.asked = 0;
});

describe("보기 기록 만들기", () => {
  it("🔴 한 줄을 넣을 뿐 아무것도 닫지 않는다 — 다른 브라우저에서 열어 둔 같은 사람의 보기가 그대로다", async () => {
    db.rows = [liveRow(OLD_TOKEN)];
    const opened = await createTenantViewRow(OPERATOR, TENANT);
    expect(opened?.token).toBe(NEW_TOKEN);
    expect(db.rows.find((r) => r.token === OLD_TOKEN)?.ended_at).toBeNull();
    expect(db.rows.find((r) => r.token === NEW_TOKEN)).toMatchObject({ operator_id: OPERATOR, tenant_id: TENANT, ended_at: null });
    // 쿠키는 아직 쓰지 않는다(부르는 쪽이 DB 확인 뒤에 쓴다).
    expect(jar.set).toEqual([]);
  });

  it("끝나는 때는 지금부터 두 시간 뒤다", async () => {
    const before = Date.now();
    const opened = await createTenantViewRow(OPERATOR, TENANT);
    const ms = Date.parse(opened!.expiresAt) - before;
    expect(ms).toBeGreaterThanOrEqual(120 * 60_000 - 5);
    expect(ms).toBeLessThan(120 * 60_000 + 5_000);
  });

  it("넣지 못하면(표가 아직 없다) null — 아무것도 남기지 않는다", async () => {
    db.insertError = true;
    expect(await createTenantViewRow(OPERATOR, TENANT)).toBeNull();
    expect(db.rows).toEqual([]);
    expect(jar.set).toEqual([]);
  });

  it("오래된 기록(30일 전 · 이 사람 것)만 치운다", async () => {
    const old = { ...liveRow("0c000000-0000-4000-8000-00000000000c"), created_at: new Date(Date.now() - 40 * 86_400_000).toISOString() };
    const othersOld = { ...liveRow("0d000000-0000-4000-8000-00000000000d", "22222222-0000-4000-8000-000000000002"), created_at: old.created_at };
    db.rows = [old, othersOld, liveRow(OLD_TOKEN)];
    await createTenantViewRow(OPERATOR, TENANT);
    await new Promise((r) => setTimeout(r, 0));
    expect(db.rows.map((r) => r.token).sort()).toEqual([OLD_TOKEN, NEW_TOKEN, othersOld.token].sort());
  });
});

describe("쿠키 쓰기 — 이 브라우저의 앞선 보기만 닫는다", () => {
  it("토큰(서버만 읽는다) · 표식(화면이 읽는다) 둘을 같은 수명으로 쓴다", async () => {
    const expiresAt = new Date(Date.now() + 7_200_000).toISOString();
    await setTenantViewCookies({ token: NEW_TOKEN, expiresAt }, OPERATOR, TENANT);
    expect(jar.set.map((c) => c.name)).toEqual([TENANT_VIEW_COOKIE, TENANT_VIEW_MARK_COOKIE]);
    const [token, mark] = jar.set;
    expect(token!.value).toBe(tenantViewCookieValue(NEW_TOKEN, OPERATOR));
    expect(token!.options).toMatchObject({ httpOnly: true, maxAge: 7200, path: "/", sameSite: "lax" });
    expect(mark!.options).toMatchObject({ httpOnly: false, maxAge: 7200, path: "/", sameSite: "lax" });
    expect(parseTenantViewMark(mark!.value)).toEqual({ operatorId: OPERATOR, tenantId: TENANT, expiresAtSeconds: Math.floor(Date.parse(expiresAt) / 1000) });
    // 표식에는 토큰이 실리지 않는다(자바스크립트가 읽는 쿠키다).
    expect(mark!.value).not.toContain(NEW_TOKEN);
  });

  it("🔴 이 브라우저에 앞선 보기가 있으면 그 기록을 닫고 나서 덮어쓴다", async () => {
    db.rows = [liveRow(OLD_TOKEN), liveRow(NEW_TOKEN)];
    jar.values.set(TENANT_VIEW_COOKIE, tenantViewCookieValue(OLD_TOKEN, OPERATOR));
    await setTenantViewCookies({ token: NEW_TOKEN, expiresAt: new Date(Date.now() + 7_200_000).toISOString() }, OPERATOR, TENANT);
    expect(db.rows.find((r) => r.token === OLD_TOKEN)?.ended_at).not.toBeNull();
    expect(db.rows.find((r) => r.token === NEW_TOKEN)?.ended_at).toBeNull();
    expect(jar.values.get(TENANT_VIEW_COOKIE)).toBe(tenantViewCookieValue(NEW_TOKEN, OPERATOR));
  });

  it("같은 토큰을 다시 쓰는 것이면 닫지 않는다", async () => {
    db.rows = [liveRow(NEW_TOKEN)];
    jar.values.set(TENANT_VIEW_COOKIE, tenantViewCookieValue(NEW_TOKEN, OPERATOR));
    await setTenantViewCookies({ token: NEW_TOKEN, expiresAt: new Date(Date.now() + 7_200_000).toISOString() }, OPERATOR, TENANT);
    expect(db.rows[0]!.ended_at).toBeNull();
  });
});

describe("보기 닫기", () => {
  it("기록에 끝난 시각을 적고 쿠키 둘을 지운다 — 보던 지점을 돌려준다", async () => {
    db.rows = [liveRow(OLD_TOKEN)];
    jar.values.set(TENANT_VIEW_COOKIE, tenantViewCookieValue(OLD_TOKEN, OPERATOR));
    jar.values.set(TENANT_VIEW_MARK_COOKIE, "x");
    expect(await closeTenantView()).toBe(TENANT);
    expect(db.rows[0]!.ended_at).not.toBeNull();
    expect(jar.deleted.sort()).toEqual([TENANT_VIEW_COOKIE, TENANT_VIEW_MARK_COOKIE].sort());
    expect(await hasTenantViewCookie()).toBe(false);
  });

  it("남의 토큰으로는 닫지 못한다(토큰 + 주인이 함께 맞아야 한다)", async () => {
    db.rows = [liveRow(OLD_TOKEN, "22222222-0000-4000-8000-000000000002")];
    jar.values.set(TENANT_VIEW_COOKIE, tenantViewCookieValue(OLD_TOKEN, OPERATOR));
    expect(await closeTenantView()).toBeNull();
    expect(db.rows[0]!.ended_at).toBeNull();
    expect(jar.deleted).toContain(TENANT_VIEW_COOKIE);
  });

  it("🔴 기록을 읽지 못해도 쿠키는 지운다", async () => {
    db.rows = [liveRow(OLD_TOKEN)];
    db.selectThrows = true;
    jar.values.set(TENANT_VIEW_COOKIE, tenantViewCookieValue(OLD_TOKEN, OPERATOR));
    jar.values.set(TENANT_VIEW_MARK_COOKIE, "x");
    expect(await closeTenantView()).toBeNull();
    expect(jar.deleted.sort()).toEqual([TENANT_VIEW_COOKIE, TENANT_VIEW_MARK_COOKIE].sort());
    // 닫기는 따로 시도한다.
    expect(db.rows[0]!.ended_at).not.toBeNull();
  });

  it("표식만 남은 브라우저도 치운다(조회 없이)", async () => {
    jar.values.set(TENANT_VIEW_MARK_COOKIE, "x");
    expect(await hasTenantViewCookie()).toBe(true);
    expect(await closeTenantView()).toBeNull();
    expect(jar.deleted).toEqual([TENANT_VIEW_MARK_COOKIE]);
    expect(db.ops).toEqual([]);
  });

  it("쿠키가 없으면 아무것도 하지 않는다", async () => {
    expect(await closeTenantView()).toBeNull();
    expect(jar.deleted).toEqual([]);
    expect(db.ops).toEqual([]);
  });

  it("한 줄 닫기는 이미 닫힌 줄의 끝난 시각을 다시 쓰지 않는다", async () => {
    db.rows = [{ ...liveRow(OLD_TOKEN), ended_at: "2026-01-01T00:00:00.000Z" }];
    await endTenantViewRow(OLD_TOKEN, OPERATOR);
    expect(db.rows[0]!.ended_at).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("'보기 끝내기' 주소", () => {
  it("보던 학원의 운영 콘솔 화면으로 돌아간다 — 쿠키를 지우고", async () => {
    db.rows = [liveRow(OLD_TOKEN)];
    jar.values.set(TENANT_VIEW_COOKIE, tenantViewCookieValue(OLD_TOKEN, OPERATOR));
    jar.values.set(TENANT_VIEW_MARK_COOKIE, "x");
    expect(await redirectOf(() => exitRoute(request("/tenant-view/exit")))).toBe(`/super-admin/tenants/${TENANT}`);
    expect(jar.values.size).toBe(0);
    expect(db.rows[0]!.ended_at).not.toBeNull();
  });

  it("저절로 끝난 보기를 정리하러 온 것이면 안내를 붙인다", async () => {
    db.rows = [{ ...liveRow(OLD_TOKEN), ended_at: "2026-01-01T00:00:00.000Z" }];
    jar.values.set(TENANT_VIEW_COOKIE, tenantViewCookieValue(OLD_TOKEN, OPERATOR));
    expect(await redirectOf(() => exitRoute(request("/tenant-view/exit?why=ended")))).toBe(`/super-admin/tenants/${TENANT}?view=ended`);
  });

  it("쿠키가 없거나 표식만 남았으면 학원 목록으로", async () => {
    expect(await redirectOf(() => exitRoute(request("/tenant-view/exit?why=ended")))).toBe("/super-admin/tenants");
    jar.values.set(TENANT_VIEW_MARK_COOKIE, "x");
    expect(await redirectOf(() => exitRoute(request("/tenant-view/exit")))).toBe("/super-admin/tenants");
    expect(jar.values.size).toBe(0);
  });

  const liveCookies = (secondsLeft: number) => {
    db.rows = [liveRow(OLD_TOKEN)];
    jar.values.set(TENANT_VIEW_COOKIE, tenantViewCookieValue(OLD_TOKEN, OPERATOR));
    jar.values.set(TENANT_VIEW_MARK_COOKIE, tenantViewMarkValue({ operatorId: OPERATOR, tenantId: TENANT, expiresAtSeconds: Date.now() / 1000 + secondsLeft }));
    view.state = "live";
  };

  it("🔴 저절로 끝난 줄 알고 왔는데 살아 있는 보기면(그사이 새로 열었다) 닫지 않고 그 지점의 첫 화면으로", async () => {
    liveCookies(3600);
    expect(await redirectOf(() => exitRoute(request("/tenant-view/exit?why=ended")))).toBe("/home");
    expect(jar.values.size).toBe(2);
    expect(db.rows[0]!.ended_at).toBeNull();
  });

  it("🔴 사람이 누른 '보기 끝내기'는 살아 있는 보기라도 묻지 않고 닫는다", async () => {
    liveCookies(3600);
    expect(await redirectOf(() => exitRoute(request("/tenant-view/exit")))).toBe(`/super-admin/tenants/${TENANT}`);
    expect(view.asked).toBe(0);
    expect(jar.values.size).toBe(0);
    expect(db.rows[0]!.ended_at).not.toBeNull();
  });

  it("살아 있는 보기라도 화면 감시가 다시 끝났다고 볼 상태면 닫는다 — 끝나 간다 · 표식이 없다 · 표식이 다른 지점을 말한다", async () => {
    // 끝나기 2분 전: 감시는 1분 30초 전부터 끝난 것으로 본다(여유를 두 배로 잡아 견준다) → 보내 봐야 곧 다시 온다.
    liveCookies(110);
    expect(await redirectOf(() => exitRoute(request("/tenant-view/exit?why=ended")))).toBe(`/super-admin/tenants/${TENANT}?view=ended`);
    expect(jar.values.size).toBe(0);
    // 표식 쿠키가 없다.
    liveCookies(3600);
    jar.values.delete(TENANT_VIEW_MARK_COOKIE);
    expect(await redirectOf(() => exitRoute(request("/tenant-view/exit?why=ended")))).toBe(`/super-admin/tenants/${TENANT}?view=ended`);
    // 표식이 다른 지점을 말한다.
    liveCookies(3600);
    jar.values.set(TENANT_VIEW_MARK_COOKIE, tenantViewMarkValue({ operatorId: OPERATOR, tenantId: "cccccccc-0000-4000-8000-000000000003", expiresAtSeconds: Date.now() / 1000 + 3600 }));
    expect(await redirectOf(() => exitRoute(request("/tenant-view/exit?why=ended")))).toBe(`/super-admin/tenants/${TENANT}?view=ended`);
    expect(jar.values.size).toBe(0);
  });

  it("저절로 끝난 줄 알고 왔고 서버도 끝났다고 하면(또는 확인하지 못했으면) 닫는다", async () => {
    for (const state of ["ended", "unknown", "none"] as const) {
      liveCookies(3600);
      view.state = state;
      expect(await redirectOf(() => exitRoute(request("/tenant-view/exit?why=ended"))), state).toBe(`/super-admin/tenants/${TENANT}?view=ended`);
      expect(jar.values.size, state).toBe(0);
    }
  });
});

describe("'화면 맞추기' 주소", () => {
  const withCookies = () => {
    db.rows = [liveRow(OLD_TOKEN)];
    jar.values.set(TENANT_VIEW_COOKIE, tenantViewCookieValue(OLD_TOKEN, OPERATOR));
    jar.values.set(TENANT_VIEW_MARK_COOKIE, "x");
  };

  it("보는 중이면 그 지점의 첫 화면으로 — 원래 주소로 돌려보내지 않는다(그 주소의 id는 다른 지점 것이다)", async () => {
    withCookies();
    view.state = "live";
    expect(await redirectOf(() => syncRoute(request("/tenant-view/sync?next=%2Fstudents%2F123")))).toBe("/home");
    expect(jar.values.size).toBe(2);
    expect(db.rows[0]!.ended_at).toBeNull();
  });

  it("🔴 끝난 보기면 쿠키를 지운다 — 본인 화면이던 탭은 원래 주소로, 보던 탭은 운영 콘솔로", async () => {
    withCookies();
    view.state = "ended";
    expect(await redirectOf(() => syncRoute(request("/tenant-view/sync?next=%2Fstudents%3Ftab%3Da")))).toBe("/students?tab=a");
    expect(jar.values.size).toBe(0);
    withCookies();
    expect(await redirectOf(() => syncRoute(request("/tenant-view/sync?next=%2Fstudents%2F123&from=view")))).toBe(`/super-admin/tenants/${TENANT}`);
    expect(jar.values.size).toBe(0);
  });

  it("보기가 아니면(쿠키가 없다 · 남의 것이다) 남은 쿠키를 지우고 원래 주소로", async () => {
    jar.values.set(TENANT_VIEW_MARK_COOKIE, "x");
    view.state = "none";
    expect(await redirectOf(() => syncRoute(request("/tenant-view/sync?next=%2Fdashboard")))).toBe("/dashboard");
    expect(jar.values.size).toBe(0);
    expect(await redirectOf(() => syncRoute(request("/tenant-view/sync?from=view")))).toBe("/super-admin/tenants");
  });

  it("🔴 확인하지 못했으면 아무것도 지우지 않는다(살아 있는 보기일 수 있다)", async () => {
    withCookies();
    view.state = "unknown";
    expect(await redirectOf(() => syncRoute(request("/tenant-view/sync?next=%2Fdashboard&from=view")))).toBe("/dashboard");
    expect(jar.values.size).toBe(2);
    expect(db.rows[0]!.ended_at).toBeNull();
  });

  it("돌아갈 주소는 같은 사이트의 경로만 — 바깥 주소 · 주소 없음은 첫 화면으로", async () => {
    for (const next of ["https://evil.example/x", "//evil.example", "/\\evil.example", "javascript:alert(1)", ""]) {
      expect(await redirectOf(() => syncRoute(request(`/tenant-view/sync?next=${encodeURIComponent(next)}`))), next).toBe("/home");
    }
    expect(await redirectOf(() => syncRoute(request("/tenant-view/sync")))).toBe("/home");
  });
});
