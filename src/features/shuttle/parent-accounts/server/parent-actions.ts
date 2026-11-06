"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { readonlyTeacherViewError } from "@/lib/auth/view-as";
import { logAction } from "@/features/audit/server/log";
import { SHUTTLE_PARENTS_PATH } from "../parent-access";
import { SHUTTLE_PARENT_RIDES_PATH } from "../../faces";
import { parentAccountsActor } from "./parent-access";

export type ParentActionState = {
  ok?: true;
  error?: string;
  fieldErrors?: Record<string, string>;
};

export async function createParentAccount(
  _previous: ParentActionState,
  formData: FormData,
): Promise<ParentActionState> {
  // 🔴 읽기 강사뷰(·지점 보기)는 맨 앞에서 거절한다 — 이 액션은 canWriteTenant를 지나지 않고, 로그인 계정을 만드는 외부 효과가 있다.
  const readonly = await readonlyTeacherViewError();
  if (readonly) return { error: readonly };
  // 원장·관리자만 — 화면 입구와 같은 판정(canManageParentAccountsRole)을 서버가 다시 본다(#77).
  const actor = await parentAccountsActor();
  if (!actor) return { error: "학부모 계정은 원장·관리자만 발급할 수 있습니다" };

  const displayName = String(formData.get("displayName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const password = String(formData.get("password") ?? "");
  const studentId = String(formData.get("studentId") ?? "");
  const relationship = String(formData.get("relationship") ?? "부모").trim() || "부모";
  const fieldErrors: Record<string, string> = {};

  if (!displayName) fieldErrors.displayName = "학부모 이름을 입력하세요";
  if (!/^\S+@\S+\.\S+$/.test(email)) fieldErrors.email = "이메일 형식을 확인하세요";
  if (password.length < 8) fieldErrors.password = "비밀번호는 8자 이상이어야 합니다";
  if (!studentId) fieldErrors.studentId = "연결할 원생을 선택하세요";
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  const admin = createAdminClient();
  const [{ data: existingParent }, { data: existingUser }, { data: student }] = await Promise.all([
    admin.from("parent_accounts").select("id").eq("tenant_id", actor.tenantId).eq("login_email", email).maybeSingle(),
    admin.from("users").select("id").eq("tenant_id", actor.tenantId).ilike("email", email).maybeSingle(),
    admin.from("students").select("id, tenant_id, status").eq("id", studentId).eq("tenant_id", actor.tenantId).maybeSingle(),
  ]);
  if (existingParent || existingUser) return { fieldErrors: { email: "이미 사용 중인 이메일입니다" } };
  if (!student || student.status !== "enrolled") return { fieldErrors: { studentId: "재원 중인 원생만 연결할 수 있습니다" } };

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { tenant_id: actor.tenantId, system_role: "student", account_type: "parent" },
    user_metadata: { display_name: displayName },
  });
  if (authError || !authData.user) return { error: `학부모 계정을 만들지 못했습니다: ${authError?.message ?? "알 수 없는 오류"}` };

  const { data: parent, error: parentError } = await admin
    .from("parent_accounts")
    .insert({
      tenant_id: actor.tenantId,
      auth_user_id: authData.user.id,
      login_email: email,
      display_name: displayName,
      phone,
    })
    .select("id")
    .single();
  if (parentError || !parent) {
    await admin.auth.admin.deleteUser(authData.user.id);
    return { error: "학부모 계정 정보를 저장하지 못했습니다" };
  }

  const { error: linkError } = await admin.from("parent_account_students").insert({
    tenant_id: actor.tenantId,
    parent_account_id: parent.id,
    student_id: studentId,
    relationship,
  });
  if (linkError) {
    await admin.from("parent_accounts").delete().eq("id", parent.id).eq("tenant_id", actor.tenantId);
    await admin.auth.admin.deleteUser(authData.user.id);
    return { error: "원생 연결을 저장하지 못했습니다" };
  }

  await logAction({
    action: "parent_account_create",
    targetType: "shuttle",
    targetLabel: displayName,
    metadata: { parentAccountId: parent.id, studentId, relationship },
  });
  refreshParentScreens();
  return { ok: true };
}

/** 발급 창구가 둘이다 — 학부모 관리 현황 화면과 '학부모 등하원'의 모달. 둘 다 새 목록·연결 표시로. */
function refreshParentScreens() {
  revalidatePath(SHUTTLE_PARENTS_PATH);
  revalidatePath(SHUTTLE_PARENT_RIDES_PATH);
}

/**
 * 학부모 계정 삭제 — 화면이 "정말 삭제하겠습니까?" 확인을 받은 뒤에만 부른다.
 *
 * 후속 처리(순서대로):
 *   ① 로그인 계정(auth.users) 삭제 → 그 학부모의 **모든 세션이 끊기고** 다시 로그인할 수 없다.
 *      0320a의 `on delete cascade`로 학부모 정보(parent_accounts)와 원생 연결(parent_account_students)이 함께 지워진다.
 *   ② 혹시 남은 학부모 정보 행을 한 번 더 지운다(로그인 계정이 이미 없던 경우 등 — 멱등).
 *   ③ 감사로그 · 두 화면 재검증.
 * 🔑 **원생·셔틀 배정·탑승 기록은 건드리지 않는다** — 그건 아이의 사실이지 학부모 계정의 것이 아니다.
 * 🔴 로그인 계정은 **학부모 표식(`account_type: parent`)이 있을 때만** 지운다. 연결이 어긋나 직원 계정을
 *    가리키는 일이 생겨도 직원 로그인이 지워지는 사고는 없게 — 그 경우 학부모 정보만 지우고 알린다.
 */
export async function deleteParentAccount(parentAccountId: string): Promise<{ ok?: true; error?: string; notice?: string }> {
  // 🔴 읽기 강사뷰(·지점 보기)는 맨 앞에서 거절한다 — 로그인 계정을 지우는 되돌릴 수 없는 일이다(발급과 같은 문).
  const readonly = await readonlyTeacherViewError();
  if (readonly) return { error: readonly };
  const actor = await parentAccountsActor();
  if (!actor) return { error: "학부모 계정은 원장·관리자만 삭제할 수 있습니다" };
  if (!parentAccountId) return { error: "삭제할 계정을 찾지 못했습니다" };

  const admin = createAdminClient();
  const { data: parent, error: readError } = await admin
    .from("parent_accounts")
    .select("id, auth_user_id, display_name")
    .eq("id", parentAccountId)
    .eq("tenant_id", actor.tenantId)
    .maybeSingle();
  if (readError) return { error: "학부모 계정을 읽지 못했습니다" };
  if (!parent) return { error: "이미 삭제된 계정입니다" };

  const { count } = await admin
    .from("parent_account_students")
    .select("student_id", { count: "exact", head: true })
    .eq("tenant_id", actor.tenantId)
    .eq("parent_account_id", parent.id);

  // ① 로그인 계정 — 학부모 표식을 확인한 뒤에만.
  let notice: string | undefined;
  const { data: authUser } = await admin.auth.admin.getUserById(parent.auth_user_id);
  const isParentLogin = authUser?.user?.app_metadata?.account_type === "parent";
  if (authUser?.user && isParentLogin) {
    const { error: authError } = await admin.auth.admin.deleteUser(parent.auth_user_id);
    if (authError) return { error: "로그인 계정을 삭제하지 못했습니다 — 잠시 뒤 다시 시도해 주세요" };
  } else if (authUser?.user) {
    notice = "연결된 로그인이 학부모 계정이 아니어서 로그인은 그대로 두고 학부모 정보만 지웠습니다";
  }

  // ② 남은 학부모 정보(연결은 cascade) — 로그인이 이미 없었거나 ①을 건너뛴 경우.
  const { error: deleteError } = await admin
    .from("parent_accounts")
    .delete()
    .eq("id", parent.id)
    .eq("tenant_id", actor.tenantId);
  if (deleteError) return { error: "학부모 정보를 지우지 못했습니다" };

  // ③
  await logAction({
    action: "parent_account_delete",
    targetType: "shuttle",
    targetLabel: parent.display_name,
    metadata: { parentAccountId: parent.id, students: count ?? 0, loginDeleted: isParentLogin },
  });
  refreshParentScreens();
  return notice ? { ok: true, notice } : { ok: true };
}