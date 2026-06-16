import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "./current-user";
import { canAccess } from "@/lib/permissions";

export type CurrentSuperAdmin = {
  id: string;
  email: string;
  displayName: string;
};

// React cache() dedupes within a single request.
// super_admin은 academy 권한과 직교 — academy master여도 super_admin이 아닐 수 있고, 그 반대도 가능.
export const getCurrentSuperAdmin = cache(async (): Promise<CurrentSuperAdmin | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("super_admins")
    .select("id, email, display_name")
    .eq("id", user.id)
    .maybeSingle();

  if (!data) return null;
  return {
    id: data.id,
    email: data.email,
    displayName: data.display_name,
  };
});

export async function requireSuperAdmin(): Promise<CurrentSuperAdmin> {
  const sa = await getCurrentSuperAdmin();
  if (sa) return sa;

  // 세션 유무에 따라 분기 (F10): 비로그인 → /login, 로그인했으나 super_admin 아님 → 대시보드
  // (대시보드 미접근 role은 공개 랜딩으로 — 루프 방지). require-access와 동일 정책.
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  redirect(canAccess(user.systemRole, "dashboard") ? "/dashboard" : "/");
}
