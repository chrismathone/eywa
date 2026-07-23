"use server";

import { revalidatePath } from "next/cache";
import type { SystemRole } from "@/lib/permissions";
import { isHexColor, readableTextColor } from "@/lib/color-utils";
import {
  canAssignRole,
  canManageStaff,
  ROLE_HIERARCHY,
} from "@/lib/auth/role-hierarchy";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction } from "@/features/audit/server/log";
import { createClient } from "@/lib/supabase/server";
import { canEditLoginEmail, EMAIL_RE } from "@/features/staff/email";

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
  // 시간표 강사색: 유효 hex만, 글자색은 가독성 기준 자동 도출(반 색 패턴과 동일).
  const bgRaw = get("bgColor");
  const bgColor = bgRaw && isHexColor(bgRaw) ? bgRaw : null;
  const textColor = bgColor ? readableTextColor(bgColor) : null;
  return {
    displayName: get("displayName"),
    email: get("email"),
    phone: get("phone") || null,
    hireDate: get("hireDate") || null,
    jobTitle: get("jobTitle") || null,
    // 영어 닉네임 — 비우면 null(이름을 그대로 쓴다). 영어 시간표 임포트가 시트 라벨을 강사에 붙이는 키.
    englishName: get("englishName") || null,
    subjects,
    defaultClassroom: get("defaultClassroom") || null,
    memo: get("memo") || null,
    bgColor,
    textColor,
  };
}

function validateBase(input: ReturnType<typeof readBaseForm>): Record<string, string> | null {
  const errors: Record<string, string> = {};
  if (!input.displayName) errors.displayName = "이름은 필수입니다";
  if (!input.email) errors.email = "이메일은 필수입니다";
  else if (!EMAIL_RE.test(input.email)) errors.email = "이메일 형식이 올바르지 않습니다";
  return Object.keys(errors).length > 0 ? errors : null;
}

export type StaffFormState =
  | { error?: string; fieldErrors?: Record<string, string>; tempPassword?: string; ok?: true; redirectTo?: string; nonce?: number }
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

  // 0) 이메일 중복 사전검사 — 같은 테넌트에 이미 그 이메일 직원이 있으면(예: 임포트된 강사 = public.users만
  //    있고 auth 없음) auth.users→public.users 미러 트리거(tg_sync_user_from_auth)가 (tenant_id,email)
  //    유니크를 위반해 createUser가 "Database error creating new user"로 실패한다. 미리 잡아 명확히 안내.
  const { data: dup } = await admin
    .from("users")
    .select("id")
    .eq("tenant_id", actor.tenantId)
    .ilike("email", input.email)
    .maybeSingle();
  if (dup) {
    return { fieldErrors: { email: "이미 이 이메일로 등록된 직원이 있습니다 (기존 직원을 수정하세요)" } };
  }

  // 1) Create auth user with tenant_id baked into app_metadata so the RLS function picks it up.
  //    ⚠️ 이 createUser가 tg_sync_user_from_auth 트리거를 발동해 **public.users 최소 행(6컬럼)을 자동 생성**한다.
  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email: input.email,
    password,
    email_confirm: true,
    app_metadata: { tenant_id: actor.tenantId, system_role: newRole },
  });
  if (authErr || !authData?.user) {
    return { error: `Auth 계정 생성 실패: ${authErr?.message ?? "unknown"}` };
  }

  // 2) 미러 트리거가 만든 최소 행을 **UPDATE로 보강**한다. (insert면 트리거가 이미 같은 id로 넣은 행과
  //    users_pkey 충돌 → "직원 row 생성 실패"가 신규 직원에서도 항상 발생.)
  const { error: dbErr } = await admin
    .from("users")
    .update({
      display_name: input.displayName,
      phone: input.phone,
      system_role: newRole,
      status: "active",
      hire_date: input.hireDate,
      job_title: input.jobTitle,
      english_name: input.englishName,
      subjects: input.subjects,
      default_classroom: input.defaultClassroom,
      memo: input.memo,
      bg_color: input.bgColor,
      text_color: input.textColor,
    })
    .eq("id", authData.user.id);

  if (dbErr) {
    // 롤백 — auth user + 트리거가 만든 public.users 행 둘 다 정리(deleteUser는 public.users를 안 지움 = 고아 방지).
    await admin.auth.admin.deleteUser(authData.user.id);
    await admin.from("users").delete().eq("id", authData.user.id);
    return { error: `직원 정보 저장 실패: ${dbErr.message}` };
  }

  revalidatePath("/staff");
  // redirect 대신 결과 반환 — 클라가 성공 확정(nonce) 후 초안 삭제·동시편집 신호·이동(B-2).
  // (redirect()면 NEXT_REDIRECT throw로 폼의 nonce 효과가 안 돌아 'staff:new' 초안이 안 비워진다.)
  return {
    ok: true,
    redirectTo: `/staff?invited=${encodeURIComponent(input.email)}`,
    nonce: Date.now(),
  };
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

  // 저장된 이메일과 대조 — 임포트 직원의 깨진 레거시 이메일("LAB 김주희@imported.local" 등)이
  // 그대로 재제출될 때 형식 검증이 다른 필드 수정까지 막지 않게, 이메일은 "변경된 경우에만" 검증·반영.
  const admin = createAdminClient();
  const { data: target, error: targetErr } = await admin
    .from("users")
    .select("tenant_id, email")
    .eq("id", id)
    .single();
  if (targetErr || !target) return { error: "대상 직원을 찾을 수 없습니다" };
  if (target.tenant_id !== actor.tenantId) {
    return { error: "다른 지점의 계정은 변경할 수 없습니다" };
  }
  const emailChanged =
    input.email.toLowerCase() !== String(target.email ?? "").toLowerCase();

  const fieldErrors = validateBase(input) ?? {};
  if (!emailChanged) delete fieldErrors.email;
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  const { data: authData } = emailChanged
    ? await admin.auth.admin.getUserById(id)
    : { data: null };

  if (emailChanged) {
    // 임포트 산물 이메일 + **아직 로그인 전인 초대 계정**만 교정 허용(UI와 동일 기준 이중 검증).
    // 계정 조회 실패는 "로그인한 적 있음"으로 본다 — 모르면 안 여는 쪽(queries.hasStaffEverSignedIn과 동일).
    const everSignedIn = !authData?.user || Boolean(authData.user.last_sign_in_at);
    if (!canEditLoginEmail(String(target.email ?? ""), everSignedIn)) {
      return {
        fieldErrors: { email: "이미 로그인한 계정의 이메일은 여기서 변경할 수 없습니다" },
      };
    }
    // 같은 테넌트 중복(대소문자 무시, 본인 제외) — (tenant_id,email) 유니크 위반 사전 안내.
    const { data: dup } = await admin
      .from("users")
      .select("id")
      .eq("tenant_id", actor.tenantId)
      .ilike("email", input.email)
      .neq("id", id)
      .limit(1)
      .maybeSingle();
    if (dup) {
      return { fieldErrors: { email: "이미 이 이메일로 등록된 직원이 있습니다" } };
    }
    // auth 계정이 있으면 로그인 이메일(auth.users) 자체를 변경 — public.users만 바꾸면 미러 트리거
    // (0075a: email = excluded.email)가 다음 auth 갱신 때 옛 이메일로 되덮는다. 트리거가 public도 동기.
    if (authData?.user) {
      const { error: authErr } = await admin.auth.admin.updateUserById(id, {
        email: input.email,
        email_confirm: true,
      });
      if (authErr) {
        return { fieldErrors: { email: `로그인 이메일 변경 실패: ${authErr.message}` } };
      }
    }
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("users")
    .update({
      display_name: input.displayName,
      ...(emailChanged ? { email: input.email } : {}),
      phone: input.phone,
      hire_date: input.hireDate,
      job_title: input.jobTitle,
      english_name: input.englishName,
      subjects: input.subjects,
      default_classroom: input.defaultClassroom,
      memo: input.memo,
      bg_color: input.bgColor,
      text_color: input.textColor,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/staff");
  // redirect 대신 결과 반환 — 클라가 성공 확정 후 동시편집 신호(publish) → 이동(B-2).
  return { ok: true, redirectTo: "/staff", nonce: Date.now() };
}

export type ChangeRoleState = { error?: string; ok?: boolean } | undefined;

export async function changeStaffRole(
  _prev: ChangeRoleState,
  formData: FormData,
): Promise<ChangeRoleState> {
  const actor = await getCurrentUser();
  if (!actor) return { error: "로그인이 필요합니다" };
  // 권한 게이트 — 형제 액션과 동일(누락 시 누구나 POST해 역할 상승·크로스테넌트 탈취 가능, #S1).
  if (!canManageStaff(actor.systemRole)) {
    return { error: "역할 변경 권한이 없습니다 (master / admin / manager)" };
  }

  const id = String(formData.get("id") ?? "").trim();
  const newRole = String(formData.get("newRole") ?? "") as SystemRole;
  if (!id) return { error: "직원 ID가 누락되었습니다" };
  if (!ROLES.includes(newRole)) return { error: "유효한 역할이 아닙니다" };

  const admin = createAdminClient();

  // 대상의 실제 tenant_id·system_role을 DB에서 읽는다(클라이언트가 보낸 currentRole 신뢰 금지, #S1).
  const { data: target, error: targetErr } = await admin
    .from("users")
    .select("tenant_id, system_role, display_name")
    .eq("id", id)
    .single();
  if (targetErr || !target) return { error: "대상 직원을 찾을 수 없습니다" };
  // 크로스테넌트 차단 — 다른 지점 계정은 건드릴 수 없다.
  if (target.tenant_id !== actor.tenantId) {
    return { error: "다른 지점의 계정은 변경할 수 없습니다" };
  }
  const currentRole = target.system_role as SystemRole;
  if (!canAssignRole({ actor: actor.systemRole, targetCurrent: currentRole, newRole })) {
    return { error: "이 역할 변경은 본인 권한으로 허용되지 않습니다" };
  }

  // 1) public.users 업데이트(같은 테넌트 확인됨)
  const { error: dbErr } = await admin
    .from("users")
    .update({ system_role: newRole })
    .eq("id", id);
  if (dbErr) return { error: dbErr.message };

  // 2) auth.users app_metadata sync — tenant_id는 대상의 기존 값 유지(세션값으로 재기록해 이동시키지 않음).
  const { error: authErr } = await admin.auth.admin.updateUserById(id, {
    app_metadata: { tenant_id: target.tenant_id, system_role: newRole },
  });
  if (authErr) {
    // 롤백: public.users 원래 역할로 복귀
    await admin.from("users").update({ system_role: currentRole }).eq("id", id);
    return { error: `Auth metadata 동기화 실패: ${authErr.message}` };
  }

  await logAction({
    action: "staff_role_change",
    targetType: "staff",
    targetLabel: target.display_name ?? null,
    metadata: { from: currentRole, to: newRole },
  });
  revalidatePath("/staff");
  revalidatePath(`/staff/${id}`);
  return { ok: true };
}

export type DeactivateState =
  | { error?: string; ok?: true; homeroomCount?: number }
  | undefined;

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

  // 퇴사 시 담임으로 남는 진행중 반 수 — 퇴사를 막지 않고 알림용으로만 반환.
  // (status 변경은 classes.teacher_id에 아무 전파가 없어 "(퇴직)" 담임이 시간표·출석부에 남는다.
  //  UI 사전 경고가 stale 데이터로 비었더라도 여기서 잡아 사후 안내.) 카운트는 head:true — 행 미전송(B2).
  let homeroomCount = 0;
  if (next === "inactive") {
    const { count } = await supabase
      .from("classes")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", actor.tenantId)
      .eq("teacher_id", id)
      .eq("is_active", true);
    homeroomCount = count ?? 0;
  }

  revalidatePath("/staff");
  revalidatePath(`/staff/${id}`);
  return { ok: true, homeroomCount };
}
