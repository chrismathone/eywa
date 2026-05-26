"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

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
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { error: "이메일 또는 비밀번호가 올바르지 않습니다" };
  }

  redirect(parsed.data.next?.startsWith("/") ? parsed.data.next : "/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
