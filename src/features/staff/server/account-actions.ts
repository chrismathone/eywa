"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SystemRole } from "@/lib/permissions";
import { canManageStaffMember } from "@/lib/auth/role-hierarchy";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { sanitizeWorkSchedule } from "@/features/staff/work-schedule";
import { logAction } from "@/features/audit/server/log";

export type AccountActionState =
  | { error?: string; ok?: boolean; tempPassword?: string }
  | undefined;

type TargetInfo = { role: SystemRole; email: string; tenantId: string; displayName: string | null };

/**
 * Supabase Auth의 "그 사용자 없음"(404) 판별 — 임포트/시드된 "데이터 전용" 직원은 auth.users가 없다(#31).
 * deleteStaff는 이걸 "지울 로그인 계정이 애초에 없음"으로 보고 건너뛰지만, 비밀번호·이메일은 auth가 있어야만
 * 가능하다. 그대로 두면 Supabase의 영문 "User not found"가 화면에 노출되므로 한글 안내로 바꾼다.
 */
function isMissingAuthUser(err: { status?: number; message: string }): boolean {
  return err.status === 404 || /user not found/i.test(err.message);
}

/**
 * 대상 직원을 DB에서 직접 읽어 같은 테넌트인지 검증하고 권한 계층 판단에 필요한 값을 돌려준다.
 * 클라이언트가 보낸 값(role·email·tenant)은 신뢰하지 않는다(#S1).
 * ⚠️ 이 파일의 모든 대상-지정 액션이 여기를 거치므로 **직원관리 메뉴 게이트(개인 예외 포함)도 여기서**
 * 건다(2026-08-01) — canManageStaffMember는 역할 계층만 봐서, 메뉴가 잠긴 관리자의 직접 POST를 못 막는다(#77).
 */
async function loadTarget(
  id: string,
  actor: { id: string; tenantId: string; systemRole: SystemRole },
): Promise<TargetInfo | { error: string }> {
  if (!(await canWriteTenant(actor.systemRole, "staff"))) {
    return { error: "직원 계정을 관리할 권한이 없습니다" };
  }
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .select("tenant_id, system_role, email, display_name")
    .eq("id", id)
    .single();
  if (error || !data) return { error: "대상 직원을 찾을 수 없습니다" };
  if (data.tenant_id !== actor.tenantId) return { error: "다른 지점의 계정은 변경할 수 없습니다" };
  return {
    role: data.system_role as SystemRole,
    email: data.email as string,
    tenantId: data.tenant_id as string,
    displayName: (data.display_name as string | null) ?? null,
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
  if (error) {
    if (isMissingAuthUser(error)) {
      return { error: "이 직원은 로그인 계정이 없어 비밀번호를 설정할 수 없습니다. 먼저 로그인 계정을 만들어 주세요." };
    }
    return { error: `비밀번호 재설정 실패 — ${error.message}` };
  }

  // ⚠️ 남의 계정 비밀번호를 여는 행위 = 감사로그의 존재 이유. 본인 변경(self_password_change)은 남기는데
  //    이쪽이 빠져 있었다(2026-08-03). 발급된 비밀번호 자체는 절대 metadata에 넣지 않는다.
  await logAction({
    action: "staff_password_reset",
    targetType: "staff",
    targetLabel: target.displayName ?? target.email,
    metadata: { mode: mode === "custom" ? "custom" : "temp" },
  });

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
    if (isMissingAuthUser(authErr)) {
      return { error: "이 직원은 로그인 계정이 없어 이메일을 변경할 수 없습니다. 먼저 로그인 계정을 만들어 주세요." };
    }
    return { error: `로그인 계정 이메일 변경 실패 — ${authErr.message}` };
  }

  // 로그인 아이디가 바뀌는 변경 — 비밀번호 재설정과 같은 이유로 남긴다(본인 변경은 self_email_change).
  await logAction({
    action: "staff_email_change",
    targetType: "staff",
    targetLabel: target.displayName ?? email,
    metadata: { from: target.email, to: email },
  });

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
  //    단, 임포트/시드된 "데이터 전용" 직원은 auth.users가 없어 "User not found"(404)가 난다(#31).
  //    이건 정상 케이스(지울 로그인 계정이 애초에 없음)이므로 건너뛰고 ③ public 삭제로 진행한다.
  const { error: authErr } = await admin.auth.admin.deleteUser(id);
  if (authErr && authErr.status !== 404 && !/user not found/i.test(authErr.message)) {
    return { error: `로그인 계정 삭제 실패: ${authErr.message}` };
  }

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

  await logAction({
    action: "staff_delete",
    targetType: "staff",
    targetLabel: target.email,
    metadata: { role: target.role },
  });
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
  if (!(await canWriteTenant(actor.systemRole, "staff"))) {
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
