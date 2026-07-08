"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { recordLoginEvent, pickClientIp } from "@/features/audit/server/login-log";

const credentialsSchema = z.object({
  email: z.string().email("이메일 형식이 올바르지 않습니다"),
  password: z.string().min(6, "비밀번호는 6자 이상이어야 합니다"),
  next: z.string().optional(),
});

export type LoginState = { error?: string } | undefined;

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "입력값을 확인해주세요" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { error: "이메일 또는 비밀번호가 올바르지 않습니다" };
  }

  // 수동 로그인 기록 — **응답(redirect) 이후 백그라운드**(after)로 빼 크리티컬 패스를 막지 않음(적대리뷰 HIGH).
  // 신원·ua·ip는 지금(요청 스코프) 뽑아 넘기고, after 콜백은 admin 클라로 기록(쿠키 무의존).
  const uid = data.user?.id;
  if (uid) {
    const h = await headers();
    const ua = h.get("user-agent");
    const ip = pickClientIp(h);
    after(() => recordLoginEvent(uid, ua, ip));
  }

  redirect(parsed.data.next?.startsWith("/") ? parsed.data.next : "/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
