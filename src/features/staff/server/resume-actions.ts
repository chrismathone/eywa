"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient as createRawClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/env";
import { logAction } from "@/features/audit/server/log";
import { parseResumeForm, resumeTitle, RESUME_FORM_TYPE } from "../resume";
import { RESUME_VIEW_COOKIE, RESUME_VIEW_TTL_SEC, signResumeViewToken } from "./resume-view-token";

// 직원 이력서(웹 작성 폼) 변경 액션 — 게이트는 canWriteTenant("staff")(직원관리 쓰기 = 사무실).
// 저장소는 academy_documents(kind='form', restricted=true) — 데이터베이스 탐색기에도 같은 행이 보인다.
// restricted 행은 RLS restrictive(0072a)가 DB 레벨에서도 사무실 역할만 통과시킨다.

export type ResumeActionState =
  | { ok?: boolean; error?: string; id?: string; nonce?: number; redirectTo?: string }
  | undefined;

async function requireStaffWrite() {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" as const };
  if (!(await canWriteTenant(user.systemRole, "staff"))) {
    return { error: "직원관리 권한이 없습니다" as const };
  }
  return { user };
}

/** 생성/수정 겸용 — formData에 id가 있으면 해당 이력서 갱신, 없으면 신규 작성. */
export async function saveStaffResume(
  _prev: ResumeActionState,
  formData: FormData,
): Promise<ResumeActionState> {
  const gate = await requireStaffWrite();
  if ("error" in gate) return { error: gate.error };

  const data = parseResumeForm(formData);
  if (!data.personal.name) return { error: "성명을 입력하세요" };

  const supabase = await createClient();
  const id = String(formData.get("id") ?? "").trim();

  if (id) {
    const { error } = await supabase
      .from("academy_documents")
      .update({ title: resumeTitle(data), form_data: data, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("form_type", RESUME_FORM_TYPE);
    if (error) return { error: `저장 실패: ${error.message}` };
    revalidateResume(id);
    return { ok: true, id, nonce: Date.now(), redirectTo: `/staff/resumes/${id}` };
  }

  const { data: row, error } = await supabase
    .from("academy_documents")
    .insert({
      tenant_id: gate.user.tenantId,
      title: resumeTitle(data),
      category: "hr",
      kind: "form",
      form_type: RESUME_FORM_TYPE,
      form_data: data,
      restricted: true, // 주민번호·급여 포함 → 사무실 전용 열람
      description: "직원 이력서 (웹 작성)",
      uploaded_by: gate.user.id,
    })
    .select("id")
    .single();
  if (error || !row) return { error: `저장 실패: ${error?.message ?? "unknown"}` };
  revalidateResume(row.id);
  return { ok: true, id: row.id, nonce: Date.now(), redirectTo: `/staff/resumes/${row.id}` };
}

export async function deleteStaffResume(id: string): Promise<{ ok?: boolean; error?: string }> {
  const gate = await requireStaffWrite();
  if ("error" in gate) return { error: gate.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("academy_documents")
    .delete()
    .eq("id", id)
    .eq("form_type", RESUME_FORM_TYPE);
  if (error) return { error: `삭제 실패: ${error.message}` };
  revalidateResume(id);
  return { ok: true };
}

function revalidateResume(id: string) {
  revalidatePath("/staff");
  revalidatePath(`/staff/resumes/${id}`);
  revalidatePath("/documents"); // 같은 행이 데이터베이스 탐색기에도 노출
}

export type ResumeUnlockState = { ok?: boolean; error?: string; nonce?: number } | undefined;

/**
 * 이력서 열람 잠금 해제 — 본인 재인증(step-up). 작성자·원장이 아닌 사무실 직원이 다른 사람 이력서를
 * 열람하려 할 때, **자신의 로그인 비밀번호**를 재입력해 10분 열람 창(서명 쿠키)을 얻는다.
 * ⚠️ 세션 비파괴: 쿠키를 저장하지 않는 격리 클라이언트로 signInWithPassword만 수행 → 현재 로그인
 *    세션(쿠키)은 건드리지 않는다(#10 재로그아웃 루프 회피). 성공/실패 모두 그 클라이언트는 버린다.
 */
export async function unlockResumeView(
  _prev: ResumeUnlockState,
  formData: FormData,
): Promise<ResumeUnlockState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  // 사무실 역할만(비-사무실은 RLS로 애초에 이력서가 안 보임 — 여기서도 이중 방어).
  if (!(await canWriteTenant(user.systemRole, "staff"))) {
    return { error: "직원관리 권한이 없습니다" };
  }
  const password = String(formData.get("password") ?? "");
  if (!password) return { error: "비밀번호를 입력하세요" };
  const resumeId = String(formData.get("id") ?? "").trim();
  if (!resumeId) return { error: "이력서 정보가 없습니다" };

  // 격리 클라이언트: persistSession=false → 응답 쿠키를 안 쓴다(현재 세션 무손상). anon 키로 password grant만.
  const verifier = createRawClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await verifier.auth.signInWithPassword({ email: user.email, password });
  if (error) return { error: "비밀번호가 일치하지 않습니다" };

  // 이 이력서 전용 토큰 — 다른 이력서는 다시 재인증 필요(한 번에 전 직원 PII 훑기 차단).
  const jar = await cookies();
  jar.set(RESUME_VIEW_COOKIE, signResumeViewToken(user.id, resumeId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: RESUME_VIEW_TTL_SEC,
  });
  // 누가 언제 열람 잠금을 풀었는지 감사로그(개인 계정 자책 방지 = 재인증의 핵심 가치).
  await logAction({
    action: "resume_view_unlock",
    targetType: "staff_resume",
    targetLabel: user.displayName ?? user.email,
  });
  return { ok: true, nonce: Date.now() };
}
