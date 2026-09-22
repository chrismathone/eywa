import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { getCurrentUser } from "@/lib/auth/current-user";
import { SYSTEM_CATEGORY_OPTIONS, type DocumentCategoryOption } from "../categories";

// 서식 저장소 분류 조회(0161a) — 학원장이 관리하는 테넌트 데이터라 매 화면에서 읽는다.

/** 분류 캐시 무효화 태그(tenantId별) — 분류 변경 액션이 updateTag로 비운다. */
export function documentCategoriesTag(tenantId: string): string {
  return `document-categories:${tenantId}`;
}

/**
 * tenantId별 `unstable_cache` — 데이터베이스 메뉴는 목록·상세·창(iframe)마다 이 목록을 읽는다(B6).
 * 캐시 안엔 쿠키 없이 admin client + 신뢰된 tenantId 키만 쓴다(loadTenantSettingsRaw와 같은 패턴).
 * 분류는 read-mostly(학원장이 가끔 편집)라 캐시 적중률이 사실상 100%.
 */
const loadCategories = (tenantId: string) =>
  unstable_cache(
    async (): Promise<DocumentCategoryOption[]> => {
      const admin = createAdminClient();
      try {
        const data = await fetchAllPaged<{ key: string; label: string; is_system: boolean; parent_key: string | null }>((from, to) => admin
          .from("document_categories")
          .select("key, label, is_system, parent_key")
          .eq("tenant_id", tenantId)
          .order("sort_order", { ascending: true })
          .order("key", { ascending: true })
          .range(from, to));
        if (!data.length) return SYSTEM_CATEGORY_OPTIONS;
        return data.map((r) => ({ key: r.key, label: r.label, isSystem: !!r.is_system, parentKey: r.parent_key }));
      } catch (error) {
        console.error("[documents/category-queries] document_categories 조회 오류", error);
        return SYSTEM_CATEGORY_OPTIONS;
      }
    },
    ["document-categories-tree-v2", tenantId],
    // 변경 액션이 updateTag로 즉시 무효화. revalidate는 그게 실패할 때의 TTL 백스톱.
    { tags: [documentCategoriesTag(tenantId)], revalidate: 300 },
  )();

/** 현재 테넌트의 분류 목록(표시 순). 비로그인이면 시스템 기본값. */
export const getDocumentCategories = cache(async (): Promise<DocumentCategoryOption[]> => {
  const user = await getCurrentUser();
  if (!user) return SYSTEM_CATEGORY_OPTIONS;
  return loadCategories(user.tenantId);
});
