import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadTenantSettingsRaw } from "./queries";
import { resolveSettings } from "../resolve";
import type { TenantSettings } from "../settings-types";

/**
 * 비로그인(pre-auth) 표면의 학원 브랜딩 — 로그인 화면·루트 탭 제목처럼 **세션이 없어 테넌트를 알 수 없는**
 * 곳에서 학원설정(profile.name/logoText/logoUrl/branchLabel)을 쓰기 위한 단일 진입점.
 *
 * 테넌트 해석: 이 배포에 학원이 **정확히 하나**일 때만 그 학원으로 확정한다(현 injaewon 단일 운영).
 * 0개(부트스트랩 전) 또는 2개 이상(멀티테넌트로 성장)이면 **null을 반환해 제품 중립 표기로 자동 폴백** —
 * 로그인 전엔 어느 학원인지 알 방법이 없는데 임의로 한 곳을 고르면 남의 학원 이름이 노출되기 때문이다.
 * (호스트/서브도메인 기반 테넌트 라우팅이 생기면 그때 여기만 교체하면 된다.)
 *
 * ⚠️ signed URL은 여기서 만들지 않는다 — 캐시에 담기면 TTL이 지나 깨진 링크가 서빙된다.
 * 호출부가 반환된 tenantId로 `resolveBrandingSrc`를 **요청마다** 부른다((shell)/layout.tsx와 동일 규약).
 */
export type PublicBranding = { tenantId: string; settings: TenantSettings };

/**
 * 단일 테넌트 판정 캐시의 무효화 태그 — 학원이 **추가/삭제**되면 판정이 뒤집히므로
 * super-admin의 테넌트 생성/삭제 액션이 `updateTag`로 즉시 비운다.
 */
export const PUBLIC_BRANDING_TENANTS_TAG = "public-branding-tenants";

/** 단일 테넌트 id — 학원이 정확히 하나일 때만. cross-request 캐시(B6: 창마다 도는 조회 방지). */
const loadSoleTenantId = unstable_cache(
  async (): Promise<string | null> => {
    const admin = createAdminClient();
    // 2행만 받아 "정확히 1개"를 판정 — count 없이 단일/복수 구분이 가능하고 전건 fetch도 피한다.
    const { data, error } = await admin.from("tenants").select("id").limit(2);
    if (error) {
      console.error("[owner/public-branding] tenants 조회 오류", error);
      return null;
    }
    return data?.length === 1 ? (data[0]!.id as string) : null;
  },
  ["public-branding-sole-tenant"],
  // 학원 생성/삭제는 극히 드묾 — 길게 캐시하고, 실제 변동은 super-admin이 태그로 즉시 무효화(TTL은 백스톱).
  { tags: [PUBLIC_BRANDING_TENANTS_TAG], revalidate: 3600 },
);

/**
 * 비로그인 화면용 학원 설정. 단일 테넌트가 아니면 null(호출부는 제품 중립 표기로 폴백).
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
    const tenantId = await loadSoleTenantId();
    if (!tenantId) return null;
    const raw = await loadTenantSettingsRaw(tenantId);
    return { tenantId, settings: resolveSettings(raw.data, { name: raw.name }) };
  } catch (e) {
    console.error("[owner/public-branding] 브랜딩 조회 실패 — 제품 중립 표기로 폴백", e);
    return null;
  }
}

/**
 * 표시용 브랜드 3종(순수 파생) — 로고 워드마크·학원 표기줄·문서 제목용 학원명.
 * 설정이 비어있거나 단일 테넌트가 아니면 제품 중립값으로 떨어진다(하드코딩 학원명 금지).
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
    wordmark: p?.logoText?.trim() || "EYWA",
    academyLine:
      [academyName, p?.branchLabel?.trim()].filter(Boolean).join(" · ") || "학원관리 시스템",
    academyName,
  };
}
