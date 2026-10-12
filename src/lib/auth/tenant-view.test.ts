import { beforeEach, describe, expect, it, vi } from "vitest";
import { TENANT_VIEW_COOKIE, TENANT_VIEW_MARK_COOKIE, tenantViewCookieValue, tenantViewMarkValue } from "./tenant-view-shared";

/**
 * 운영 콘솔의 '지점 보기'(읽기 전용) — 요청이 보기 중인지의 **단일 판정**과, 그때 현재 사용자가 어떻게 잡히는지.
 *
 * 지키려는 것:
 * - 쿠키는 믿지 않는다: 매번 보기 기록이 살아 있는지(끝나지 않음 · 만료 전 · 명단에 있음)를 다시 본다.
 * - 평소 요청 · 다른 계정의 요청에는 조회가 붙지 않는다(쿠키가 없거나 주인이 아니면 0회).
 * - 한 요청 안에서는 판정이 한 번만 계산된다(사람 · 헤더 · 쓰기 차단이 같은 결과를 본다).
 * - 확인하지 못한 요청(조회 실패)은 보기를 적용하지 않되 쓰기는 막는다.
 * - 내가 열었던 보기의 쿠키가 남아 있는데 보기가 아닌 요청(끝난 보기)은 평소 요청이 아니다 — 쓰기를 막고, 본인으로 답하지 않는다.
 * - 끝난 보기는 **근거가 있을 때만** 낸다(그 토큰의 기록이 실제로 있다 · 운영자다) — 누가 만들어 넣은 쿠키로는 아무 일도 없다.
 */
const TOKEN = "0b6e1c1e-3d0a-4c0e-9d0a-1f2e3d4c5b6a";
const OPERATOR = "11111111-0000-4000-8000-000000000001";
const OTHER = "22222222-0000-4000-8000-000000000002";
const TENANT = "bbbbbbbb-0000-4000-8000-000000000002";
const OWN_TENANT = "aaaaaaaa-0000-4000-8000-000000000001";

type Jar = { get(name: string): { value: string } | undefined; getAll(): { name: string; value: string }[] };

const state = vi.hoisted(() => ({
  jar: null as unknown as { get(name: string): { value: string } | undefined; getAll(): { name: string; value: string }[] },
  pathname: null as string | null,
  /** 서버 액션 요청이면 그 액션 id(Next가 싣는 `next-action` 헤더). */
  nextAction: null as string | null,
  cookiesThrow: false,
  /** `cookies()`가 Next의 흐름 제어 신호(정적 렌더 중단 등 — `digest`가 달린 오류)를 던지는 경우. */
  cookiesControl: false,
  view: null as Record<string, unknown> | null,
  viewError: null as { message: string; code?: string } | null,
  operator: null as Record<string, unknown> | null,
  operatorError: null as { message: string } | null,
  tenant: null as Record<string, unknown> | null,
  adminCalls: [] as string[],
  sub: "" as string,
  usersRow: null as Record<string, unknown> | null,
  /** DB에 "이 요청을 그 지점의 보기로 받아 주는가"를 물었을 때의 답 — 응답(상태 · 본문) 또는 통신 실패. */
  db: { status: 200, body: null as unknown, fail: false },
  dbCalls: [] as { url: string; method: string; headers: Record<string, string> }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => {
    if (state.cookiesControl) throw Object.assign(new Error("Dynamic server usage"), { digest: "DYNAMIC_SERVER_USAGE" });
    if (state.cookiesThrow) throw new Error("cookies was called outside a request scope");
    return state.jar;
  },
  headers: async () => ({ get: (name: string) => (name === "x-pathname" ? state.pathname : name === "next-action" ? state.nextAction : null) }),
}));
vi.mock("next/navigation", () => ({
  // 진짜와 같은 일: Next의 흐름 제어 신호(`digest`가 달린 오류)만 다시 던진다.
  unstable_rethrow: (e: unknown) => { if (e && typeof e === "object" && "digest" in e) throw e; },
  redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); },
}));
vi.mock("@/lib/supabase/env", () => ({ SUPABASE_URL: "https://projref.supabase.co", SUPABASE_ANON_KEY: "anon" }));
vi.mock("@/lib/supabase/admin", () => ({
  createRawAdminClient: () => ({
    from: (table: string) => {
      state.adminCalls.push(table);
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () =>
          table === "operator_tenant_views" ? { data: state.view, error: state.viewError }
          : table === "super_admins" ? { data: state.operator, error: state.operatorError }
          : { data: state.tenant, error: null },
      };
      return q;
    },
  }),
  createAdminClient: () => { throw new Error("보기 판정은 가드 없는 클라이언트만 쓴다"); },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => ({ data: { claims: { sub: state.sub || undefined } }, error: null }),
      getSession: async () => ({ data: { session: null } }),
    },
    from: () => {
      const q = { select: () => q, eq: () => q, single: async () => ({ data: state.usersRow }) };
      return q;
    },
  }),
}));

import { dbHonorsTenantView, isTenantViewRequest, isTenantViewScreenRequest, isTenantViewWriteBlocked, liveTenantView, readSessionCookie, tenantViewSignedOutRedirect, tenantViewState, tenantViewWriteError, unverifiedSessionUserId } from "./tenant-view";
import { TENANT_VIEW_HEADER } from "./tenant-view-shared";
import { getCurrentUser } from "./current-user";

/** 로그인 쿠키(supabase-js가 쓰는 모양) — 사용자 id만 다르게. */
const ACCESS_TOKEN = "head.body.sign";
const sessionCookie = (userId: string, opts: { chunked?: boolean; raw?: boolean; noToken?: boolean } = {}) => {
  const json = JSON.stringify({ ...(opts.noToken ? {} : { access_token: ACCESS_TOKEN }), refresh_token: "r", user: { id: userId } });
  const value = opts.raw ? json : `base64-${Buffer.from(json, "utf8").toString("base64url")}`;
  if (!opts.chunked) return [{ name: "sb-projref-auth-token", value }];
  const half = Math.ceil(value.length / 2);
  return [
    { name: "sb-projref-auth-token.1", value: value.slice(half) },
    { name: "sb-projref-auth-token.0", value: value.slice(0, half) },
  ];
};
/** 요청 하나의 쿠키 저장소 — 요청마다 **새 객체**다(판정이 이 객체에 매달린다). */
const makeJar = (all: { name: string; value: string }[]): Jar => ({
  get: (name) => { const c = all.find((x) => x.name === name); return c ? { value: c.value } : undefined; },
  getAll: () => all,
});
const viewCookie = (token = TOKEN, operatorId = OPERATOR) => ({ name: TENANT_VIEW_COOKIE, value: tenantViewCookieValue(token, operatorId) });
const markCookie = (operatorId = OPERATOR) => ({ name: TENANT_VIEW_MARK_COOKIE, value: tenantViewMarkValue({ operatorId, tenantId: TENANT, expiresAtSeconds: Math.floor(Date.now() / 1000) + 3600 }) });
const request = (cookies: { name: string; value: string }[]) => { state.jar = makeJar(cookies); };

const liveRow = () => ({ token: TOKEN, operator_id: OPERATOR, tenant_id: TENANT, expires_at: new Date(Date.now() + 60 * 60_000).toISOString(), ended_at: null });

beforeEach(() => {
  request([viewCookie(), ...sessionCookie(OPERATOR)]);
  state.pathname = "/dashboard";
  state.nextAction = null;
  state.cookiesThrow = false;
  state.cookiesControl = false;
  state.view = liveRow();
  state.viewError = null;
  state.operator = { id: OPERATOR, email: "ops@example.com", display_name: "  운영 담당  " };
  state.operatorError = null;
  state.tenant = { id: TENANT, name: "지점 B" };
  state.adminCalls = [];
  state.sub = OPERATOR;
  state.usersRow = { id: OPERATOR, tenant_id: OWN_TENANT, email: "ops@example.com", display_name: "본인", job_title: null, system_role: "master", status: "active" };
  state.db = { status: 200, body: TENANT, fail: false };
  state.dbCalls = [];
  vi.stubGlobal("fetch", async (url: string, init: { method?: string; headers?: Record<string, string> }) => {
    state.dbCalls.push({ url: String(url), method: init?.method ?? "GET", headers: init?.headers ?? {} });
    if (state.db.fail) throw new Error("fetch failed");
    return new Response(JSON.stringify(state.db.body), { status: state.db.status, headers: { "content-type": "application/json" } });
  });
});

describe("지점 보기 판정 — 평소 요청에는 비용이 붙지 않는다", () => {
  it("보기 쿠키가 없으면 조회 없이 '아님'", async () => {
    request(sessionCookie(OPERATOR));
    expect(await tenantViewState()).toEqual({ state: "none" });
    expect(state.adminCalls).toEqual([]);
  });

  it("쿠키 모양이 틀리면 조회 없이 '아님'", async () => {
    for (const value of ["", "teacher", TOKEN, `${TOKEN}.`, `${TOKEN}.${OPERATOR}.x`, `x.${OPERATOR}`, `${TOKEN}.not-a-uuid`]) {
      request([{ name: TENANT_VIEW_COOKIE, value }, ...sessionCookie(OPERATOR)]);
      expect((await tenantViewState()).state, value).toBe("none");
    }
    expect(state.adminCalls).toEqual([]);
  });

  it("🔴 이 브라우저에 남은 **다른 계정의** 보기 쿠키는 조회 없이 '아님' — 그 사람의 저장이 막히지 않는다", async () => {
    request([viewCookie(TOKEN, OPERATOR), ...sessionCookie(OTHER)]);
    expect(await tenantViewState()).toEqual({ state: "none" });
    expect(await isTenantViewWriteBlocked()).toBe(false);
    expect(state.adminCalls).toEqual([]);
  });

  it("로그인 쿠키가 없으면(비로그인 · 공개 화면) 조회 없이 '아님'", async () => {
    request([viewCookie()]);
    expect(await tenantViewState()).toEqual({ state: "none" });
    expect(state.adminCalls).toEqual([]);
  });

  it("요청 밖(쿠키를 읽을 수 없는 곳)에서는 '아님'", async () => {
    state.cookiesThrow = true;
    expect(await tenantViewState()).toEqual({ state: "none" });
    expect(await isTenantViewWriteBlocked()).toBe(false);
  });

  it("🔴 Next가 흐름 제어에 쓰는 신호는 삼키지 않는다 — '아님'으로 바꿔 답하지 않고 그대로 다시 던진다", async () => {
    state.cookiesControl = true;
    await expect(tenantViewState()).rejects.toMatchObject({ digest: "DYNAMIC_SERVER_USAGE" });
    await expect(isTenantViewWriteBlocked()).rejects.toMatchObject({ digest: "DYNAMIC_SERVER_USAGE" });
  });

  it("운영 콘솔 주소에서는 살아 있는 보기가 있어도 적용하지 않는다(조회도 안 한다)", async () => {
    for (const pathname of ["/admin", "/super-admin", "/super-admin/tenants/abc"]) {
      request([viewCookie(), ...sessionCookie(OPERATOR)]);
      state.pathname = pathname;
      expect((await tenantViewState()).state, pathname).toBe("none");
    }
    expect(state.adminCalls).toEqual([]);
  });

  it("🔴 `/admin/…`은 지점 화면이다 — 보기가 그대로 적용된다(쓰기 차단이 빠지지 않는다)", async () => {
    state.pathname = "/admin/cleanup";
    expect((await tenantViewState()).state).toBe("live");
    expect(await isTenantViewWriteBlocked()).toBe(true);
  });
});

describe("지점 보기 판정 — 쿠키는 믿지 않고 기록을 다시 본다", () => {
  it("살아 있는 보기면 지점 · 운영자 정보를 돌려준다", async () => {
    expect(await liveTenantView()).toEqual({
      token: TOKEN, operatorId: OPERATOR, operatorEmail: "ops@example.com", operatorName: "운영 담당",
      tenantId: TENANT, tenantName: "지점 B", expiresAt: (state.view as { expires_at: string }).expires_at,
    });
    expect(await isTenantViewRequest()).toBe(true);
    expect(await tenantViewWriteError()).toBe("읽기 전용 보기에서는 저장할 수 없습니다");
  });

  it("🔴 기록이 끝났거나 만료됐으면 '끝난 보기' — 평소 요청이 아니다(쓰기를 막는다)", async () => {
    state.view = { ...liveRow(), ended_at: new Date().toISOString() };
    // 기록을 읽은 끝난 보기는 보던 지점을 함께 든다(운영 콘솔의 그 학원 화면으로 돌아가는 데만 쓴다).
    expect(await tenantViewState()).toEqual({ state: "ended", tenantId: TENANT });
    expect(await isTenantViewWriteBlocked()).toBe(true);
    expect(await isTenantViewRequest()).toBe(false);
    expect(await liveTenantView()).toBeNull();
    expect(await tenantViewWriteError()).toBe("읽기 전용 보기에서는 저장할 수 없습니다");
    request([viewCookie(), ...sessionCookie(OPERATOR)]);
    state.view = { ...liveRow(), expires_at: new Date(Date.now() - 1000).toISOString() };
    expect((await tenantViewState()).state).toBe("ended");
  });

  it("🔴 그런 기록이 없으면(누가 만들어 넣은 쿠키) '아님' — 그 사람의 저장이 막히지 않는다", async () => {
    state.view = null;
    expect(await tenantViewState()).toEqual({ state: "none" });
    expect(await isTenantViewWriteBlocked()).toBe(false);
    const user = await getCurrentUser();
    expect(user?.tenantId).toBe(OWN_TENANT);
    expect(user?.tenantView).toBeUndefined();
    // 기록 하나를 찾아본 것이 전부다.
    expect(state.adminCalls).toEqual(["operator_tenant_views"]);
  });

  it("🔴 앱은 DB보다 1분 먼저 끝난 것으로 본다(한 화면에 두 지점이 섞이지 않게)", async () => {
    state.view = { ...liveRow(), expires_at: new Date(Date.now() + 30_000).toISOString() };
    expect((await tenantViewState()).state).toBe("ended");
    request([viewCookie(), ...sessionCookie(OPERATOR)]);
    state.view = { ...liveRow(), expires_at: new Date(Date.now() + 120_000).toISOString() };
    expect((await tenantViewState()).state).toBe("live");
  });

  it("기록의 주인이 쿠키에 적힌 사람과 다르면 '아님'(남의 토큰에 제 id를 붙여 넣은 쿠키 — 우리가 내 준 것이 아니다)", async () => {
    state.view = { ...liveRow(), operator_id: OTHER };
    expect((await tenantViewState()).state).toBe("none");
    request([viewCookie(), ...sessionCookie(OPERATOR)]);
    state.view = { ...liveRow(), operator_id: OTHER, ended_at: new Date().toISOString() };
    expect((await tenantViewState()).state).toBe("none");
  });

  it("운영자 명단에서 빠졌거나 지점이 없어졌으면 '끝난 보기'", async () => {
    state.operator = null;
    expect((await tenantViewState()).state).toBe("ended");
    request([viewCookie(), ...sessionCookie(OPERATOR)]);
    state.operator = { id: OPERATOR, email: "ops@example.com", display_name: "x" };
    state.tenant = null;
    expect((await tenantViewState()).state).toBe("ended");
  });

  it("🔴 표식 쿠키만 남았어도(토큰 쿠키가 지워졌다) 운영자의 브라우저면 '끝난 보기'", async () => {
    request([markCookie(), ...sessionCookie(OPERATOR)]);
    expect(await tenantViewState()).toEqual({ state: "ended" });
    expect(await isTenantViewWriteBlocked()).toBe(true);
    // 토큰 쿠키의 모양이 깨졌을 때도 같다.
    request([{ name: TENANT_VIEW_COOKIE, value: "broken" }, markCookie(), ...sessionCookie(OPERATOR)]);
    expect((await tenantViewState()).state).toBe("ended");
    // 운영자 명단만 찾아본다(보기 기록은 찾을 토큰이 없다).
    expect(state.adminCalls).toEqual(["super_admins", "super_admins"]);
  });

  it("🔴 표식 쿠키는 누구나 쓸 수 있다 — 운영자가 아닌 사람의 브라우저에 있어도 '아님'(저장이 막히지 않는다)", async () => {
    state.operator = null; // 운영자 명단에 없다
    request([markCookie(), ...sessionCookie(OPERATOR)]);
    expect(await tenantViewState()).toEqual({ state: "none" });
    expect(await isTenantViewWriteBlocked()).toBe(false);
    const user = await getCurrentUser();
    expect(user?.tenantId).toBe(OWN_TENANT);
  });

  it("표식만 남았는데 운영자인지 확인하지 못했으면 '확인하지 못함'", async () => {
    state.operatorError = { message: "timeout" };
    request([markCookie(), ...sessionCookie(OPERATOR)]);
    expect(await tenantViewState()).toEqual({ state: "unknown" });
  });

  it("표식 쿠키만 남았는데 남의 것이거나 · 비로그인이거나 · 운영 콘솔 주소면 조회 없이 '아님'", async () => {
    request([markCookie(OPERATOR), ...sessionCookie(OTHER)]);
    expect((await tenantViewState()).state).toBe("none");
    request([markCookie()]);
    expect((await tenantViewState()).state).toBe("none");
    request([markCookie(), ...sessionCookie(OPERATOR)]);
    state.pathname = "/super-admin/tenants";
    expect((await tenantViewState()).state).toBe("none");
    expect(state.adminCalls).toEqual([]);
  });

  it("보기 기록 표가 아직 없으면(SQL 적용 전) '아님' — 기능이 없는 것과 같다", async () => {
    state.view = null;
    state.viewError = { message: "Could not find the table", code: "PGRST205" };
    expect((await tenantViewState()).state).toBe("none");
    expect(await isTenantViewWriteBlocked()).toBe(false);
  });

  it("🔴 확인하지 못했으면(조회 실패) 보기는 적용하지 않되 **쓰기는 막는다**", async () => {
    state.view = null;
    state.viewError = { message: "fetch failed" };
    expect(await tenantViewState()).toEqual({ state: "unknown" });
    expect(await liveTenantView()).toBeNull();
    expect(await isTenantViewRequest()).toBe(false);
    expect(await isTenantViewWriteBlocked()).toBe(true);
    request([viewCookie(), ...sessionCookie(OPERATOR)]);
    state.view = liveRow();
    state.viewError = null;
    state.operatorError = { message: "timeout" };
    expect(await tenantViewState()).toEqual({ state: "unknown" });
  });
});

describe("지점 보기 판정 — DB가 실제로 그 지점으로 답할 때만 '보는 중'이다", () => {
  it("앱이 실어 보낼 헤더 그대로(로그인 토큰 + 보기 토큰) 지점 함수를 읽기 요청으로 부른다", async () => {
    expect((await tenantViewState()).state).toBe("live");
    expect(state.dbCalls).toEqual([
      {
        url: "https://projref.supabase.co/rest/v1/rpc/auth_tenant_id",
        method: "GET",
        headers: { apikey: "anon", authorization: `Bearer ${ACCESS_TOKEN}`, accept: "application/json", [TENANT_VIEW_HEADER]: TOKEN },
      },
    ]);
  });

  it("🔴 DB가 다른 값으로 답하면(본인 지점 · null) '끝난 보기'다 — 띠 아래에 본인 지점 데이터가 나오는 화면을 그리지 않는다", async () => {
    for (const body of [OWN_TENANT, null]) {
      request([viewCookie(), ...sessionCookie(OPERATOR)]);
      state.db = { status: 200, body, fail: false };
      expect(await tenantViewState(), String(body)).toEqual({ state: "ended", tenantId: TENANT });
      expect(await isTenantViewWriteBlocked()).toBe(true);
    }
    await expect(getCurrentUser()).rejects.toThrow(`REDIRECT:/tenant-view/exit?why=ended&t=${TENANT}`);
  });

  it("물어보지 못했으면(로그인 토큰 만료 · 통신 실패) 보기 기록대로 간다", async () => {
    state.db = { status: 401, body: { code: "PGRST301", message: "JWT expired" }, fail: false };
    expect((await tenantViewState()).state).toBe("live");
    request([viewCookie(), ...sessionCookie(OPERATOR)]);
    state.db = { status: 200, body: TENANT, fail: true };
    expect((await tenantViewState()).state).toBe("live");
  });

  it("로그인 쿠키에 토큰이 없으면 묻지 않고 보기 기록대로 간다", async () => {
    request([viewCookie(), ...sessionCookie(OPERATOR, { noToken: true })]);
    expect((await tenantViewState()).state).toBe("live");
    expect(state.dbCalls).toEqual([]);
  });

  it("dbHonorsTenantView: 같은 지점이면 true · 다른 값이면 false · 못 물으면 null", async () => {
    expect(await dbHonorsTenantView(ACCESS_TOKEN, TOKEN, TENANT)).toBe(true);
    state.db = { status: 200, body: OWN_TENANT, fail: false };
    expect(await dbHonorsTenantView(ACCESS_TOKEN, TOKEN, TENANT)).toBe(false);
    state.db = { status: 200, body: null, fail: false };
    expect(await dbHonorsTenantView(ACCESS_TOKEN, TOKEN, TENANT)).toBe(false);
    state.db = { status: 503, body: {}, fail: false };
    expect(await dbHonorsTenantView(ACCESS_TOKEN, TOKEN, TENANT)).toBeNull();
    state.db = { status: 200, body: TENANT, fail: true };
    expect(await dbHonorsTenantView(ACCESS_TOKEN, TOKEN, TENANT)).toBeNull();
  });

  it("주인이 아니거나 기록이 죽었으면 DB에 묻지도 않는다", async () => {
    request([viewCookie(TOKEN, OPERATOR), ...sessionCookie(OTHER)]);
    await tenantViewState();
    request([viewCookie(), ...sessionCookie(OPERATOR)]);
    state.view = { ...liveRow(), ended_at: new Date().toISOString() };
    await tenantViewState();
    expect(state.dbCalls).toEqual([]);
  });
});

describe("지점 보기 판정 — 한 요청 = 한 판정", () => {
  it("🔴 같은 요청에서 여러 번 물어도 조회는 한 번이고 답이 같다", async () => {
    const a = await tenantViewState();
    // 요청 도중 기록이 끝나도(다른 탭에서 끝냄) 이 요청의 답은 바뀌지 않는다 — 사람 · 헤더 · 쓰기 차단이 갈리지 않는다.
    state.view = { ...liveRow(), ended_at: new Date().toISOString() };
    const b = await tenantViewState();
    expect(b).toBe(a);
    expect(await isTenantViewWriteBlocked()).toBe(true);
    expect(state.adminCalls).toEqual(["operator_tenant_views", "super_admins", "tenants"]);
    expect(state.dbCalls.length).toBe(1);
  });

  it("동시에 물어도 조회는 한 번이다", async () => {
    const all = await Promise.all([tenantViewState(), tenantViewState(), isTenantViewWriteBlocked(), liveTenantView()]);
    expect(all[0]).toBe(all[1]);
    expect(state.adminCalls).toEqual(["operator_tenant_views", "super_admins", "tenants"]);
  });

  it("다음 요청(새 쿠키 저장소)은 다시 본다", async () => {
    expect((await tenantViewState()).state).toBe("live");
    request([viewCookie(), ...sessionCookie(OPERATOR)]);
    state.view = { ...liveRow(), ended_at: new Date().toISOString() };
    expect((await tenantViewState()).state).toBe("ended");
  });
});

describe("로그인 쿠키에서 사용자 id 읽기(검증 없음 — 조회할지만 가른다)", () => {
  const KEY = "sb-projref-auth-token";
  it("한 덩어리 · 조각난 쿠키 · base64 · 원문 JSON을 모두 읽는다", () => {
    expect(unverifiedSessionUserId(sessionCookie(OPERATOR), KEY)).toBe(OPERATOR);
    expect(unverifiedSessionUserId(sessionCookie(OPERATOR, { chunked: true }), KEY)).toBe(OPERATOR);
    expect(unverifiedSessionUserId(sessionCookie(OPERATOR, { raw: true }), KEY)).toBe(OPERATOR);
  });

  it("로그인 토큰도 함께 꺼낸다(모양이 토큰일 때만)", () => {
    expect(readSessionCookie(sessionCookie(OPERATOR), KEY)).toEqual({ userId: OPERATOR, accessToken: ACCESS_TOKEN });
    expect(readSessionCookie(sessionCookie(OPERATOR, { noToken: true }), KEY)).toEqual({ userId: OPERATOR, accessToken: null });
    expect(readSessionCookie([{ name: KEY, value: JSON.stringify({ access_token: "not-a-jwt", user: { id: OPERATOR } }) }], KEY)).toEqual({ userId: OPERATOR, accessToken: null });
  });

  it("세션에 user가 없으면 토큰 본문의 sub를 읽는다", () => {
    const payload = Buffer.from(JSON.stringify({ sub: OTHER }), "utf8").toString("base64url");
    const json = JSON.stringify({ access_token: `h.${payload}.s` });
    expect(unverifiedSessionUserId([{ name: KEY, value: `base64-${Buffer.from(json).toString("base64url")}` }], KEY)).toBe(OTHER);
  });

  it("읽지 못하면 null(= 보기가 아닌 것으로 본다)", () => {
    expect(unverifiedSessionUserId([], KEY)).toBeNull();
    expect(unverifiedSessionUserId([{ name: KEY, value: "base64-@@@" }], KEY)).toBeNull();
    expect(unverifiedSessionUserId([{ name: KEY, value: "{not json" }], KEY)).toBeNull();
    expect(unverifiedSessionUserId([{ name: KEY, value: JSON.stringify({ user: { id: "x" } }) }], KEY)).toBeNull();
    // 로그인 쿠키가 아닌 것(코드 검증용 쿠키 등)은 보지 않는다.
    expect(unverifiedSessionUserId([{ name: `${KEY}-code-verifier`, value: JSON.stringify({ user: { id: OPERATOR } }) }], KEY)).toBeNull();
  });

  it("이 앱의 프로젝트 쿠키를 먼저 본다 — 다른 프로젝트의 쿠키가 섞여 있어도", () => {
    const other = [{ name: "sb-otherproj-auth-token", value: JSON.stringify({ user: { id: OTHER } }) }];
    expect(unverifiedSessionUserId([...other, ...sessionCookie(OPERATOR)], KEY)).toBe(OPERATOR);
    // 이름 규칙으로 못 찾았고 후보가 여럿이면 고르지 않는다.
    expect(unverifiedSessionUserId([...other, { name: "sb-third-auth-token", value: JSON.stringify({ user: { id: OPERATOR } }) }], KEY)).toBeNull();
    // 후보가 하나뿐이면 그것을 본다(이름 규칙이 달라진 경우).
    expect(unverifiedSessionUserId(other, KEY)).toBe(OTHER);
  });
});

describe("지점 보기 중의 현재 사용자", () => {
  it("본인이 연 살아 있는 보기면 그 지점 원장의 자리에서 읽는다 — id는 본인 그대로", async () => {
    expect(await getCurrentUser()).toEqual({
      id: OPERATOR, tenantId: TENANT, email: "ops@example.com", displayName: "운영 담당", jobTitle: null, systemRole: "master",
      tenantView: { tenantId: TENANT, tenantName: "지점 B" },
    });
  });

  it("지점 소속이 없는 운영 계정(users 행 없음)도 보기 중에는 그 지점으로 잡힌다", async () => {
    state.usersRow = null;
    const user = await getCurrentUser();
    expect(user?.tenantId).toBe(TENANT);
    expect(user?.tenantView).toEqual({ tenantId: TENANT, tenantName: "지점 B" });
  });

  it("🔴 검증된 로그인 id가 보기의 주인과 다르면 본인 그대로다(쿠키만 맞춘 경우)", async () => {
    state.sub = OTHER;
    state.usersRow = { id: OTHER, tenant_id: OWN_TENANT, email: "t@example.com", display_name: "강사", job_title: null, system_role: "teacher", status: "active" };
    const user = await getCurrentUser();
    expect(user?.tenantId).toBe(OWN_TENANT);
    expect(user?.systemRole).toBe("teacher");
    expect(user?.tenantView).toBeUndefined();
  });

  it("보기가 아니면 종전 그대로(본인 지점 · 본인 역할)", async () => {
    request(sessionCookie(OPERATOR));
    const user = await getCurrentUser();
    expect(user?.tenantId).toBe(OWN_TENANT);
    expect(user?.tenantView).toBeUndefined();
    expect(state.adminCalls).toEqual([]);
  });

  it("🔴 끝난 보기: 화면 요청은 그리지 않고 '보기 끝내기'로 보낸다(띠 아래에 본인 지점 화면이 뜨지 않게)", async () => {
    state.view = { ...liveRow(), ended_at: new Date().toISOString() };
    // 보던 지점을 함께 싣는다 — 겹쳐 온 다른 끝내기 요청이 쿠키를 먼저 지웠어도 그 학원의 화면으로 돌아간다.
    await expect(getCurrentUser()).rejects.toThrow(`REDIRECT:/tenant-view/exit?why=ended&t=${TENANT}`);
    // 표식만 남은 경우도 끝내기로 간다(기록을 읽지 않아 지점은 싣지 않는다).
    request([markCookie(), ...sessionCookie(OPERATOR)]);
    let thrown = "";
    await getCurrentUser().catch((e: Error) => { thrown = e.message; });
    expect(thrown).toBe("REDIRECT:/tenant-view/exit?why=ended");
  });

  it("🔴 확인하지 못한 요청: 화면 요청은 그리지 않고 안내 화면으로 보낸다(보는 지점으로도 본인 지점으로도 그리지 않는다)", async () => {
    state.view = null;
    state.viewError = { message: "fetch failed" };
    await expect(getCurrentUser()).rejects.toThrow("REDIRECT:/tenant-view/unconfirmed");
  });

  it("🔴 끝난 보기 · 확인하지 못한 요청의 서버 액션과 `/api/*`는 이동시키지 않되 **본인으로 답하지도 않는다**(로그인하지 않은 것으로 본다)", async () => {
    // 본인으로 답하면 '읽기 전용 보기' 띠가 달린 탭에 본인 지점의 검색 결과 · 내려받기가 뜬다.
    for (const where of ["action", "api"] as const) {
      for (const dead of ["ended", "unknown"] as const) {
        request([viewCookie(), ...sessionCookie(OPERATOR)]);
        state.pathname = where === "api" ? null : "/students";
        state.nextAction = where === "action" ? "40abc" : null;
        state.view = dead === "ended" ? { ...liveRow(), ended_at: new Date().toISOString() } : null;
        state.viewError = dead === "ended" ? null : { message: "fetch failed" };
        expect(await getCurrentUser(), `${where}/${dead}`).toBeNull();
        expect(await isTenantViewWriteBlocked(), `${where}/${dead}`).toBe(true);
      }
    }
  });

  it("사람을 못 읽은 화면이 갈 곳: 끝난 보기면 끝내기 · 확인하지 못했으면 안내 화면 · 그 밖(평소의 비로그인 · 보는 중)에는 없음", async () => {
    state.view = { ...liveRow(), ended_at: new Date().toISOString() };
    expect(await tenantViewSignedOutRedirect()).toBe(`/tenant-view/exit?why=ended&t=${TENANT}`);
    request([viewCookie(), ...sessionCookie(OPERATOR)]);
    state.view = null;
    state.viewError = { message: "fetch failed" };
    expect(await tenantViewSignedOutRedirect()).toBe("/tenant-view/unconfirmed");
    request([viewCookie(), ...sessionCookie(OPERATOR)]);
    state.view = liveRow();
    state.viewError = null;
    expect(await tenantViewSignedOutRedirect()).toBeNull();
    // 보기 쿠키가 없으면 조회 없이 null(종전대로 로그인 화면으로 간다).
    state.adminCalls = [];
    request([]);
    expect(await tenantViewSignedOutRedirect()).toBeNull();
    expect(state.adminCalls).toEqual([]);
  });

  it("화면 요청 판정: proxy가 주소를 적어 준 요청이고 서버 액션이 아니다", async () => {
    state.pathname = "/students";
    expect(await isTenantViewScreenRequest()).toBe(true);
    state.nextAction = "40abc";
    expect(await isTenantViewScreenRequest()).toBe(false);
    state.nextAction = null;
    state.pathname = null;
    expect(await isTenantViewScreenRequest()).toBe(false);
  });
});
