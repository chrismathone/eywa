import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadTenantSettingsRaw } from "./queries";
import { resolveSettings } from "../resolve";
import { branchChoices, pickBrandTenantId, type PublicTenantRow } from "../brand-tenant";
import type { TenantSettings } from "../settings-types";

/**
 * 비로그인(pre-auth) 표면의 학원 브랜딩 — 로그인 화면·루트 탭 제목·학원 공개 랜딩처럼 **세션이 없어 테넌트를
 * 알 수 없는** 곳에서 학원설정(profile.name/logoText/logoUrl/branchLabel)을 쓰기 위한 단일 진입점.
 *
 * 테넌트 해석(원장 2026-09-18 *"하나의 DB로"* + URL 결정 **C안 = URL에 지점을 넣지 않는다**, codex 2라운드 합의):
 * 로그인 뒤 지점은 계정(`users.tenant_id`)이 정하므로 호스트·경로엔 지점이 없다. 그래서 여기는 "어느 지점인가"가
 * 아니라 **이 배포의 회사 브랜드** 하나를 고른다 — 판정은 순수 [`pickBrandTenantId`](../brand-tenant.ts):
 * 학원이 정확히 1개면 그 학원(현 injaewon), 2개 이상이면 env `PUBLIC_BRAND_TENANT_SLUG`의 학원, 아니면 null
 * (제품 중립 표기 — 임의로 첫 학원을 고르면 남의 학원 이름이 노출된다).
 * ⚠️ **지점 판정용이 아니다** — 자리 PIN처럼 지점을 알아야 하는 곳은 [`listPublicBranchChoices`]로 고르게 한다.
 * (지점마다 다른 주소·간판이 필요해지면 그때 호스트 기반 판정을 이 파일에 얹는다 — 결정 로그 참조.)
 *
 * ⚠️ signed URL은 여기서 만들지 않는다 — 캐시에 담기면 TTL이 지나 깨진 링크가 서빙된다.
 * 호출부가 반환된 tenantId로 `resolveBrandingSrc`를 **요청마다** 부른다((shell)/layout.tsx와 동일 규약).
 */
export type PublicBranding = { tenantId: string; settings: TenantSettings };

/**
 * 테넌트 목록 캐시의 무효화 태그 — 학원이 **추가/개명**되면 브랜드 판정과 지점 선택지가 바뀌므로 super-admin의
 * 테넌트 생성(및 생성 실패 롤백)·수정 액션이 `updateTag`로 즉시 비운다. (테넌트 삭제 액션은 없다 — 생기면 여기도.)
 */
export const PUBLIC_BRANDING_TENANTS_TAG = "public-branding-tenants";

/**
 * 이 배포의 학원 목록(id·slug·name) — cross-request 캐시(B6: 창마다 도는 조회 방지).
 * 🔴 상한 50 = "동네 회사 지점 몇 개" 전제의 명시 상한(B2: 무페이징 select 금지). 학원이 50개를 넘는 SaaS가 되면
 *    이 헬퍼(브랜드·지점 선택지)가 아니라 호스트 기반 판정으로 바꿔야 한다 — 그때 이 숫자를 키우지 말 것.
 */
const PUBLIC_TENANT_LIMIT = 50;
const loadPublicTenantDirectory = unstable_cache(
  async (): Promise<PublicTenantRow[]> => {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("tenants")
      .select("id, slug, name")
      .order("created_at", { ascending: true })
      .limit(PUBLIC_TENANT_LIMIT);
    // 🔴 오류는 **던진다** — `return []`로 삼키면 그 빈 목록이 3600초 캐시돼(unstable_cache는 throw만 안 담는다) 콜드
    //    스타트 DB 블립 한 번에 전 지점 자리 태블릿이 최대 1시간 "쓸 수 없습니다"가 된다(적대 리뷰 2026-09-18).
    //    바깥 `getPublicBranding`/`listPublicBranchChoices`가 try/catch로 받아 이번 요청만 중립/닫힘으로 떨어진다.
    if (error) throw error;
    const rows = (data ?? []).map((r) => ({ id: r.id as string, slug: r.slug as string, name: (r.name as string) ?? "" }));
    if (rows.length >= PUBLIC_TENANT_LIMIT) {
      // 상한에 닿았다 = 그 뒤 학원이 소리 없이 빠진다(그 지점 태블릿은 고를 수 없고 브랜드도 못 잡는다). 숫자를 키우지
      // 말고 호스트 기반 판정으로 바꿀 때다 — 런타임 신호를 남긴다.
      console.error(`[owner/public-branding] 학원 목록이 상한(${PUBLIC_TENANT_LIMIT})에 닿았습니다 — 호스트 기반 판정으로 전환 필요`);
    }
    return rows;
  },
  ["public-branding-tenants"],
  // 학원 생성/삭제/개명은 극히 드묾 — 길게 캐시하고, 실제 변동은 super-admin이 태그로 즉시 무효화(TTL은 백스톱).
  { tags: [PUBLIC_BRANDING_TENANTS_TAG], revalidate: 3600 },
);

/**
 * 비로그인 화면용 브랜드 학원 설정. 브랜드 학원을 못 정하면 null(호출부는 제품 중립 표기로 폴백).
 *
 * 설정은 로그인 경로와 **같은 캐시**(`loadTenantSettingsRaw`, tag `tenant-settings:<id>`)를 재사용한다 —
 * 별도 캐시를 두면 같은 2행이 두 엔트리에 중복 저장되고, 무엇보다 `resolveSettings`(DEFAULT deep-merge)까지
 * 캐시에 굳어 **defaults/resolve 코드를 바꿔 배포해도 TTL 동안 옛 해석이 서빙**된다(queries.ts:19 규약 위반).
 * raw만 캐시하고 merge는 캐시 밖에서 — 코드 변경 즉시 반영.
 *
 * ⚠️ **절대 throw하지 않는다.** 루트 layout의 generateMetadata가 이 함수를 부르는데, 거기서 던진 예외는
 * error.tsx가 못 잡아(root layout은 global-error 필요) **로그인 화면 포함 전 라우트가 500**이 된다.
 * 브랜딩은 장식이라 실패해도 앱이 죽으면 안 됨 — 어떤 오류든 null(제품 중립 표기)로 떨어진다.
 * `createAdminClient()`가 env 누락 시 throw하는 것도 이 catch가 받는다.
 */
export async function getPublicBranding(): Promise<PublicBranding | null> {
  try {
    const rows = await loadPublicTenantDirectory();
    const tenantId = pickBrandTenantId(rows, process.env.PUBLIC_BRAND_TENANT_SLUG);
    if (!tenantId) return null;
    const raw = await loadTenantSettingsRaw(tenantId);
    return { tenantId, settings: resolveSettings(raw.data, { name: raw.name }) };
  } catch (e) {
    console.error("[owner/public-branding] 브랜딩 조회 실패 — 제품 중립 표기로 폴백", e);
    return null;
  }
}

/**
 * **지점이 이미 정해진** 비로그인 화면용(자리 PIN 통과 뒤 — 쿠키의 tenantId, 키오스크 기기 토큰 등) 브랜딩.
 * 회사 브랜드가 아니라 **그 지점**의 학원설정(이름·지점 표기)을 보여 준다 — A지점 태블릿 머리에 A지점 이름.
 * 같은 raw 캐시를 타므로 요청마다 DB를 때리지 않는다. 실패는 null(제품 중립 표기).
 * ⚠️ tenantId는 **신뢰된 경로**(서명 쿠키·기기 토큰)에서만 — 화면이 준 값을 그대로 넣지 말 것.
 */
export async function getPublicBrandingByTenantId(
  tenantId: string,
): Promise<PublicBranding | null> {
  try {
    const raw = await loadTenantSettingsRaw(tenantId);
    return { tenantId, settings: resolveSettings(raw.data, { name: raw.name }) };
  } catch (e) {
    console.error("[owner/public-branding] 지점 브랜딩 조회 실패 — 제품 중립 표기로 폴백", e);
    return null;
  }
}

/**
 * 지점 선택지(비로그인 — 자리 PIN 화면 등). 학원이 1개면 그 하나뿐이라 호출부가 고르게 하지 않고 확정한다.
 * 🔴 실패는 **빈 배열**이다(throw 금지 — 자리 태블릿이 "지금은 쓸 수 없습니다"로 닫히는 편이 500보다 낫다).
 *    이름·id만 내보낸다(학원설정·PIN은 실지 않는다 — 고른 뒤 서버가 그 학원 설정으로 검증한다).
 */
export async function listPublicBranchChoices(): Promise<{ id: string; name: string }[]> {
  try {
    return branchChoices(await loadPublicTenantDirectory());
  } catch (e) {
    console.error("[owner/public-branding] 지점 목록 조회 실패", e);
    return [];
  }
}

/**
 * 표시용 브랜드 3종(순수 파생) — 로고 워드마크·학원 표기줄·문서 제목용 학원명.
 * 설정이 비어있거나 브랜드 학원을 못 정하면 제품 중립값으로 떨어진다(하드코딩 학원명 금지).
 */
export function brandLabels(branding: PublicBranding | null): {
  wordmark: string;
  academyLine: string;
  academyName: string | null;
} {
  const p = branding?.settings.profile;
  const academyName = p?.name?.trim() || null;
  return {
    // (shell)/layout.tsx와 동일 규약: logoText 우선, 없으면 제품명.
    wordmark: p?.logoText?.trim() || "AYWA",
    academyLine:
      [academyName, p?.branchLabel?.trim()].filter(Boolean).join(" · ") || "학원관리 시스템",
    academyName,
  };
}
