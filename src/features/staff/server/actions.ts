"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SystemRole } from "@/lib/permissions";
import {
  canAssignRole,
  canManageStaff,
  ROLE_HIERARCHY,
} from "@/lib/auth/role-hierarchy";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const ROLES = Object.keys(ROLE_HIERARCHY) as SystemRole[];
const STATUSES = ["active", "inactive", "pending"] as const;

function readBaseForm(formData: FormData) {
  const get = (k: string) => {
    const v = formData.get(k);
    return v == null ? "" : String(v).trim();
  };
  const subjectsRaw = get("subjects");
  const subjects = subjectsRaw
    ? subjectsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  return {
    displayName: get("displayName"),
    email: get("email"),
    hireDate: get("hireDate") || null,
    jobTitle: get("jobTitle") || null,
    subjects,
    defaultClassroom: get("defaultClassroom") || null,
    memo: get("memo") || null,
  };
}

function validateBase(input: ReturnType<typeof readBaseForm>): Record<string, string> | null {
  const errors: Record<string, string> = {};
  if (!input.displayName) errors.displayName = "이름은 필수입니다";
  if (!input.email) errors.email = "이메일은 필수입니다";
  else if (!/^\S+@\S+\.\S+$/.test(input.email)) errors.email = "이메일 형식이 올바르지 않습니다";
  return Object.keys(errors).length > 0 ? errors : null;
}

export type StaffFormState =
  | { error?: string; fieldErrors?: Record<string, string>; tempPassword?: string }
  | undefined;

export async function createStaff(
  _prev: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const actor = await getCurrentUser();
  if (!actor) return { error: "로그인이 필요합니다" };
  if (!canManageStaff(actor.systemRole)) {
    return { error: "직원 추가 권한이 없습니다 (master / admin / manager)" };
  }

  const input = readBaseForm(formData);
  const fieldErrors = validateBase(input);
  if (fieldErrors) return { fieldErrors };

  const password = String(formData.get("password") ?? "").trim();
  const newRole = String(formData.get("systemRole") ?? "viewer") as SystemRole;
  if (!ROLES.includes(newRole)) return { error: "유효한 역할이 아닙니다" };

  // Actor must be strictly stronger than new role
  if (ROLE_HIERARCHY[actor.systemRole] >= ROLE_HIERARCHY[newRole]) {
    return { error: `${newRole} 역할은 본인 권한으로 부여할 수 없습니다` };
  }

  if (!password || password.length < 8) {
    return { fieldErrors: { password: "임시 비밀번호는 8자 이상" } };
  }

  const admin = createAdminClient();

  // 1) Create auth user with tenant_id baked into app_metadata so the RLS function picks it up.
  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email: input.email,
    password,
    email_confirm: true,
    app_metadata: { tenant_id: actor.tenantId, system_role: newRole },
  });
  if (authErr || !authData?.user) {
    return { error: `Auth 계정 생성 실패: ${authErr?.message ?? "unknown"}` };
  }

  // 2) Insert into public.users
  const { error: dbErr } = await admin.from("users").insert({
    id: authData.user.id,
    tenant_id: actor.tenantId,
    email: input.email,
    display_name: input.displayName,
    system_role: newRole,
    status: "active",
    hire_date: input.hireDate,
    job_title: input.jobTitle,
    subjects: input.subjects,
    default_classroom: input.defaultClassroom,
    memo: input.memo,
  });

  if (dbErr) {
    // rollback auth user
    await admin.auth.admin.deleteUser(authData.user.id);
    return { error: `직원 row 생성 실패: ${dbErr.message}` };
  }

  revalidatePath("/staff");
  redirect(`/staff?invited=${encodeURIComponent(input.email)}`);
}

export async function updateStaff(
  _prev: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const actor = await getCurrentUser();
  if (!actor) return { error: "로그인이 필요합니다" };
  if (!canManageStaff(actor.systemRole)) {
    return { error: "직원 정보 수정 권한이 없습니다" };
  }

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "직원 ID가 누락되었습니다" };

  const input = readBaseForm(formData);
  const fieldErrors = validateBase(input);
  if (fieldErrors) return { fieldErrors };

  const supabase = await createClient();
  const { error } = await supabase
    .from("users")
    .update({
      display_name: input.displayName,
      email: input.email,
      hire_date: input.hireDate,
      job_title: input.jobTitle,
      subjects: input.subjects,
      default_classroom: input.defaultClassroom,
      memo: input.memo,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/staff");
  redirect(`/staff`);
}

export type ChangeRoleState = { error?: string } | undefined;

export async function changeStaffRole(
  _prev: ChangeRoleState,
  formData: FormData,
): Promise<ChangeRoleState> {
  const actor = await getCurrentUser();
  if (!actor) return { error: "로그인이 필요합니다" };

  const id = String(formData.get("id") ?? "").trim();
  const newRole = String(formData.get("newRole") ?? "") as SystemRole;
  const currentRole = String(formData.get("currentRole") ?? "") as SystemRole;

  if (!id) return { error: "직원 ID가 누락되었습니다" };
  if (!ROLES.includes(newRole) || !ROLES.includes(currentRole)) {
    return { error: "유효한 역할이 아닙니다" };
  }

  if (
    !canAssignRole({ actor: actor.systemRole, targetCurrent: currentRole, newRole })
  ) {
    return { error: "이 역할 변경은 본인 권한으로 허용되지 않습니다" };
  }

  const admin = createAdminClient();

  // 1) public.users 업데이트
  const { error: dbErr } = await admin
    .from("users")
    .update({ system_role: newRole })
    .eq("id", id);
  if (dbErr) return { error: dbErr.message };

  // 2) auth.users app_metadata sync (RLS의 auth_tenant_id() / role-based 정책에서 사용)
  const { error: authErr } = await admin.auth.admin.updateUserById(id, {
    app_metadata: { tenant_id: actor.tenantId, system_role: newRole },
  });
  if (authErr) {
    // 롤백: public.users 원래 역할로 복귀
    await admin.from("users").update({ system_role: currentRole }).eq("id", id);
    return { error: `Auth metadata 동기화 실패: ${authErr.message}` };
  }

  revalidatePath("/staff");
  return undefined;
}

export type DeactivateState = { error?: string } | undefined;

export async function deactivateStaff(
  _prev: DeactivateState,
  formData: FormData,
): Promise<DeactivateState> {
  const actor = await getCurrentUser();
  if (!actor) return { error: "로그인이 필요합니다" };
  if (!canManageStaff(actor.systemRole)) {
    return { error: "권한이 없습니다" };
  }

  const id = String(formData.get("id") ?? "").trim();
  const next = String(formData.get("next") ?? "inactive");
  if (!STATUSES.includes(next as "active" | "inactive" | "pending")) {
    return { error: "유효한 상태가 아닙니다" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("users").update({ status: next }).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/staff");
  return undefined;
}
