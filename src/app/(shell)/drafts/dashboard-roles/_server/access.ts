import "server-only";
import { cache } from "react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { createClient } from "@/lib/supabase/server";

/** 조사 요약(`_data/research.ts`)이 찍은 지점 — 침산 운영 DB 실측이라 다른 지점 원장에겐 보이지 않는다. */
const RESEARCH_TENANT_SLUG = "cs";

export type DraftViewer = {
  /** 슈퍼관리자 — 슈퍼관리자 계정이 들어간 행(실제 역할)은 이 사람에게만. */
  superAdmin: boolean;
  /** 조사 요약을 볼 수 있나 — 침산 원장 또는 슈퍼관리자. */
  research: boolean;
};

/**
 * 역할별 운영실 시안(`/drafts/dashboard-roles`) — **원장(master) + 슈퍼관리자만**. 범위 밖이면 null.
 *
 * 판정은 급여명세서(`canManageSalary`)와 같은 두 줄이다. 슈퍼관리자는 역할이 관리자(admin)일 수도 있어
 * 역할만 보면 잠긴다(`owner/page.tsx` 주석) — 그래서 표를 따로 묻는다.
 * 범위 밖이면 페이지가 `notFound()`로 존재 자체를 숨긴다(진도맵 시안 선례). 메뉴·사이드바엔 올리지 않는다.
 * 지점 판정은 데모 명단 스위치(`demo-roster/server/queries.ts`)와 같은 조회 — 사용자 클라이언트(RLS)로 내 지점 slug만.
 */
export const getDraftViewer = cache(async (): Promise<DraftViewer | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  const superAdmin = await isCurrentUserSuperAdmin();
  if (user.systemRole !== "master" && !superAdmin) return null;
  if (superAdmin) return { superAdmin, research: true };
  const supabase = await createClient();
  const { data } = await supabase.from("tenants").select("slug").eq("id", user.tenantId).maybeSingle();
  return { superAdmin, research: data?.slug === RESEARCH_TENANT_SLUG };
});
