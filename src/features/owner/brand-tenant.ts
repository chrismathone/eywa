/**
 * 비로그인(pre-auth) 표면의 **브랜드 테넌트**와 **지점 선택지** — 순수 판정(Vitest).
 *
 * 멀티테넌트 URL 결정(원장 2026-09-18 *"하나의 DB로"* + codex 2라운드 합의 = **C안: URL에 지점을 넣지 않는다**):
 * 로그인 뒤 지점은 계정(`users.tenant_id`)이 정하고, 호스트·경로는 지점을 말하지 않는다. 그래서 로그인 화면·
 * 루트 탭 제목·학원 공개 랜딩처럼 **세션이 없는 곳**은 "이 배포의 회사 브랜드" 하나를 보여 준다.
 *
 * - 학원(테넌트)이 **정확히 1개**면 그 학원 = 브랜드(종전 그대로, 설정 0).
 * - 2개 이상이면 env `PUBLIC_BRAND_TENANT_SLUG`가 가리키는 학원 = 브랜드(같은 브랜드의 지점들 중 대표 하나 —
 *   지점 설정 표면은 `tenant_settings`라 대표 지점의 로고·학원명·서명 URL 경로를 **그대로** 쓴다).
 * - 그 env가 없거나 어느 slug와도 안 맞으면 null → 제품 중립 표기(임의로 첫 학원을 고르면 남의 학원 이름이 뜬다,
 *   codex 리뷰 2026-09-18 *"회사 브랜드에 임의의 첫 지점 tenantId를 붙이지 않는다"*).
 *
 * ⚠️ 지점 판정이 아니다 — 자리 PIN처럼 **어느 지점인지** 알아야 하는 곳은 `branchChoices`로 고르게 한다.
 */
export type PublicTenantRow = { id: string; slug: string; name: string };

export function pickBrandTenantId(rows: readonly PublicTenantRow[], envSlug: string | null | undefined): string | null {
  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0]!.id;
  const want = envSlug?.trim().toLowerCase();
  if (!want) return null;
  return rows.find((r) => r.slug === want)?.id ?? null;
}

/** 지점 선택지(자리 PIN 등) — 이름순, 화면에 필요한 두 칸만. 1개면 고를 것이 없다(호출부가 그대로 확정). */
export function branchChoices(rows: readonly PublicTenantRow[]): { id: string; name: string }[] {
  return [...rows]
    .map((r) => ({ id: r.id, name: r.name.trim() || r.slug }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}
