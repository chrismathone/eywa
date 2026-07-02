"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { parseResumeForm, resumeTitle, RESUME_FORM_TYPE } from "../resume";

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
