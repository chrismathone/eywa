"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SystemRole } from "@/lib/permissions";
import { canManageStaff, canManageStaffMember } from "@/lib/auth/role-hierarchy";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { sanitizeWorkSchedule } from "@/features/staff/work-schedule";

export type AccountActionState =
  | { error?: string; ok?: boolean; tempPassword?: string }
  | undefined;

type TargetInfo = { role: SystemRole; email: string; tenantId: string };

/**
 * 대상 직원을 DB에서 직접 읽어 같은 테넌트인지 검증하고 권한 계층 판단에 필요한 값을 돌려준다.
 * 클라이언트가 보낸 값(role·email·tenant)은 신뢰하지 않는다(#S1).
 */
async function loadTarget(
  id: string,
  actor: { id: string; tenantId: string; systemRole: SystemRole },
): Promise<TargetInfo | { error: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .select("tenant_id, system_role, email")
    .eq("id", id)
    .single();
  if (error || !data) return { error: "대상 직원을 찾을 수 없습니다" };
  if (data.tenant_id !== actor.tenantId) return { error: "다른 지점의 계정은 변경할 수 없습니다" };
  return {
    role: data.system_role as SystemRole,
    email: data.email as string,
    tenantId: data.tenant_id as string,
  };
}

/** 비밀번호 재설정 — 임시 발급(temp) 또는 관리자 직접 설정(custom). */
export async function resetStaffPassword(
  _prev: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { error: "로그인이 필요합니다" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "직원 ID가 누락되었습니다" };

  const target = await loadTarget(id, actor);
  if ("error" in target) return target;
  if (!canManageStaffMember(actor.systemRole, target.role)) {
    return { error: "이 직원의 비밀번호를 재설정할 권한이 없습니다" };
  }

  const mode = String(formData.get("mode") ?? "temp");
  let password: string;
  let issued: string | undefined;
  if (mode === "custom") {
    password = String(formData.get("password") ?? "").trim();
    if (password.length < 8) return { error: "비밀번호는 8자 이상이어야 합니다" };
  } else {
    // 임시 비번 생성 (혼동되는 글자 제외 영숫자 12자)
    password = Array.from(crypto.getRandomValues(new Uint8Array(12)))
      .map((b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31])
      .join("");
    issued = password;
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(id, { password });
  if (error) return { error: error.message };

  return { ok: true, tempPassword: issued };
}

/** 이메일 변경 — public.users 먼저, auth.users 나중(+실패 시 롤백)으로 불일치를 막는다. */
export async function changeStaffEmail(
  _prev: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { error: "로그인이 필요합니다" };

  const id = String(formData.get("id") ?? "").trim();
  // 이메일은 대소문자 무시(RFC) — 정규화해 케이스만 바꾼 우회 중복을 막는다.
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!id) return { error: "직원 ID가 누락되었습니다" };
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: "이메일 형식이 올바르지 않습니다" };

  const target = await loadTarget(id, actor);
  if ("error" in target) return target;
  if (!canManageStaffMember(actor.systemRole, target.role)) {
    return { error: "이 직원의 이메일을 변경할 권한이 없습니다" };
  }
  if (target.email.toLowerCase() === email) return { ok: true }; // 변동 없음

  const admin = createAdminClient();
  // 같은 테넌트 내 중복 사전 확인(친절한 메시지 — 최종 방어선은 unique index).
  const { data: dup } = await admin
    .from("users")
    .select("id")
    .eq("tenant_id", actor.tenantId)
    .ilike("email", email)
    .neq("id", id)
    .maybeSingle();
  if (dup) return { error: "이미 사용 중인 이메일입니다" };

  // 1) public.users 먼저 — unique index(tenant_id, email)가 경합도 막는다(23505).
  const { error: dbErr } = await admin
    .from("users")
    .update({ email })
    .eq("id", id)
    .eq("tenant_id", actor.tenantId);
  if (dbErr) {
    if (dbErr.code === "23505") return { error: "이미 사용 중인 이메일입니다" };
    return { error: dbErr.message };
  }

  // 2) auth.users — 실패하면 public.users를 원래 이메일로 롤백해 불일치를 방지.
  const { error: authErr } = await admin.auth.admin.updateUserById(id, {
    email,
    email_confirm: true,
  });
  if (authErr) {
    await admin.from("users").update({ email: target.email }).eq("id", id);
    return { error: `Auth 이메일 변경 실패: ${authErr.message}` };
  }

  revalidatePath(`/staff/${id}`);
  revalidatePath("/staff");
  return { ok: true };
}

/**
 * 직원 완전 삭제 — auth.users + public.users 제거. 본인·동급·상위 계정은 불가.
 * 순서: ① 출결 기록자(restrict FK)면 사전 차단 → ② auth 먼저(실패 시 public 보존) → ③ public.
 */
export async function deleteStaff(
  _prev: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { error: "로그인이 필요합니다" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "직원 ID가 누락되었습니다" };
  if (id === actor.id) return { error: "본인 계정은 삭제할 수 없습니다" };

  const target = await loadTarget(id, actor);
  if ("error" in target) return target;
  if (!canManageStaffMember(actor.systemRole, target.role)) {
    return { error: "이 직원을 삭제할 권한이 없습니다" };
  }

  const admin = createAdminClient();

  // ① attendance_records.recorded_by 는 ON DELETE restrict — 기록자면 하드 삭제 불가.
  //    미리 막아 auth/public 중 하나만 지워지는 상태를 원천 차단(+ '퇴사' 권장).
  const { count } = await admin
    .from("attendance_records")
    .select("id", { count: "exact", head: true })
    .eq("recorded_by", id);
  if (count && count > 0) {
    return {
      error: "출결 기록이 있어 완전 삭제할 수 없습니다. '퇴사(비활성)' 처리를 권장합니다.",
    };
  }

  // ② auth.users 먼저 — 실패해도 public.users가 남아 직원 정보·로그인이 보존된다.
  const { error: authErr } = await admin.auth.admin.deleteUser(id);
  if (authErr) return { error: `로그인 계정 삭제 실패: ${authErr.message}` };

  // ③ public.users — payroll/leaves cascade, classes/students 담임은 set null로 자동 처리.
  const { error: dbErr } = await admin
    .from("users")
    .delete()
    .eq("id", id)
    .eq("tenant_id", actor.tenantId);
  if (dbErr) {
    // 여기 도달은 드묾(restrict FK는 ①에서 차단). 도달 시 auth는 이미 삭제 → 치명적 불일치라 로깅.
    console.error(`[deleteStaff] auth 삭제 후 public.users 삭제 실패(${id}):`, dbErr.message);
    if (dbErr.code === "23503") {
      return { error: "연결된 데이터가 있어 삭제를 완료하지 못했습니다. 관리자에게 문의하세요." };
    }
    return { error: dbErr.message };
  }

  revalidatePath("/staff");
  redirect("/staff");
}

/** 주간 근무 일정 저장(work_schedule jsonb). 비번/이메일과 동일한 엄격 권한·테넌트 게이트. */
export async function updateWorkSchedule(
  _prev: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { error: "로그인이 필요합니다" };
  if (!canManageStaff(actor.systemRole)) {
    return { error: "근무 일정 편집 권한이 없습니다" };
  }

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "직원 ID가 누락되었습니다" };

  const target = await loadTarget(id, actor);
  if ("error" in target) return target;
  // 비번/이메일/삭제와 동일하게 actor가 대상보다 엄격히 강해야 함(매니저가 마스터 일정 못 건드림).
  if (!canManageStaffMember(actor.systemRole, target.role)) {
    return { error: "이 직원의 근무 일정을 편집할 권한이 없습니다" };
  }

  // 클라이언트가 직렬화한 JSON을 파싱 + 읽기와 동일한 엄격 규칙으로 정제(요일 키 + 유효 시간대만 통과).
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(formData.get("schedule") ?? "{}"));
  } catch {
    return { error: "근무 일정 형식이 올바르지 않습니다" };
  }
  const clean = sanitizeWorkSchedule(parsed);
  const value = Object.keys(clean).length > 0 ? clean : null;

  const admin = createAdminClient();
  const { error } = await admin
    .from("users")
    .update({ work_schedule: value })
    .eq("id", id)
    .eq("tenant_id", actor.tenantId);
  if (error) return { error: error.message };

  revalidatePath(`/staff/${id}`);
  return { ok: true };
}
