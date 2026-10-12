import "server-only";
import { cookies } from "next/headers";
import { createRawAdminClient } from "@/lib/supabase/admin";
import {
  parseTenantViewCookie,
  TENANT_VIEW_COOKIE,
  TENANT_VIEW_MARK_COOKIE,
  TENANT_VIEW_TTL_MINUTES,
  tenantViewCookieValue,
  tenantViewMarkValue,
} from "@/lib/auth/tenant-view-shared";

/**
 * 운영 콘솔의 '지점 보기'(읽기 전용) — 보기를 **열고 닫는** 쪽(쿠키 두 개 + 보기 기록 한 줄).
 * 판정(지금 보는 중인가)은 tenant-view.ts가 한다. 여기는 쿠키를 쓸 수 있는 자리(서버 액션 · 라우트 핸들러)에서만 부른다.
 *
 * 쿠키는 둘이다:
 * - 토큰(httpOnly) — 서버만 읽는다. DB로 가는 헤더에 실리는 값.
 * - 표식(자바스크립트가 읽는다) — 탭이 "그려진 화면과 실제 상태가 어긋났는지" 알아채는 데만 쓴다. 비밀이 아니고 서버는 믿지 않는다.
 * 둘은 **늘 함께** 쓰고 함께 지운다. 한쪽만 남은 브라우저는 서버가 '끝난 보기'로 본다(tenant-view.ts `ended`).
 *
 * 보기는 **브라우저마다 하나**다 — 새 보기를 열면 이 브라우저의 앞선 보기만 닫는다. 같은 사람이 다른 브라우저 · 기기에서
 * 열어 둔 보기는 건드리지 않는다(그쪽 탭이 띠를 단 채 끝난 보기가 되는 일을 만들지 않는다).
 *
 * 🔴 쿠키 수명 = 보기 기록의 수명(둘 다 `TENANT_VIEW_TTL_MINUTES`). 쿠키를 더 짧게 잡지 말 것 — 서버는 보기를 60초 먼저
 *    끝난 것으로 보는데, 그때 쿠키가 남아 있어야 그 요청을 평소 요청이 아니라 '끝난 보기'로 알아보고 쓰기를 막는다.
 */

const cookieBase = () => ({
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
});

/**
 * 보기 기록 한 줄을 만든다. 쿠키는 아직 쓰지 않는다(부르는 쪽이 DB가 그 보기를 받아 주는지 확인한 뒤
 * [`setTenantViewCookies`]로 쓴다) — 그 전에 그만두면 이 브라우저의 앞선 보기는 그대로 남는다. 실패하면 null.
 */
export async function createTenantViewRow(operatorId: string, tenantId: string): Promise<{ token: string; expiresAt: string } | null> {
  const admin = createRawAdminClient();
  const now = Date.now();
  const expiresAt = new Date(now + TENANT_VIEW_TTL_MINUTES * 60_000).toISOString();
  const { data, error } = await admin
    .from("operator_tenant_views")
    .insert({ operator_id: operatorId, tenant_id: tenantId, expires_at: expiresAt })
    .select("token")
    .single();
  // 표가 아직 없으면(SQL 적용 전) 열지 못한다.
  if (error || !data) return null;
  // 오래된 기록 정리(이 사람 것만 · 30일 전) — 실패해도 무해하다.
  void admin
    .from("operator_tenant_views")
    .delete()
    .eq("operator_id", operatorId)
    .lt("created_at", new Date(now - 30 * 86_400_000).toISOString())
    .then(() => undefined, () => undefined);
  return { token: data.token as string, expiresAt };
}

/** 보기 기록 한 줄을 닫는다(끝난 시각을 적는다). 못 닫아도 던지지 않는다 — 그 줄은 만료 시각에 저절로 닫힌다. */
export async function endTenantViewRow(token: string, operatorId: string): Promise<void> {
  try {
    await createRawAdminClient()
      .from("operator_tenant_views")
      .update({ ended_at: new Date().toISOString() })
      .eq("token", token)
      .eq("operator_id", operatorId)
      .is("ended_at", null);
  } catch {
    // 위 설명대로다.
  }
}

/**
 * 이 브라우저에 보기 쿠키 둘(토큰 · 표식)을 쓴다. 이 브라우저에 앞선 보기가 있으면 그 기록을 먼저 닫는다
 * (쿠키가 새 값으로 덮이면 그 줄을 닫을 길이 없어진다).
 */
export async function setTenantViewCookies(view: { token: string; expiresAt: string }, operatorId: string, tenantId: string): Promise<void> {
  const jar = await cookies();
  const previous = parseTenantViewCookie(jar.get(TENANT_VIEW_COOKIE)?.value);
  if (previous && previous.token !== view.token) await endTenantViewRow(previous.token, previous.operatorId);
  const maxAge = TENANT_VIEW_TTL_MINUTES * 60;
  jar.set(TENANT_VIEW_COOKIE, tenantViewCookieValue(view.token, operatorId), { ...cookieBase(), httpOnly: true, maxAge });
  jar.set(
    TENANT_VIEW_MARK_COOKIE,
    tenantViewMarkValue({ operatorId, tenantId, expiresAtSeconds: Date.parse(view.expiresAt) / 1000 }),
    { ...cookieBase(), httpOnly: false, maxAge },
  );
}

/**
 * 이 브라우저의 보기를 닫는다 — 보기 기록에 끝난 시각을 적고 쿠키 둘을 지운다. 보고 있던 지점 id(없었으면 null).
 * 기록을 못 닫아도 쿠키는 지운다: 토큰이 브라우저에서 사라지면 보기는 끝난다(줄은 만료 시각에 저절로 닫힌다).
 */
export async function closeTenantView(): Promise<string | null> {
  const jar = await cookies();
  const cookie = parseTenantViewCookie(jar.get(TENANT_VIEW_COOKIE)?.value);
  let tenantId: string | null = null;
  if (cookie) {
    try {
      const { data: row } = await createRawAdminClient()
        .from("operator_tenant_views")
        .select("tenant_id")
        .eq("token", cookie.token)
        .eq("operator_id", cookie.operatorId)
        .maybeSingle();
      tenantId = (row?.tenant_id as string | undefined) ?? null;
    } catch {
      // 지점을 못 읽어도 아래에서 닫고 지운다.
    }
    await endTenantViewRow(cookie.token, cookie.operatorId);
  }
  if (jar.get(TENANT_VIEW_COOKIE)) jar.delete(TENANT_VIEW_COOKIE);
  if (jar.get(TENANT_VIEW_MARK_COOKIE)) jar.delete(TENANT_VIEW_MARK_COOKIE);
  return tenantId;
}

/** 이 브라우저에 보기 쿠키가 남아 있는가(쿠키 유무만 — 조회하지 않는다). */
export async function hasTenantViewCookie(): Promise<boolean> {
  const jar = await cookies();
  return Boolean(jar.get(TENANT_VIEW_COOKIE) || jar.get(TENANT_VIEW_MARK_COOKIE));
}
