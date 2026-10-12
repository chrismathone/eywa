/**
 * 운영 콘솔의 '지점 보기'(읽기 전용) — **바깥으로 나가는 일**의 단일 진입점이 부르는 문.
 *
 * 보기 중의 쓰기는 데이터 접근 층이 막지만(tenant-view-guard.ts), 그 가드는 Supabase로 가는 요청만 본다.
 * AI · 전사 · 메시지 · 외부 시트 · 외부 업무 도구처럼 **다른 곳으로 나가는 호출**은 여기서 따로 멈춘다 — 지점 데이터가
 * 외부로 나가거나, 그 지점 사람들에게 무언가가 보내지거나, 비용이 드는 일은 '읽기'가 아니다.
 *
 * 🔴 호출부(서버 액션)의 권한 게이트가 이미 대부분 막는다. 이 문은 **새 호출부가 게이트를 빠뜨려도** 막히게 하는 한 겹이다
 *    (가드: tenant-view-wiring.test.ts가 진입점 목록을 잠근다).
 * 🔴 `import "server-only"`를 붙이지 않고 판정 모듈을 **부르는 순간에** 싣는다 — 이 진입점들은 요청과 무관한 곳(cron · 웹훅 ·
 *    워커 · 스크립트)에서도 불린다. 거기서는 쿠키를 읽을 수 없어 늘 통과한다. 판정 모듈을 싣지 못해도 통과한다
 *    (보기 판정이 없는 환경 = 보기가 있을 수 없는 환경).
 */
export async function tenantViewOutboundError(): Promise<string | null> {
  let mod: typeof import("@/lib/auth/tenant-view");
  try {
    mod = await import("@/lib/auth/tenant-view");
  } catch {
    return null;
  }
  return mod.tenantViewWriteError();
}

/** 위와 같은 문 — 던지는 판. */
export async function assertTenantViewOutboundAllowed(): Promise<void> {
  const error = await tenantViewOutboundError();
  if (error) throw new Error(error);
}
