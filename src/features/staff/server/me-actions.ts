"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction } from "@/features/audit/server/log";
import { EMAIL_RE } from "@/features/staff/email";

// 본인 계정 자기관리(원장 지시 2026-07-29) — 시트에서 넘어온 임시 로그인 주소로 들어와
// **본인이 직접** 실제 이메일과 비밀번호로 갈아끼운다. 대상은 언제나 로그인한 자기 자신(auth.uid())뿐 —
// id를 폼에서 받지 않는다(받으면 그게 곧 남의 계정 탈취 통로).

export type MeAccountState = { ok?: true; error?: string; notice?: string } | undefined;

const MIN_PASSWORD = 8;

/**
 * 로그인 이메일 변경(본인). auth.users와 public.users를 함께 바꾼다.
 * ⚠️ GoTrue `updateUserById`는 어떤 갱신에서든 `raw_app_meta_data`를 재기록해 미러 트리거를 깨운다([[#70]]).
 * 0075a 하드닝이 '명시 role 없으면 보존'으로 막아주지만, 여기서는 **현재 role을 명시로 함께 넘겨** 확실히 고정한다.
 */
export async function updateMyEmail(_prev: MeAccountState, formData: FormData): Promise<MeAccountState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return { error: "이메일을 입력하세요" };
  if (!EMAIL_RE.test(email)) return { error: "이메일 형식이 올바르지 않습니다" };
  if (email === user.email.toLowerCase()) return { error: "지금 쓰는 이메일과 같습니다" };

  const admin = createAdminClient();
  // 같은 학원에 이미 쓰는 사람이 있으면 거부(auth는 전역 유니크라 어차피 실패 — 먼저 한글로 알린다).
  const { data: dup } = await admin
    .from("users")
    .select("id")
    .eq("tenant_id", user.tenantId)
    .ilike("email", email)
    .neq("id", user.id)
    .maybeSingle();
  if (dup) return { error: "이미 다른 직원이 쓰고 있는 이메일입니다" };

  const { error: authErr } = await admin.auth.admin.updateUserById(user.id, {
    email,
    email_confirm: true, // 학원 내부 계정 — 확인 메일 왕복 없이 즉시 반영(발송 경로 자체가 없음).
    app_metadata: { tenant_id: user.tenantId, system_role: user.systemRole },
  });
  if (authErr) {
    const dup = /already|exists|registered/i.test(authErr.message);
    return { error: dup ? "이미 사용 중인 이메일입니다" : `이메일 변경 실패 — ${authErr.message}` };
  }
  const { error: dbErr } = await admin.from("users").update({ email }).eq("id", user.id);
  if (dbErr) {
    // auth는 바뀌고 users만 실패 = 로그인은 새 주소, 화면은 옛 주소. 되돌려 한쪽으로 통일한다.
    await admin.auth.admin.updateUserById(user.id, { email: user.email, email_confirm: true });
    return { error: `이메일 변경 실패 — ${dbErr.message}` };
  }

  await logAction({
    action: "self_email_change",
    targetType: "user",
    targetLabel: user.displayName ?? null,
    metadata: { from: user.email, to: email },
  });
  revalidatePath("/me");
  revalidatePath("/staff");
  return { ok: true, notice: `로그인 이메일을 ${email}로 바꿨습니다 — 다음 로그인부터 새 주소를 쓰세요` };
}

/** 비밀번호 변경(본인) — 세션 클라이언트로 바꾼다(관리자 권한 불필요, 자기 세션이 곧 신원). */
export async function updateMyPassword(_prev: MeAccountState, formData: FormData): Promise<MeAccountState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("passwordConfirm") ?? "");
  if (password.length < MIN_PASSWORD) return { error: `비밀번호는 ${MIN_PASSWORD}자 이상이어야 합니다` };
  if (password !== confirm) return { error: "비밀번호 확인이 일치하지 않습니다" };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: `비밀번호 변경 실패 — ${error.message}` };

  await logAction({
    action: "self_password_change",
    targetType: "user",
    targetLabel: user.displayName ?? null,
    metadata: {},
  });
  return { ok: true, notice: "비밀번호를 바꿨습니다" };
}
