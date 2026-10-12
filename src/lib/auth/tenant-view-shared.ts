/**
 * 운영 콘솔의 '지점 보기'(읽기 전용) — 서버와 클라가 함께 쓰는 값.
 *
 * 🔴 이 파일에 `import "server-only"`를 붙이지 말 것 — 클라 컴포넌트(띠 · 동기화)와 서버 모듈이 함께 읽는다([[#61]]).
 * 🔴 `TENANT_VIEW_HEADER`는 DB 함수(0356a `operator_view_tenant` · `auth_tenant_id` · `auth_system_role`)가 찾는
 *    이름과 **글자까지 같아야** 한다. 한쪽만 바꾸면 보기가 조용히 꺼진다(가드: tenant-view-wiring.test.ts).
 */

/** 보기 토큰 쿠키(httpOnly) — 값은 `<토큰>.<보는 사람 id>`. 서버만 읽는다. */
export const TENANT_VIEW_COOKIE = "aywa-tenant-view";
/**
 * 보기 표식 쿠키(자바스크립트가 읽는다) — 값은 `<보는 사람 id>.<지점 id>.<끝나는 시각(초)>`. 비밀이 아니다.
 * 탭마다 "지금 그려진 화면"과 "이 브라우저의 실제 상태"가 어긋났는지 그 자리에서 알아채는 데만 쓴다(tenant-view-sync.tsx).
 * 서버는 이 쿠키로 보기를 열지 않는다. 운영자의 브라우저에 이 쿠키만 남았을 때 그 요청을 '끝난 보기'로 보는 데만 참고한다
 * (tenant-view.ts — 운영자가 아닌 사람에게는 이 쿠키가 있어도 아무 일도 일어나지 않는다).
 */
export const TENANT_VIEW_MARK_COOKIE = "aywa-tenant-view-mark";
export const TENANT_VIEW_HEADER = "x-aywa-tenant-view";
/** 보기 한 번의 길이. 지나면 DB가 무효로 본다. */
export const TENANT_VIEW_TTL_MINUTES = 120;
/**
 * 앱은 DB보다 이만큼 **먼저** 보기를 끝난 것으로 본다. 화면 하나를 그리는 동안 DB 쪽에서만 만료가 지나면
 * 앞 조회는 보는 지점, 뒤 조회는 본인 지점으로 갈려 한 화면에 두 지점이 섞인다 — 그 틈을 없앤다.
 */
export const TENANT_VIEW_EARLY_CUTOFF_SECONDS = 60;
/** 보기 중 저장·발송을 막았을 때 화면에 뜨는 사유. */
export const TENANT_VIEW_READONLY_MESSAGE = "읽기 전용 보기에서는 저장할 수 없습니다";
/** 보기 쿠키는 있는데 지금 확인하지 못했을 때 보내는 안내 화면(화면을 그리지 않고 여기로 보낸다). */
export const TENANT_VIEW_UNCONFIRMED_PATH = "/tenant-view/unconfirmed";
/** 화면 감시(tenant-view-sync.tsx)가 서버보다 이만큼 더 일찍 보기를 끝난 것으로 본다 — 화면이 그려진 뒤 감시가 뜰 때까지의 지연을 덮는다. */
export const TENANT_VIEW_CLIENT_EXTRA_CUTOFF_MS = 30_000;
/** '보기 끝내기' 주소(라우트 핸들러). 링크는 미리 불러오지 않게 `<a>`로 건다. */
export const TENANT_VIEW_EXIT_PATH = "/tenant-view/exit";
/**
 * 같은 주소인데 **저절로 끝난 보기**를 정리하러 갈 때 쓴다(시간이 다 됐다 · 다른 곳에서 끝났다 — 사람이 '보기 끝내기'를 누른 것이 아니다).
 * 운영 콘솔이 "보기가 끝났다"는 안내를 한 줄 띄운다.
 */
export const TENANT_VIEW_ENDED_EXIT_HREF = `${TENANT_VIEW_EXIT_PATH}?why=ended`;
/**
 * '화면 맞추기' 주소(라우트 핸들러) — 탭에 그려진 화면과 브라우저의 실제 상태가 어긋났을 때 탭이 스스로 이리로 온다
 * (tenant-view-sync.tsx). 서버가 지금 상태를 확인해 보는 중이면 그 지점의 첫 화면으로, 아니면 남은 쿠키를 지우고 원래 화면으로 보낸다.
 */
export const TENANT_VIEW_SYNC_PATH = "/tenant-view/sync";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** uuid 모양인가. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** 보기 토큰 쿠키 값 만들기. */
export function tenantViewCookieValue(token: string, operatorId: string): string {
  return `${token}.${operatorId}`;
}

/** 보기 토큰 쿠키 값 읽기 — 모양이 맞을 때만(형식만 본다. 유효한지는 서버가 DB에서 확인한다). */
export function parseTenantViewCookie(value: string | null | undefined): { token: string; operatorId: string } | null {
  if (!value) return null;
  const [token, operatorId, ...rest] = value.split(".");
  if (rest.length > 0 || !isUuid(token) || !isUuid(operatorId)) return null;
  // DB 함수는 소문자 16진만 토큰으로 본다(0356a의 정규식) — 대문자가 섞인 값은 보기가 아니다.
  return { token: token.toLowerCase(), operatorId: operatorId.toLowerCase() };
}

export type TenantViewMark = { operatorId: string; tenantId: string; expiresAtSeconds: number };

/** 보기 표식 쿠키 값 만들기. */
export function tenantViewMarkValue(mark: TenantViewMark): string {
  return `${mark.operatorId}.${mark.tenantId}.${Math.floor(mark.expiresAtSeconds)}`;
}

/** 보기 표식 쿠키 값 읽기. */
export function parseTenantViewMark(value: string | null | undefined): TenantViewMark | null {
  if (!value) return null;
  const [operatorId, tenantId, exp, ...rest] = value.split(".");
  if (rest.length > 0 || !isUuid(operatorId) || !isUuid(tenantId) || !/^\d{9,12}$/.test(exp ?? "")) return null;
  return { operatorId: operatorId.toLowerCase(), tenantId: tenantId.toLowerCase(), expiresAtSeconds: Number(exp) };
}

/**
 * 표식으로 본 "이 사람이 지금 보고 있어야 할 지점" — 없으면 null.
 * 남의 표식(이 브라우저에 남은 다른 계정의 것) · 끝난 표식은 없는 것과 같다. 앱의 판정(서버)과 같은 여유 시간을 둔다.
 */
export function expectedTenantFromMark(mark: TenantViewMark | null, userId: string, nowMs: number): string | null {
  if (!mark || mark.operatorId !== userId.toLowerCase()) return null;
  if (mark.expiresAtSeconds * 1000 - nowMs <= TENANT_VIEW_EARLY_CUTOFF_SECONDS * 1000) return null;
  return mark.tenantId;
}

/**
 * 저절로 끝난 보기를 정리하러 가는 주소 — 보던 지점을 알면 함께 싣는다(`t=`). 끝내기 요청이 여럿 겹쳐(화면 이동 · 화면 감시)
 * 먼저 온 것이 쿠키를 지웠어도, 나중 것까지 같은 학원의 화면으로 돌아가게 한다. 값은 돌아갈 곳의 힌트일 뿐이다.
 */
export function tenantViewEndedExitHref(tenantId?: string | null): string {
  return isUuid(tenantId) ? `${TENANT_VIEW_ENDED_EXIT_HREF}&t=${tenantId.toLowerCase()}` : TENANT_VIEW_ENDED_EXIT_HREF;
}

/**
 * 탭에 그려진 지점(`viewingTenantId`)과 표식이 말하는 지점(`expected`)이 어긋났을 때 **어디로 가서 맞출지**. 같으면 null.
 * - 그려진 화면은 보는 중인데 표식이 없다/끝났다 → '보기 끝내기'(남은 쿠키를 지우고 운영 콘솔로 — 저절로 끝난 것이라 안내가 붙는다).
 *   보던 지점을 함께 싣는다(`t=`) — 끝내기 주소에 닿기 전에 다른 요청이 쿠키를 먼저 지웠어도 그 학원의 화면으로 돌아가게.
 * - 그 밖(보기가 새로 열렸다 · 다른 지점으로 바뀌었다) → '화면 맞추기'(서버가 확인해 맞는 화면으로).
 *   그려진 화면이 보는 중이었으면 그 사실을 함께 싣는다(`from=view`) — 확인해 보니 보기가 아니었을 때 돌아갈 곳이 다르다
 *   (보던 화면의 주소는 다른 지점 것이라 본인 화면에서는 뜻이 없다 → 운영 콘솔로).
 */
export function tenantViewResyncHref(viewingTenantId: string | null, expected: string | null, here: string): string | null {
  if (viewingTenantId === expected) return null;
  if (viewingTenantId && !expected) return tenantViewEndedExitHref(viewingTenantId);
  return `${TENANT_VIEW_SYNC_PATH}?next=${encodeURIComponent(here)}${viewingTenantId ? "&from=view" : ""}`;
}

/** 운영 콘솔 주소인가 — 콘솔은 보기 쿠키가 있어도 늘 운영자 본인으로 동작한다. */
export function isOperatorConsolePath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  // 🔴 `/admin/…`(감사 로그 · 데이터 정리 등)은 **지점 화면**이다 — 콘솔은 `/admin` 한 주소와 `/super-admin` 아래뿐이다.
  //    앞머리만 보고 넓히면 보기 중 그 화면들의 쓰기 차단이 통째로 빠진다.
  return pathname === "/admin" || pathname === "/super-admin" || pathname.startsWith("/super-admin/");
}
