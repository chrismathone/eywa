"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// 로그인 자체는 브라우저(login-form.tsx)가 하고, 로그인 기록은 착지 리다이렉터 `/home?login=1`이 남긴다
// (2026-09-23 전수 점검 M1·D9 — 옛 서버 액션 signIn은 호출처 0이라 삭제).

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
