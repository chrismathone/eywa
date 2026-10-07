import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { SystemRole } from "@/lib/permissions";

export type CurrentUser = {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  jobTitle: string | null;
  systemRole: SystemRole;
};

// React cache() dedupes within a single request — the layout, the page guard,
// and any feature query all reuse the same Supabase round-trip.
//
// 인증은 getClaims()로 **로컬 JWT 서명검증** — getUser()의 GoTrue 네트워크 왕복을 제거한다(창=iframe·네비마다
// 1회씩 들던 비용 → 멀티윈도우에서 N배). 비대칭 서명키면 WebCrypto 로컬검증(JWKS는 인스턴스당 1회 캐시),
// 대칭키/서버리스 콜드 인스턴스면 내부적으로 네트워크 검증으로 폴백(무해 — 효과만 없음). 만료 임박 토큰은
// getClaims가 먼저 refresh하므로 세션 끊김 없음. tenant_id·role·display_name은 **여전히 authoritative한
// public.users에서** 읽어 app_metadata 드리프트 위험 0(삭제된 유저는 SELECT null → 로그아웃 처리됨).
// ⚠️ 트레이드오프: 로컬검증이라 서버측 강제 로그아웃/ban이 access token 만료 전까지 지연 — 토큰 만료 단축으로 완화.
// (속도 이득은 프로젝트가 비대칭 서명키일 때만 — Dashboard › Auth › JWT Keys. 대칭키면 무해한 no-op.)
const getAuthenticatedUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  // 빠른 경로: 로컬 JWT 검증(getUser의 네트워크 왕복 제거).
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  let sub = claimsData?.claims?.sub;
  // 안전망: getClaims가 sub를 못 냈을 때(에러이거나, 콜드 인스턴스/비호환으로 조용히 빈손) — **세션 토큰이
  // 실제로 존재하면** authoritative getUser로 확정한다. 정상 세션이 로컬검증 실패만으로 /login으로 튕겨
  // "탭 재오픈 로그아웃"이 나는 것을 막는다(파국 방지). getSession은 쿠키에서 로컬로 읽어 토큰 유무만 판별하므로,
  // 진짜 무세션(비로그인)은 getUser 네트워크 비용 없이 즉시 null — 랜딩 등 공개 페이지 성능 보존.
  if (!sub) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session || claimsError) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      sub = user?.id;
    }
  }
  if (!sub) return null;

  const { data } = await supabase
    .from("users")
    .select("id, tenant_id, email, display_name, job_title, system_role, status")
    .eq("id", sub)
    .single();

  if (!data) return null;
  // 🔴 퇴사자(status='inactive')는 로그인 안 된 것으로 본다(원장 2026-09-29 *"퇴사자 당연히 로그인 차단 동반해야지"*).
  //    세션이 살아 있어도(자동 로그인 = 무기한 세션) 셸·서버 액션·API가 전부 이 함수를 거치므로 한 곳에서 막힌다.
  //    Supabase 로그인 계정 차단(ban)은 퇴사 처리 액션이 함께 건다(`setStaffLoginBlocked`, staff/server/auth-ban.ts) — 이건 이미 받은 토큰까지 막는 앱 쪽 벽.
  if (data.status === "inactive") return null;
  return {
    id: data.id,
    tenantId: data.tenant_id,
    email: data.email,
    displayName: data.display_name,
    jobTitle: data.job_title,
    systemRole: data.system_role as SystemRole,
  };
});

/** Domain actions can opt into the validated teacher view; auth, settings and audit use the real actor. */
export const getCurrentUser = cache(async (options?: { teacherView: boolean }): Promise<CurrentUser | null> => {
  const user = await getAuthenticatedUser();
  if (!user || !options?.teacherView) return user;
  const { viewAsTeacher } = await import("./view-as");
  return (await viewAsTeacher()) ?? user;
});
