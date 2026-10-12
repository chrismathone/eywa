"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { closeTenantView, hasTenantViewCookie } from "@/lib/auth/tenant-view-session";

// 로그인 자체는 브라우저(login-form.tsx)가 하고, 로그인 기록은 착지 리다이렉터 `/home?login=1`이 남긴다
// (2026-09-23 전수 점검 M1·D9 — 옛 서버 액션 signIn은 호출처 0이라 삭제).

export async function signOut() {
  // 운영 콘솔의 '지점 보기'(읽기 전용)를 열어 둔 채 로그아웃하면 보기도 함께 닫는다 — 같은 브라우저에 다음 사람이
  // 로그인했을 때 남의 보기 쿠키가 남아 있지 않게(쿠키가 없으면 조회 없이 지나간다).
  if (await hasTenantViewCookie()) await closeTenantView();
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
