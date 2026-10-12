import "server-only";
import { cookies, headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { createRawAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/env";
import {
  isOperatorConsolePath,
  isUuid,
  parseTenantViewCookie,
  parseTenantViewMark,
  TENANT_VIEW_COOKIE,
  TENANT_VIEW_EARLY_CUTOFF_SECONDS,
  TENANT_VIEW_ENDED_EXIT_HREF,
  TENANT_VIEW_HEADER,
  TENANT_VIEW_MARK_COOKIE,
  TENANT_VIEW_READONLY_MESSAGE,
  TENANT_VIEW_UNCONFIRMED_PATH,
} from "@/lib/auth/tenant-view-shared";

/**
 * 운영 콘솔의 '지점 보기'(읽기 전용) — 지금 요청이 보기 중인지의 **단일 판정**.
 *
 * 구조(0356a 머리 주석이 정본):
 * - 운영 콘솔이 `operator_tenant_views`에 한 줄을 넣고 토큰을 그 브라우저의 쿠키에 둔다.
 * - 이 판정이 '보는 중'(live)이라고 답한 요청에만 세션 클라이언트가 토큰 헤더를 실어 보내고(server.ts),
 *   DB는 **읽기 전용 요청일 때만** 그 지점으로 답한다. 쓰기 요청은 데이터 접근 층이 먼저 막는다(tenant-view-guard.ts).
 * - 로그인한 사람은 운영자 본인 그대로다(`auth.uid()`가 바뀌지 않는다). 바뀌는 것은 "어느 지점을 읽느냐"뿐이다.
 *
 * 🔴 **한 요청 = 한 판정.** 사람(getCurrentUser) · 헤더(server.ts) · 쓰기 차단(두 클라이언트) · 권한 캡(perm-matrix)이
 *    전부 이 함수의 **같은 결과**를 읽는다. 따로 판정하면 "사람은 보는 지점인데 쓰기 차단은 꺼진" 요청이 생긴다
 *    (그때 service-role 쓰기가 보는 지점에 그대로 들어간다). React `cache()`는 서버 액션 · 라우트 핸들러에서 요청 단위로
 *    묶이지 않으므로, 요청마다 하나뿐인 쿠키 저장소 객체에 결과를 매단다.
 * 🔴 쿠키는 신뢰하지 않는다 — 요청마다 DB에서 그 줄이 살아 있는지(끝나지 않음 · 만료 전 · 명단에 있음)를 다시 본다.
 * 🔴 **평소 요청에는 비용이 붙지 않는다** — 보기 쿠키가 없으면 조회 0이고, 있어도 그 쿠키의 주인이 지금 로그인한 사람이
 *    아니면(같은 브라우저에 남은 다른 계정의 것) 조회 0이다.
 * 🔴 **내 보기 쿠키가 남아 있는데 보기가 아니면 `none`이 아니라 `ended`다.** 그 브라우저에는 '읽기 전용 보기' 띠를 단 탭이
 *    남아 있을 수 있다. 그 요청을 평소 요청(`none`)으로 받으면 띠는 읽기 전용인데 저장은 **본인 지점에 되는** 화면이 생긴다
 *    (적대적 리뷰 2026-10-12). 그래서 `ended`는 쓰기를 막고, 화면 요청은 '보기 끝내기'로 보낸다(current-user.ts).
 * 🔴 **`ended`는 근거가 있을 때만 낸다** — 그 토큰의 기록이 실제로 있고 주인이 맞을 때(= 우리가 내 준 쿠키일 때), 표식만 남은
 *    경우에는 그 사람이 운영자 명단에 있을 때. 쿠키는 누구나 만들어 넣을 수 있다(표식은 자바스크립트로도 쓴다). 쿠키만 보고
 *    `ended`를 내면 누가 심은 쿠키 한 줄로 **보기와 무관한 사용자의 저장이 전부 막힌다.** 근거가 없으면 `none`이다.
 * 🔴 운영 콘솔(`/admin` · `/super-admin/…`)에서는 보기를 적용하지 않는다 — 콘솔의 저장이 '읽기 전용'에 막히면 안 된다.
 * 🔴 **DB에 한 번 물어보고 나서야 '보는 중'이다**(`dbHonorsTenantView`) — DB는 헤더를 실은 요청이 살아 있는 보기가 아니면
 *    말없이 본인 지점으로 답한다(0356a). 앱만 '보는 중'이라 믿고 화면을 그리면 "읽기 전용 보기 · ○○ 지점" 띠 아래에 운영자
 *    본인 지점의 데이터가 나온다. 그래서 앱이 실어 보낼 헤더 그대로 지점 함수를 불러, 그 지점이 실제로 나올 때만 보기로 본다.
 */

export type TenantView = {
  token: string;
  /** 보는 사람(로그인 계정 id). */
  operatorId: string;
  operatorEmail: string;
  operatorName: string;
  tenantId: string;
  tenantName: string;
  expiresAt: string;
};

/**
 * - `none`    = 보기가 아니다(평소 요청). 이 사람의 보기 쿠키가 이 브라우저에 없다.
 * - `live`    = 살아 있는 보기. 사람 · 헤더 · 쓰기 차단 · 권한 캡이 전부 적용된다.
 * - `ended`   = 이 사람이 열었던 보기의 쿠키가 남아 있는데 **보기가 아니다**(끝남 · 만료 · 명단에서 빠짐 · DB가 받아 주지
 *               않음 · 운영자의 브라우저에 표식만 남음). 보기는 적용하지 않고 쓰기는 **막는다**. 화면 요청은 '보기 끝내기'로
 *               보내 쿠키를 지우고, 그 밖의 요청(서버 액션 · `/api/*`)은 로그인하지 않은 것으로 본다(current-user.ts).
 * - `unknown` = 이 사람의 보기 쿠키는 있는데 지금 확인하지 못했다(조회 실패). 보기는 **적용하지 않고**(본인 그대로)
 *               쓰기는 **막는다** — 확인하지 못한 채 어느 한쪽으로 기울면 본인 지점이든 보는 지점이든 엉뚱한 곳에 써진다.
 *               화면 요청은 그리지 않고 안내 화면으로 보낸다(current-user.ts).
 */
export type TenantViewState =
  | { state: "none" }
  | { state: "unknown" }
  | { state: "ended" }
  | { state: "live"; view: TenantView };

const NONE: TenantViewState = { state: "none" };
const UNKNOWN: TenantViewState = { state: "unknown" };
const ENDED: TenantViewState = { state: "ended" };

type CookieJar = { get(name: string): { value: string } | undefined; getAll(): { name: string; value: string }[] };

/** 요청마다 하나뿐인 쿠키 저장소 객체 → 그 요청의 판정. 요청이 끝나면 함께 사라진다. */
const memo = new WeakMap<object, Promise<TenantViewState>>();

/**
 * 이 요청의 보기 판정. 요청 밖(cron 본문 · 캐시 함수 · 스크립트)에서 불리면 쿠키를 읽을 수 없어 `none`이다.
 * 던지지 않는다(Next가 흐름 제어에 쓰는 신호는 그대로 다시 던진다).
 */
export async function tenantViewState(): Promise<TenantViewState> {
  let jar: CookieJar;
  try {
    jar = await cookies();
  } catch (e) {
    unstable_rethrow(e);
    return NONE;
  }
  // 평소 요청은 여기서 끝난다 — 쿠키 두 개(토큰 · 표식)를 찾아보는 것이 전부다.
  // 표식만 남은 경우(토큰 쿠키만 지워졌다)도 본다: 그 브라우저의 탭은 표식을 믿고 '보는 중'이라 여긴다.
  const cookie = parseTenantViewCookie(jar.get(TENANT_VIEW_COOKIE)?.value);
  const markOwner = cookie ? null : (parseTenantViewMark(jar.get(TENANT_VIEW_MARK_COOKIE)?.value)?.operatorId ?? null);
  if (!cookie && !markOwner) return NONE;
  let pending = memo.get(jar);
  if (!pending) {
    pending = resolveState(jar, cookie, cookie?.operatorId ?? markOwner!);
    memo.set(jar, pending);
  }
  return pending;
}

async function resolveState(jar: CookieJar, cookie: { token: string; operatorId: string } | null, ownerId: string): Promise<TenantViewState> {
  // ① 이 쿠키의 주인이 지금 로그인한 사람인가. 로그인 쿠키가 없거나(비로그인 · 공개 화면) 다른 계정이면 보기가 아니다.
  //    여기서 읽는 id는 **검증하지 않은 값**이다 — "조회할지"를 가르는 데만 쓴다. 사람을 정하는 쪽(getCurrentUser)은
  //    검증된 id로 한 번 더 맞춰 본다.
  const session = readSessionCookie(jar.getAll(), sessionCookieKey());
  if (!session || session.userId !== ownerId) return NONE;

  // ② 운영 콘솔 주소면 보기를 적용하지 않는다.
  //    이 주소는 proxy가 적어 준 값이다. `/api/*`는 proxy를 지나지 않아(proxy.ts) 값이 없거나 요청이 실어 보낸 것인데,
  //    거기서 콘솔 주소를 흉내 내도 얻는 것은 "보기 미적용 = 본인으로 동작"뿐이다(사람 · 헤더 · 쓰기 차단이 함께 꺼진다).
  try {
    if (isOperatorConsolePath((await headers()).get("x-pathname"))) return NONE;
  } catch (e) {
    unstable_rethrow(e);
  }

  // 표식만 남았다 — 토큰이 없으니 보기일 수 없다. 운영자의 브라우저라면 띠를 단 탭이 남아 있을 수 있어 '끝난 보기'로 본다.
  // 운영자가 아니면 아무 일도 아니다(표식은 누구나 쓸 수 있는 쿠키다 — 그것만으로 남의 저장을 막지 않는다).
  if (!cookie) {
    try {
      const { data, error } = await createRawAdminClient().from("super_admins").select("id").eq("id", ownerId).maybeSingle();
      if (error) return isMissingRelation(error) ? NONE : UNKNOWN;
      return data ? ENDED : NONE;
    } catch (e) {
      unstable_rethrow(e);
      return UNKNOWN;
    }
  }

  // ③ DB에서 그 줄을 다시 본다.
  try {
    const admin = createRawAdminClient();
    const { data: row, error } = await admin
      .from("operator_tenant_views")
      .select("token, operator_id, tenant_id, expires_at, ended_at")
      .eq("token", cookie.token)
      .maybeSingle();
    if (error) return isMissingRelation(error) ? NONE : UNKNOWN;
    // 🔴 그런 기록이 없거나 주인이 다르면 **우리가 내 준 쿠키가 아니다** → 평소 요청이다(누가 만들어 넣은 쿠키로 저장이 막히지 않는다).
    //    띠를 단 탭은 실제 기록이 있었던 보기에서만 생긴다(기록은 30일 뒤에야 지워지고 쿠키는 2시간이면 사라진다).
    if (!row || row.operator_id !== cookie.operatorId) return NONE;
    if (row.ended_at) return ENDED;
    if (Date.parse(row.expires_at as string) - Date.now() <= TENANT_VIEW_EARLY_CUTOFF_SECONDS * 1000) return ENDED;
    const [operator, tenant] = await Promise.all([
      admin.from("super_admins").select("id, email, display_name").eq("id", row.operator_id as string).maybeSingle(),
      admin.from("tenants").select("id, name").eq("id", row.tenant_id as string).maybeSingle(),
    ]);
    if (operator.error || tenant.error) return UNKNOWN;
    // 운영자 명단에서 빠졌거나 지점이 없어졌으면 보기가 아니다(DB도 같은 조건으로 거른다).
    if (!operator.data || !tenant.data) return ENDED;
    // ④ DB가 이 요청을 실제로 그 지점의 보기로 받아 주는가. 분명히 아니라고 하면(다른 값) 보기가 아니다 —
    //    로그인 토큰의 주인이 다르거나, DB 쪽에서 먼저 끝났거나, 헤더가 DB에 닿는 모양이 달라진 경우다.
    //    물어보지 못한 것(토큰 갱신 직전 · 통신 실패)은 위 기록대로 간다 — 그 요청의 조회는 세션 클라이언트가 토큰을 갱신해 보낸다.
    if (session.accessToken && (await dbHonorsTenantView(session.accessToken, cookie.token, tenant.data.id as string)) === false) return ENDED;
    return {
      state: "live",
      view: {
        token: cookie.token,
        operatorId: operator.data.id as string,
        operatorEmail: (operator.data.email as string | null) ?? "",
        operatorName: ((operator.data.display_name as string | null) ?? "").trim() || "운영자",
        tenantId: tenant.data.id as string,
        tenantName: (tenant.data.name as string | null) ?? "",
        expiresAt: row.expires_at as string,
      },
    };
  } catch (e) {
    unstable_rethrow(e);
    return UNKNOWN;
  }
}

/** 표가 아직 없다(SQL 적용 전) — 보기 기능이 없는 것과 같다. */
function isMissingRelation(error: { code?: string | null }): boolean {
  return error.code === "42P01" || error.code === "PGRST205";
}

/**
 * DB가 지금 이 로그인 토큰 + 이 보기 토큰을 **그 지점의 보기로 받아 주는가** — 앱이 실어 보낼 헤더 그대로 지점 함수를 한 번 부른다
 * (읽기 요청 = 읽기 전용 트랜잭션).
 * - `true`  = 그 지점이 나온다.
 * - `false` = 분명히 다른 값이 나온다(DB는 이 요청을 보기로 보지 않는다).
 * - `null`  = 물어보지 못했다(로그인 토큰 만료 · 통신 실패 · 오류 응답).
 */
export async function dbHonorsTenantView(accessToken: string, viewToken: string, tenantId: string): Promise<boolean | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/auth_tenant_id`, {
      method: "GET",
      headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${accessToken}`, accept: "application/json", [TENANT_VIEW_HEADER]: viewToken },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return ((await res.json()) as unknown) === tenantId;
  } catch (e) {
    unstable_rethrow(e);
    return null;
  }
}

/** 살아 있는 보기(없으면 null). */
export async function liveTenantView(): Promise<TenantView | null> {
  const s = await tenantViewState();
  return s.state === "live" ? s.view : null;
}

/**
 * 지금 요청의 쓰기를 막아야 하는가 — 보는 중이거나, 이 사람의 보기 쿠키가 남아 있는데 보기가 아니거나(`ended`),
 * 확인하지 못했을 때(`unknown`). 곧 **이 사람의 보기 쿠키가 이 브라우저에 하나라도 남아 있으면** 막는다.
 * 두 Supabase 클라이언트의 쓰기 가드와, 그 가드를 지나지 않는 쓰기(직접 DB 접속 등)의 입구가 묻는다.
 */
export async function isTenantViewWriteBlocked(): Promise<boolean> {
  return (await tenantViewState()).state !== "none";
}

/**
 * 쓰기 · 발신을 하는 서버 코드의 공용 문 — 보기 중이면 거절 사유(한글), 아니면 null.
 *
 * 🔴 Supabase를 **거치지 않는** 일(외부로 나가는 요청 · DB 직접 접속 · 다른 저장소)은 데이터 접근 층의 쓰기 차단에 걸리지
 *    않는다. 그런 일을 하는 진입점은 이 함수를 먼저 지나야 한다(가드: tenant-view-wiring.test.ts가 목록을 잠근다).
 */
export async function tenantViewWriteError(): Promise<string | null> {
  return (await isTenantViewWriteBlocked()) ? TENANT_VIEW_READONLY_MESSAGE : null;
}

/** 위와 같은 문 — 던지는 판(값을 돌려줄 수 없는 자리용). */
export async function assertNotTenantView(): Promise<void> {
  const error = await tenantViewWriteError();
  if (error) throw new Error(error);
}

/** 지금 요청이 살아 있는 보기인가 — 화면 · 권한 쪽의 가벼운 물음. */
export async function isTenantViewRequest(): Promise<boolean> {
  return (await tenantViewState()).state === "live";
}

/**
 * 화면 요청(페이지 · 주소로 여는 라우트)인가 — proxy가 주소를 적어 준 요청이고(= `/api/*`가 아니다) 서버 액션이 아니다.
 * `ended` · `unknown`일 때 "그리지 말고 내보낼지"를 가르는 데만 쓴다(current-user.ts). 서버 액션과 `/api/*`는 내보내지 않는다 —
 * 액션의 이동은 Next가 서버에서 대신 받아 와 쿠키 지우기가 브라우저에 닿지 않고, `/api/*`는 화면이 아니다. 그 둘은 쓰기만 막힌다.
 */
export async function isTenantViewScreenRequest(): Promise<boolean> {
  try {
    const h = await headers();
    return Boolean(h.get("x-pathname")) && !h.get("next-action");
  } catch (e) {
    unstable_rethrow(e);
    return false;
  }
}

/**
 * 사람을 못 읽은 화면이 `/login` 대신 가야 할 곳 — 끝난 보기면 '보기 끝내기', 확인하지 못했으면 안내 화면, 그 밖에는 null.
 *
 * 끝난 보기 · 확인하지 못한 요청은 화면 요청이 아니면 "로그인하지 않은 것"으로 답한다(current-user.ts). 그런데 서버 액션 뒤에
 * 같은 요청 안에서 화면을 다시 그릴 때도 화면 요청이 아니어서, 셸이 그 답을 받아 로그인 화면으로 보내면 **로그인돼 있는데
 * 로그인 화면**이 뜬다. 셸은 이 함수를 먼저 본다(보기 쿠키가 없으면 조회 없이 null — 평소의 비로그인은 종전대로 `/login`).
 */
export async function tenantViewSignedOutRedirect(): Promise<string | null> {
  const { state } = await tenantViewState();
  return state === "ended" ? TENANT_VIEW_ENDED_EXIT_HREF : state === "unknown" ? TENANT_VIEW_UNCONFIRMED_PATH : null;
}

/** 서버의 지금 시각(ms) — 셸이 화면 감시(tenant-view-sync.tsx)에 내려 준다. 그 기기의 시계가 틀려도 끝나는 때를 서버 기준으로 맞추려는 값이다. */
export function tenantViewServerNow(): number {
  return Date.now();
}

/** Supabase 로그인 쿠키의 이름(프로젝트마다 다르다) — supabase-js 기본 규칙: `sb-<주소의 첫 마디>-auth-token`. */
function sessionCookieKey(): string | null {
  try {
    return `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
  } catch {
    return null;
  }
}

/**
 * 로그인 쿠키에서 사용자 id와 로그인 토큰을 꺼낸다 — **서명을 검증하지 않는다**(그래서 가볍다: 네트워크도 DB도 안 탄다).
 * 쿠키는 한 덩어리(`<키>`)이거나 조각(`<키>.0`, `<키>.1`, …)이고, 값은 세션 JSON 또는 `base64-` + base64url(JSON)이다.
 * 읽지 못하면 null(= 보기가 아닌 것으로 본다 — 안전한 쪽).
 */
export function readSessionCookie(
  all: ReadonlyArray<{ name: string; value: string }>,
  expectedKey: string | null,
): { userId: string; accessToken: string | null } | null {
  const groups = new Map<string, { whole?: string; chunks: Map<number, string> }>();
  for (const c of all) {
    const m = /^(sb-.+-auth-token)(?:\.(\d+))?$/.exec(c.name);
    if (!m) continue;
    const g = groups.get(m[1]!) ?? { chunks: new Map<number, string>() };
    if (m[2] === undefined) g.whole = c.value;
    else g.chunks.set(Number(m[2]), c.value);
    groups.set(m[1]!, g);
  }
  // 이 앱의 프로젝트 쿠키를 먼저 본다. 이름 규칙이 달라졌을 때만(못 찾았을 때만) 하나뿐인 다른 쿠키를 본다.
  const group = (expectedKey ? groups.get(expectedKey) : undefined) ?? (groups.size === 1 ? [...groups.values()][0] : undefined);
  if (!group) return null;
  let raw = group.whole ?? "";
  if (!raw) {
    for (let i = 0; group.chunks.has(i); i++) raw += group.chunks.get(i);
  }
  if (!raw) return null;
  try {
    const json = raw.startsWith("base64-") ? Buffer.from(raw.slice("base64-".length), "base64url").toString("utf8") : raw;
    const session = JSON.parse(json) as { user?: { id?: unknown }; access_token?: unknown } | null;
    const accessToken = typeof session?.access_token === "string" && session.access_token.split(".").length === 3 ? session.access_token : null;
    const fromUser = session?.user?.id;
    if (isUuid(fromUser)) return { userId: fromUser.toLowerCase(), accessToken };
    if (accessToken) {
      const sub = (JSON.parse(Buffer.from(accessToken.split(".")[1]!, "base64url").toString("utf8")) as { sub?: unknown }).sub;
      if (isUuid(sub)) return { userId: sub.toLowerCase(), accessToken };
    }
    return null;
  } catch {
    return null;
  }
}

/** 위에서 사용자 id만. */
export function unverifiedSessionUserId(all: ReadonlyArray<{ name: string; value: string }>, expectedKey: string | null): string | null {
  return readSessionCookie(all, expectedKey)?.userId ?? null;
}
