"use server";

import { careRecordsByStaff } from "@/features/newcomers/server/staff-refs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SystemRole } from "@/lib/permissions";
import { canManageStaffMember } from "@/lib/auth/role-hierarchy";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { canSeeStaffMember, STAFF_SCOPE_DENIED_MSG } from "../department/server/subject-scope";
import { createAdminClient } from "@/lib/supabase/admin";
import { explainDbError, logDbError } from "@/lib/supabase/db-error";
import { sanitizeWorkSchedule } from "@/features/staff/work-schedule";
import { EMAIL_RE } from "@/features/staff/email";
import { EMAIL_TAKEN_MESSAGE, isEmailTakenAuthError } from "@/lib/auth/auth-email-error";
import { isLoginEmailTakenElsewhere } from "./login-email-taken";
import { logAction } from "@/features/audit/server/log";
import { isProtectedSuperAdminTarget, SUPER_ADMIN_TARGET_DENIED_MSG } from "@/lib/auth/super-admin";
import { refuseIfProtectedStaff } from "./protected-guard";
import { cleanupPersonSettings } from "@/features/owner/server/retired-people";
import { authPasswordErrorMessage } from "@/lib/auth/auth-password-error";

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
  /** 로그인 자격을 바꾸는 작업(비밀번호·이메일·삭제)인가 — 그렇다면 super_admin 대상은 super_admin만. 이름·근무 설정은 false. */
  opts: { credential: boolean } = { credential: true },
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
  if (error || !data) {
    logDbError(error, "staff.loadTarget");
    return { error: "대상 직원을 찾을 수 없습니다" };
  }
  if (data.tenant_id !== actor.tenantId) return { error: "다른 지점의 계정은 변경할 수 없습니다" };
  // 과목 범위(원장 2026-09-23) — 목록에서 뺀 직원을 직접 POST로 고치지 못하게 여기서도 막는다(#77).
  if (!(await canSeeStaffMember(actor, id))) return { error: STAFF_SCOPE_DENIED_MSG };
  // super_admin 계정은 같은 학원 원장이라도 못 만진다(비밀번호 재설정 = 전 지점 총괄 탈취, 보안 감사 2026-09-29).
  if (opts.credential && (await isProtectedSuperAdminTarget(actor.id, id))) return { error: SUPER_ADMIN_TARGET_DENIED_MSG };
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
    // 약한 비밀번호 등 사람이 고칠 수 있는 원인 — 원문 대신 무엇을 하면 되는지(P1-E).
    const why = authPasswordErrorMessage(error);
    if (why) return { error: why };
    return { error: explainDbError(error, { scope: "staff.account-actions.resetStaffPassword", fallback: "비밀번호 재설정 실패 — 잠시 후 다시 시도해 주세요" }).message };
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

/**
 * 직원 이메일 변경의 **단일 구현** — public.users 먼저, auth.users 나중(+실패 시 롤백)으로 불일치를 막는다.
 *
 * 창구가 둘이다(2026-08-25): '계정 관리 → 이메일 변경' 다이얼로그와 **이력서 인적사항 E-mail**.
 * 🔴 그래서 게이트를 호출부에 맡기지 않고 **여기서 전부 다시 건다** — 이력서는 직원관리 쓰기만 있으면
 * 편집할 수 있어서, 그대로 이으면 매니저가 이력서로 원장 로그인 이메일을 갈아끼울 수 있다(#77).
 * 로그인 아이디가 바뀌는 행위라 자격은 비밀번호 재설정과 같은 선(자신 권한 이하)으로 잡는다.
 *
 * ⚠️ **로그인 계정(auth)이 없는 직원**(임포트분 #31)은 실패가 아니라 정상 경로다 — public.users만 바꾸고
 * 끝낸다. 예전엔 여기서 거절해서, `@imported.local` 임시 주소를 실제 주소로 고칠 창구가 아예 없었다.
 *
 * @returns changed=false는 "같은 주소라 할 일이 없었음"(성공).
 */
export async function applyStaffEmailChange(
  targetId: string,
  nextEmail: string,
  via: "account-card" | "resume" = "account-card",
): Promise<{ ok: true; changed: boolean } | { error: string }> {
  const actor = await getCurrentUser();
  if (!actor) return { error: "로그인이 필요합니다" };

  const id = String(targetId ?? "").trim();
  // 이메일은 대소문자 무시(RFC) — 정규화해 케이스만 바꾼 우회 중복을 막는다.
  const email = String(nextEmail ?? "").trim().toLowerCase();
  if (!id) return { error: "직원 ID가 누락되었습니다" };
  if (!EMAIL_RE.test(email)) return { error: "이메일 형식이 올바르지 않습니다" };

  const target = await loadTarget(id, actor);
  if ("error" in target) return target;
  if (!canManageStaffMember(actor.systemRole, target.role)) {
    return { error: "이 직원의 이메일을 변경할 권한이 없습니다" };
  }
  if (target.email.toLowerCase() === email) return { ok: true, changed: false }; // 변동 없음

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
  // 다른 지점 계정이 쓰는 이메일 — 위 검사는 제 지점만 보고, Auth는 **변경** 경로에서 중복을 500 "Error updating user"로만
  // 답해 원인을 말해 주지 않는다(생성 경로의 422 email_exists와 다르다). 아무것도 쓰기 전에 여기서 막는다.
  if (await isLoginEmailTakenElsewhere(admin, email, id)) return { error: EMAIL_TAKEN_MESSAGE };

  // 1) public.users 먼저 — unique index(tenant_id, email)가 경합도 막는다(23505).
  const { error: dbErr } = await admin
    .from("users")
    .update({ email })
    .eq("id", id)
    .eq("tenant_id", actor.tenantId);
  if (dbErr) {
    if (dbErr.code === "23505") return { error: "이미 사용 중인 이메일입니다" };
    return { error: explainDbError(dbErr, { scope: "staff.account.email", fallback: "이메일을 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요." }).message };
  }

  // 2) auth.users — 실패하면 public.users를 원래 이메일로 롤백해 불일치를 방지.
  //    단 **계정 자체가 없는 것**은 롤백 사유가 아니다(바꿀 로그인이 애초에 없다 = public이 곧 진실).
  const { error: authErr } = await admin.auth.admin.updateUserById(id, {
    email,
    email_confirm: true,
  });
  if (authErr && !isMissingAuthUser(authErr)) {
    await admin.from("users").update({ email: target.email }).eq("id", id);
    // Auth가 코드로 "이미 있는 이메일"이라 답해 준 경우만(지금 GoTrue의 변경 경로는 500이라 여기 안 온다 — 본문은 앞의 사전 조회다).
    // users는 바로 위에서 원래 값으로 되돌렸다.
    if (isEmailTakenAuthError(authErr)) return { error: EMAIL_TAKEN_MESSAGE };
    return { error: explainDbError(authErr, { scope: "staff.account-actions.applyStaffEmailChange", fallback: "로그인 계정 이메일 변경 실패 — 잠시 후 다시 시도해 주세요" }).message };
  }

  // 로그인 아이디가 바뀌는 변경 — 비밀번호 재설정과 같은 이유로 남긴다(본인 변경은 self_email_change).
  await logAction({
    action: "staff_email_change",
    targetType: "staff",
    targetLabel: target.displayName ?? email,
    // 어느 창구로 바뀌었는지까지 남긴다 — 이력서 저장의 **부수효과**로 로그인 아이디가 바뀌는 경로가
    // 생겼으므로("계정 관리에서 아무도 안 바꿨는데?") 역검수하려면 문을 구분할 수 있어야 한다.
    // ⚠️ 클라가 직접 부를 수 있는 서버 액션이라 인자를 그대로 믿지 않고 두 값으로 정규화한다.
    metadata: {
      from: target.email,
      to: email,
      via: via === "resume" ? "resume" : "account-card",
      noAuthAccount: Boolean(authErr),
    },
  });

  revalidatePath(`/staff/${id}`);
  revalidatePath("/staff");
  return { ok: true, changed: true };
}

/**
 * 직원 **표시 이름 변경**의 단일 구현 — 입력 창구는 **이력서 성명** 하나다(원장 2026-08-25).
 *
 * 🔴 이름은 라벨이 아니라 **과거 기록의 조인 키**다. 그래서 바꿀 때 옛 이름을 키로 쓰던 행을 함께 옮긴다:
 *   · `textbook_orders.teacher_name` = **소유자**(사무실이 대신 낸 요청은 created_by가 사무실이라
 *     이름이 유일한 연결이다 — 안 옮기면 그 강사가 자기 요청을 잃는다, `ownsTextbookRequest`).
 *   · `lesson_reports.teacher_name` = 0172a 이전 행의 **귀속 폴백**(teacher_id가 빈 행만).
 * ⚠️ **`invoice_teacher_splits.teacher_name`은 건드리지 않는다** — 그건 "그때 그 이름"을 남기려고
 *    일부러 뜬 **스냅샷**이고(돈 계열·골든마스터), 옮기면 지난 정산서의 사실이 바뀐다.
 * ⚠️ 동명이인이 있으면 백필을 **통째로 건너뛴다**(이름만으론 남의 행과 구분이 안 된다 — 조용히 남의
 *    기록을 옮기느니 안 옮기고 알리는 쪽). 호출부가 `ambiguous`를 받아 경고한다.
 *
 * 미러 트리거(0075a)는 `display_name = coalesce(기존, 새것)`이라 auth를 건드릴 필요가 없다(이메일과 다름).
 */
export async function applyStaffNameChange(
  targetId: string,
  nextName: string,
  via: "account-card" | "resume" = "resume",
): Promise<
  | { ok: true; changed: boolean; ambiguous?: boolean; moved?: number; backfillError?: string | null }
  | { error: string }
> {
  const actor = await getCurrentUser();
  if (!actor) return { error: "로그인이 필요합니다" };

  const id = String(targetId ?? "").trim();
  const name = String(nextName ?? "").trim();
  if (!id) return { error: "직원 ID가 누락되었습니다" };
  if (!name) return { error: "이름은 비울 수 없습니다" };

  const target = await loadTarget(id, actor, { credential: false });
  if ("error" in target) return target;
  // 개명은 그 사람의 앱 정체성을 바꾼다 — 이메일·비밀번호와 같은 보호선(자신 권한 이하)으로 잡는다.
  if (!canManageStaffMember(actor.systemRole, target.role)) {
    return { error: "이 직원의 이름을 변경할 권한이 없습니다" };
  }
  const prevName = (target.displayName ?? "").trim();
  if (prevName === name) return { ok: true, changed: false };

  const admin = createAdminClient();
  // 옛 이름을 쓰는 **다른** 직원이 있으면 이름 기반 백필은 남의 행까지 옮긴다 → 백필만 포기.
  const { count: sameName } = await admin
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", actor.tenantId)
    .eq("display_name", prevName)
    .neq("id", id);
  const ambiguous = (sameName ?? 0) > 0;

  const { error: dbErr } = await admin
    .from("users")
    .update({ display_name: name })
    .eq("id", id)
    .eq("tenant_id", actor.tenantId);
  if (dbErr) return { error: explainDbError(dbErr, { scope: "staff.account.name", fallback: "이름을 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요." }).message };

  // 옛 이름을 키로 쓰던 행 이전(모호하지 않고, 옛 이름이 있을 때만).
  // ⚠️ 여기서 에러를 삼키면 "이름은 바뀌었는데 연결은 안 옮겨진" 상태가 조용히 남는다([[#53]]) —
  //    실패를 호출부까지 올려 사람이 알게 한다(이름 변경 자체는 이미 성공했으므로 되돌리지 않는다).
  let moved = 0;
  let backfillError: string | null = null;
  if (prevName && !ambiguous) {
    // 교재요청 소유자 — 사무실이 대신 낸 요청은 이름이 유일한 연결이라 반드시 따라가야 한다.
    const books = await admin
      .from("textbook_orders")
      .update({ teacher_name: name }, { count: "exact" })
      .eq("tenant_id", actor.tenantId)
      .eq("teacher_name", prevName);
    // 옛 보고서 귀속 폴백 — 소유 1차 키(created_by, 0172a)가 **없는 행만**. 있는 행은 이름과 무관하게
    // 이미 계정으로 이어져 있어 건드릴 이유가 없다. 🔴 이 표엔 teacher_id 컬럼이 없다(created_by가 그 자리).
    const reports = await admin
      .from("lesson_reports")
      .update({ teacher_name: name }, { count: "exact" })
      .eq("tenant_id", actor.tenantId)
      .eq("teacher_name", prevName)
      .is("created_by", null);
    moved = (books.count ?? 0) + (reports.count ?? 0);
    backfillError = books.error?.message ?? reports.error?.message ?? null;
  }

  await logAction({
    action: "staff_name_change",
    targetType: "staff",
    targetLabel: name,
    metadata: {
      from: prevName || null,
      to: name,
      via: via === "account-card" ? "account-card" : "resume",
      movedRows: moved,
      ambiguous,
      ...(backfillError ? { backfillError } : {}),
    },
  });

  revalidatePath(`/staff/${id}`);
  revalidatePath("/staff");
  return { ok: true, changed: true, ambiguous, moved, backfillError };
}

/** 계정 관리 → 이메일 변경 다이얼로그. 판정·저장은 전부 applyStaffEmailChange(단일 구현)에 있다. */
export async function changeStaffEmail(
  _prev: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const result = await applyStaffEmailChange(
    String(formData.get("id") ?? ""),
    String(formData.get("email") ?? ""),
  );
  return "error" in result ? { error: result.error } : { ok: true };
}

/**
 * 직원 완전 삭제 — auth.users + public.users 제거. **본인·상위 계정은 불가**(동급은 가능 —
 * canManageStaffMember가 '자신 권한 이하 전부'라, 2026-08-11부터 매니저도 동급 매니저를 지울 수 있다).
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
  // 보호 계정(슈퍼관리자)은 총괄끼리도 지우지 못한다(원장 2026-09-30 "강력 가드") — loadTarget의 자격 보호선보다 강하다.
  const protectedMsg = await refuseIfProtectedStaff(id, "delete", target.displayName);
  if (protectedMsg) return { error: protectedMsg };

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

  // ①-2 신규생 정착 관리·콜&상담 여정 기록(s2_0060~s2_0062)도 직원 칸이 지움을 막는다 — 같은 까닭으로 미리 막는다.
  const careRefs = await careRecordsByStaff(id);
  if (careRefs === "refs") {
    return { error: "신규생 관리·상담 방문 기록이 있어 완전 삭제할 수 없습니다. '퇴사(비활성)' 처리를 권장합니다." };
  }
  if (careRefs === "error") return { error: "남은 기록을 확인하지 못해 삭제하지 않았습니다. 잠시 후 다시 시도해 주세요." };

  // ② auth.users 먼저 — 실패해도 public.users가 남아 직원 정보·로그인이 보존된다.
  //    단, 임포트/시드된 "데이터 전용" 직원은 auth.users가 없어 "User not found"(404)가 난다(#31).
  //    이건 정상 케이스(지울 로그인 계정이 애초에 없음)이므로 건너뛰고 ③ public 삭제로 진행한다.
  const { error: authErr } = await admin.auth.admin.deleteUser(id);
  if (authErr && authErr.status !== 404 && !/user not found/i.test(authErr.message)) {
    return { error: explainDbError(authErr, { scope: "staff.account-actions.deleteStaff", fallback: "로그인 계정 삭제 실패 — 잠시 후 다시 시도해 주세요" }).message };
  }

  // ③ public.users — payroll/leaves cascade, classes/students 담임은 set null로 자동 처리.
  const { error: dbErr } = await admin
    .from("users")
    .delete()
    .eq("id", id)
    .eq("tenant_id", actor.tenantId);
  if (dbErr) {
    // 여기 도달은 드묾(restrict FK는 ①에서 차단). 도달 시 auth는 이미 삭제 → 치명적 불일치라 로깅.
    // 로그인 계정은 이미 지워졌다 = 치명적 불일치 — 23503(입력 원인)이라도 에러 등급으로 남긴다([[#138]] 리뷰).
    const why = explainDbError(dbErr, { scope: "staff.delete.users", op: "delete", level: "error", fallback: "직원 기록을 지우지 못했습니다. 관리자에게 문의하세요.", context: { staffId: id } });
    if (dbErr.code === "23503") {
      return { error: `${why.message} — 로그인 계정은 이미 지워졌습니다. 관리자에게 문의하세요.` };
    }
    return { error: why.message };
  }

  await logAction({
    action: "staff_delete",
    targetType: "staff",
    targetLabel: target.email,
    metadata: { role: target.role },
  });
  // 지운 계정의 주는 값도 학원 설정에서 뺀다(원장 2026-11-09 — 퇴사와 같은 함수). 읽는 쪽은 계정이 없는 사람을 거르지 않으므로(모르는 사람 — 리뷰 r1 F3) 여기서 지운다.
  await cleanupPersonSettings({ tenantId: actor.tenantId, userId: id, role: target.role, targetLabel: target.displayName ?? target.email, reason: "delete" });
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

  const target = await loadTarget(id, actor, { credential: false });
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
  if (error) return { error: explainDbError(error, { scope: "staff.account.workSchedule", fallback: "근무 설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." }).message };

  // admin 클라이언트라 DB 트리거가 행위자를 못 본다 — 누가 바꿨는지는 이 줄이 유일한 기록이다.
  await logAction({
    action: "staff_work_schedule_update",
    targetType: "staff",
    targetLabel: target.displayName ?? target.email,
    metadata: { userId: id, dayCount: Object.keys(clean).length },
  });
  revalidatePath(`/staff/${id}`);
  return { ok: true };
}
