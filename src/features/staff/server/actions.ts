"use server";

import { revalidatePath } from "next/cache";
import type { SystemRole } from "@/lib/permissions";
import { isHexColor, readableTextColor } from "@/lib/color-utils";
import {
  canAssignRole,
  ROLE_HIERARCHY,
} from "@/lib/auth/role-hierarchy";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { isFullShellRole } from "@/lib/auth/view-as";
import { accessLevelTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { isAssignableTeacherRole } from "@/lib/permissions";
import { moveLiveSlotTeacher, reassignHomeroom } from "@/features/classes/server/handover";
import { notifyUsers } from "@/features/notifications/server/notify";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction } from "@/features/audit/server/log";
import { createClient } from "@/lib/supabase/server";
import { canEditLoginEmail, EMAIL_RE } from "@/features/staff/email";
import { getActiveAssistSlotClasses } from "./queries";

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
    // 학생 출결 알림(클래스노트) 받기 — 체크박스라 미체크면 formData에 키 자체가 없다(빈 문자열 = false).
    attendanceAlertOptin: get("attendanceAlertOptin") === "on",
    seatLabDuty: get("seatLabDuty") === "on",
    seatJjDuty: get("seatJjDuty") === "on",
    // 셔틀 담당(0227a) — 역할을 안 올리고 셔틀 등하원만 여는 개인 토글.
    shuttleDuty: get("shuttleDuty") === "on",
    deskAttendanceOptin: get("deskAttendanceOptin") === "on",
    // '강사뷰 접근'(0224a) — 체크박스는 폼에 master(+super_admin)에게만 노출되고, 저장도 그 자격일 때만
    // 컬럼을 건드린다(아래 canGrantTeacherView 스프레드). 아니면 미체크=off로 남의 부여를 지우게 된다.
    teacherViewAccess: get("teacherViewAccess") === "on",
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
  // 역할이 아니라 **직원관리 메뉴 권한**으로 게이트(개인 예외 포함, 2026-08-01) — 역할만 보면
  // 메뉴가 잠긴 관리자가 서버 액션 직접 호출로 우회한다(#77).
  if (!(await canWriteTenant(actor.systemRole, "staff"))) {
    return { error: "직원 추가 권한이 없습니다" };
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
  // 🔴 저장할 값은 **한 번만** 만든다 — 아래 0209a 폴백이 같은 payload를 복사해 두면, 나중에 칸이
  //    하나 늘 때 한쪽만 고쳐져 "가끔 그 칸만 저장이 안 되는" 침묵 버그가 된다(자리 토글만 빼서 재시도).
  const staffPatch = {
    display_name: input.displayName,
    phone: input.phone,
    system_role: newRole,
    status: "active" as const,
    hire_date: input.hireDate,
    job_title: input.jobTitle,
    english_name: input.englishName,
    subjects: input.subjects,
    default_classroom: input.defaultClassroom,
    memo: input.memo,
    bg_color: input.bgColor,
    text_color: input.textColor,
    attendance_alert_optin: input.attendanceAlertOptin,
  };
  // '강사뷰 접근'(0224a)은 master(+super_admin)만 저장 — 아니면 컬럼을 아예 안 건드린다(폼에도 미노출이라
  // 미체크=off가 실려 오는데, 그걸 그대로 쓰면 남이 부여한 접근이 조용히 지워진다).
  const canGrantTeacherView = actor.systemRole === "master" || (await isCurrentUserSuperAdmin());
  // 강사·학생 역할엔 부여 불가(소비처 없음 — canUseOtherTeacherView가 풀셸 역할만 통과). 조용히 버리면
  // "저장됐는데 안 됨"이 되므로 **명시 거절**한다(write-only-orphan 방지).
  if (canGrantTeacherView && input.teacherViewAccess && !isFullShellRole(newRole)) {
    await admin.auth.admin.deleteUser(authData.user.id);
    await admin.from("users").delete().eq("id", authData.user.id);
    return { error: "강사·학생 역할에는 '강사뷰 접근'을 줄 수 없습니다 (관리자 계열 전용)" };
  }
  // 마이그레이션이 손으로 적용되기 전일 수 있는 선택 토글들(#95) — 가장 최근 것(0227a shuttle_duty)만
  // 따로 떼어 낸다. 통째로 재시도하면 이미 적용된 자리 담당·데스크 알림·강사뷰 접근까지 그 창에 갇힌다.
  const optionalToggles = {
    seat_lab_duty: input.seatLabDuty,
    seat_jj_duty: input.seatJjDuty,
    desk_attendance_optin: input.deskAttendanceOptin,
    ...(canGrantTeacherView ? { teacher_view_access: input.teacherViewAccess } : {}),
  };
  let { error: dbErr } = await admin
    .from("users")
    .update({ ...staffPatch, ...optionalToggles, shuttle_duty: input.shuttleDuty })
    .eq("id", authData.user.id);
  if (dbErr && /shuttle_duty/i.test(dbErr.message)) {
    ({ error: dbErr } = await admin
      .from("users")
      .update({ ...staffPatch, ...optionalToggles })
      .eq("id", authData.user.id));
  }

  if (dbErr && /seat_lab_duty|seat_jj_duty|shuttle_duty|desk_attendance_optin|teacher_view_access/i.test(dbErr.message)) {
    // 0209a/0212a/0224a/0227a 미적용 — 선택 토글만 빼고 나머지를 저장한다(#95, 직원 등록을 죽이지 않음).
    const { error: retryErr } = await admin.from("users").update(staffPatch).eq("id", authData.user.id);
    if (retryErr) {
      await admin.auth.admin.deleteUser(authData.user.id);
      await admin.from("users").delete().eq("id", authData.user.id);
      return { error: `직원 정보 저장 실패: ${retryErr.message}` };
    }
  } else if (dbErr) {
    // 롤백 — auth user + 트리거가 만든 public.users 행 둘 다 정리(deleteUser는 public.users를 안 지움 = 고아 방지).
    await admin.auth.admin.deleteUser(authData.user.id);
    await admin.from("users").delete().eq("id", authData.user.id);
    return { error: `직원 정보 저장 실패: ${dbErr.message}` };
  }
  if (!dbErr && canGrantTeacherView && input.teacherViewAccess) {
    // '강사뷰 접근' 부여는 감사 대상(다른 강사 화면을 여는 권한) — 등록과 동시 부여도 남긴다.
    // ⚠️ dbErr(0224a 미적용 폴백)면 토글이 **저장되지 않았다** — 그때 로그를 남기면 감사가 거짓이 된다.
    await logAction({
      action: "staff_teacher_view_access",
      targetType: "user",
      targetLabel: input.displayName,
      metadata: { targetUserId: authData.user.id, enabled: true },
    });
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
  if (!(await canWriteTenant(actor.systemRole, "staff"))) {
    return { error: "직원 근무 설정 변경 권한이 없습니다" };
  }

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "직원 ID가 누락되었습니다" };

  const input = readBaseForm(formData);

  // 저장된 이메일과 대조 — 임포트 직원의 깨진 레거시 이메일("LAB 김주희@imported.local" 등)이
  // 그대로 재제출될 때 형식 검증이 다른 필드 수정까지 막지 않게, 이메일은 "변경된 경우에만" 검증·반영.
  const admin = createAdminClient();
  const { data: target, error: targetErr } = await admin
    .from("users")
    .select("tenant_id, email, system_role")
    .eq("id", id)
    .single();
  if (targetErr || !target) return { error: "대상 직원을 찾을 수 없습니다" };
  if (target.tenant_id !== actor.tenantId) {
    return { error: "다른 지점의 계정은 변경할 수 없습니다" };
  }
  // 🔴 '근무 설정' 폼엔 이메일 칸이 **없다**(이력서·계정 관리가 단일 소스, 2026-08-25) — 칸이 없으면
  //    input.email이 ""라 그대로 비교하면 **항상 "변경됨"**이 되어 빈 이메일로 로그인 계정을 날린다.
  //    없는 칸은 "안 바뀐 것"이 아니라 **"제출 대상이 아닌 것"**이라 formData 존재 여부로 먼저 가른다.
  const emailChanged =
    formData.has("email") &&
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
  // 🔴 저장할 값은 **한 번만** 만든다 — 폴백이 같은 payload를 복사해 두면 나중에 칸이 늘 때 한쪽만
  //    고쳐져 "가끔 그 칸만 저장이 안 되는" 침묵 버그가 된다. 폴백은 자리 토글만 빼고 이걸 재사용한다.
  // 🔴 **폼에 없는 칸은 저장에서도 뺀다**(스프레드 조건부). 연락처·직급·채용일은 이력서가 단일 소스라
  //    '근무 설정' 폼에서 빠졌는데(2026-08-25), 없는 칸을 그대로 실으면 readBaseForm이 만든 null이
  //    **이력서에서 동기해 둔 값을 통째로 지운다**(칸을 지운 화면이 데이터를 지우는 조용한 사고).
  //    존재 여부로 가르므로 나중에 칸을 되살리면 코드 변경 없이 다시 저장된다(생성 폼은 지금도 전부 보냄).
  const staffPatch = {
    display_name: input.displayName,
    ...(emailChanged ? { email: input.email } : {}),
    ...(formData.has("phone") ? { phone: input.phone } : {}),
    ...(formData.has("hireDate") ? { hire_date: input.hireDate } : {}),
    ...(formData.has("jobTitle") ? { job_title: input.jobTitle } : {}),
    english_name: input.englishName,
    subjects: input.subjects,
    default_classroom: input.defaultClassroom,
    memo: input.memo,
    bg_color: input.bgColor,
    text_color: input.textColor,
    attendance_alert_optin: input.attendanceAlertOptin,
  };
  // '강사뷰 접근'(0224a)은 master(+super_admin)만 저장 — 아니면 컬럼을 아예 안 건드린다(폼에도 미노출이라
  // 미체크=off가 실려 오는데, 그대로 쓰면 남이 부여한 접근이 조용히 지워진다). 부여·회수는 감사로그 대상.
  const canGrantTeacherView = actor.systemRole === "master" || (await isCurrentUserSuperAdmin());
  // 강사·학생 역할엔 부여 불가(소비처 없음) — 켜서 저장하려 하면 명시 거절(조용한 드롭 = 거짓 약속).
  if (canGrantTeacherView && input.teacherViewAccess && !isFullShellRole(target.system_role as SystemRole)) {
    return { error: "강사·학생 역할에는 '강사뷰 접근'을 줄 수 없습니다 (관리자 계열 전용)" };
  }
  let prevTeacherView: boolean | null = null; // 변경 감지용 — 0224a 미적용이면 에러 → null(저장·로그 스킵)
  if (canGrantTeacherView) {
    const { data: prevRow, error: prevErr } = await supabase
      .from("users")
      .select("teacher_view_access")
      .eq("id", id)
      .maybeSingle();
    prevTeacherView = prevErr || !prevRow ? null : prevRow.teacher_view_access === true;
  }
  // 위 createStaff와 같은 이유 — 0227a(shuttle_duty)만 미적용일 때 나머지 토글까지 잃지 않는다(#95).
  const optionalToggles = {
    seat_lab_duty: input.seatLabDuty,
    seat_jj_duty: input.seatJjDuty,
    desk_attendance_optin: input.deskAttendanceOptin,
    ...(canGrantTeacherView ? { teacher_view_access: input.teacherViewAccess } : {}),
  };
  let { error } = await supabase
    .from("users")
    .update({ ...staffPatch, ...optionalToggles, shuttle_duty: input.shuttleDuty })
    .eq("id", id);
  if (error && /shuttle_duty/i.test(error.message)) {
    ({ error } = await supabase
      .from("users")
      .update({ ...staffPatch, ...optionalToggles })
      .eq("id", id));
    // 셔틀 토글만 못 저장했다 — 켜려던 참이면 조용히 넘기지 않는다(거짓 약속 방지).
    if (!error && input.shuttleDuty) {
      return {
        error:
          "나머지는 저장했습니다. '셔틀 담당' 토글만 아직 저장할 수 없습니다(0227a 미적용) — 관리자에게 문의하세요.",
      };
    }
  }

  if (error) {
    // 0209a/0212a/0224a/0227a 미적용이면 선택 토글만 빼고 나머지를 저장한다(#95 — 직원 수정 화면을 죽이지 않음).
    if (/seat_lab_duty|seat_jj_duty|shuttle_duty|desk_attendance_optin|teacher_view_access/i.test(error.message)) {
      const { error: retry } = await supabase.from("users").update(staffPatch).eq("id", id);
      if (retry) return { error: retry.message };
      if (input.seatLabDuty || input.seatJjDuty || input.shuttleDuty || input.deskAttendanceOptin) {
        return { error: "일부 알림·담당 토글은 아직 저장할 수 없습니다. 관리자에게 문의하세요." };
      }
    } else {
      return { error: error.message };
    }
  } else if (canGrantTeacherView && prevTeacherView !== null && prevTeacherView !== input.teacherViewAccess) {
    // '강사뷰 접근' 부여·회수 — 다른 강사 화면을 여는 권한이라 누가 언제 바꿨는지 남긴다.
    await logAction({
      action: "staff_teacher_view_access",
      targetType: "user",
      targetLabel: input.displayName,
      metadata: { targetUserId: id, enabled: input.teacherViewAccess },
    });
  }

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
  if (!(await canWriteTenant(actor.systemRole, "staff"))) {
    return { error: "역할 변경 권한이 없습니다" };
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

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 퇴사일을 계약 이력에 한 줄로 남긴다(원장 지시 2026-08-07 "캘린더로 날짜 받아서 퇴사일 저장").
 *
 * ⚠️ `users`에 퇴사일 컬럼이 없다 — 원장이 Supabase SQL을 실행할 수 없어 컬럼 추가가 보류 중이라,
 *    이미 있는 `staff_contracts`(kind='note' = 기간 없는 이력 줄)에 기록한다. 직원 상세 '계약조건
 *    히스토리'에 그대로 보이고, 수정·삭제도 기존 UI로 된다. 컬럼이 생기면 그때 승격하면 된다.
 * ⚠️ note는 seq=0이라 차수 계산(contractsOnly = kind 'contract'만)에 영향이 없다.
 * best-effort — 실패해도 퇴사 처리 자체는 유효(상태가 진실, 이 줄은 기록).
 */
async function recordResignNote(
  userId: string,
  rawDate: string,
  actor: { id: string; tenantId: string },
): Promise<void> {
  const date = rawDate.trim();
  if (!YMD_RE.test(date)) return; // 날짜를 안 받았으면 줄을 만들지 않는다(빈 이력 줄은 노이즈).
  try {
    const admin = createAdminClient();
    // 같은 날짜의 퇴사 줄이 이미 있으면 다시 넣지 않는다(퇴사→복구→퇴사 반복 시 중복 방지).
    const { data: dup } = await admin
      .from("staff_contracts")
      .select("id")
      .eq("tenant_id", actor.tenantId)
      .eq("user_id", userId)
      .eq("kind", "note")
      .eq("start_date", date)
      .ilike("terms", "퇴사%")
      .maybeSingle();
    if (dup) return;
    await admin.from("staff_contracts").insert({
      tenant_id: actor.tenantId,
      user_id: userId,
      seq: 0,
      kind: "note",
      start_date: date,
      terms: `퇴사 (${date})`,
      created_by: actor.id,
    });
  } catch {
    // 기록 실패가 퇴사 처리를 막지 않는다.
  }
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
  if (!(await canWriteTenant(actor.systemRole, "staff"))) {
    return { error: "권한이 없습니다" };
  }

  const id = String(formData.get("id") ?? "").trim();
  // 본인을 퇴사 처리하면 그 자리에서 자기 접근이 끊긴다(복구는 다른 원장·관리자만 가능) — 원천 차단.
  // 삭제(deleteStaff)와 같은 self 가드. 동급 관리가 열린 뒤(2026-07-29)엔 실수로 닿기 더 쉬워졌다.
  if (id === actor.id) return { error: "본인 계정의 재직 상태는 바꿀 수 없습니다" };
  const next = String(formData.get("next") ?? "inactive");
  if (!STATUSES.includes(next as "active" | "inactive" | "pending")) {
    return { error: "유효한 상태가 아닙니다" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("users").update({ status: next }).eq("id", id);
  if (error) return { error: error.message };

  // 퇴사일 기록(원장 지시 2026-08-07) — users에 퇴사일 컬럼이 없어(SQL 접근 보류) **계약 이력 한 줄**로 남긴다.
  // kind='note'는 기간 없는 이력 줄이라 현재계약·차수 계산을 건드리지 않는다(contract.ts contractsOnly).
  if (next === "inactive") await recordResignNote(id, String(formData.get("resignDate") ?? ""), actor);

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

// ────────────────────── 퇴사 + 담임 일괄 인계 ──────────────────────
// 원장 지적(2026-08-03): "퇴사할 때 담당 반을 한 명씩 옮기고 퇴사 처리하면 효율이 떨어진다."
// 기존 흐름은 반 상세의 1건짜리 인수인계뿐이라 반 N개 = 화면 N번이었다. 여기서 **한 번에** 끝낸다.
//
// ⚠️ 인계를 먼저, 퇴사를 나중에 한다 — 인계가 실패하면 퇴사도 하지 않는다(그 반대는 "담임 없는 퇴직자"만
//    남겨 원래 문제를 그대로 재현).
// ⚠️ 대상 반은 **클라가 보낸 목록을 그대로 믿지 않는다** — 서버가 다시 조회한 "이 강사의 진행중 담임 반"과
//    교집합만 처리한다(화면 목록은 stale할 수 있고, 남의 반 id를 밀어넣는 변조도 막는다).

export type OffboardState =
  | {
      error?: string;
      ok?: true;
      /** 인계 후에도 이 강사에게 남은 진행중 담임 반 수(0이면 깨끗) */
      homeroomCount?: number;
      movedClasses?: number;
      movedSlots?: number;
      newTeacherName?: string;
    }
  | undefined;

export async function handoverAndDeactivate(
  _prev: OffboardState,
  formData: FormData,
): Promise<OffboardState> {
  const actor = await getCurrentUser();
  if (!actor) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(actor.systemRole, "staff"))) return { error: "권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "직원 ID가 누락되었습니다" };
  // deactivateStaff와 같은 self 가드 — 본인을 퇴사시키면 그 자리에서 자기 접근이 끊긴다.
  if (id === actor.id) return { error: "본인 계정의 재직 상태는 바꿀 수 없습니다" };

  const supabase = await createClient();
  const skip = String(formData.get("mode") ?? "") === "skip";
  let movedClasses = 0;
  let movedSlots = 0;
  let newTeacherName: string | undefined;

  if (!skip) {
    // 담임 교체는 반 관리 쓰기다 — 직원 권한만으론 못 한다(권한이 없으면 '인계 없이 퇴사'로 안내).
    const lvl = await accessLevelTenant(actor.systemRole, "classes");
    if (lvl !== "full" && lvl !== "scoped") {
      return { error: "반 담임을 바꿀 권한이 없습니다 — ‘인계 없이 퇴사 처리’만 가능합니다" };
    }

    const newTeacherId = String(formData.get("newTeacherId") ?? "").trim();
    if (!newTeacherId) return { error: "인계받을 강사를 선택해주세요" };
    if (newTeacherId === id) return { error: "퇴사하는 본인에게는 인계할 수 없습니다" };

    // 대상이 이 학원의 배정 가능한 재직자인지 서버에서 못박는다(변조 payload·타 테넌트 id 방어).
    // ⚠️ 역할 목록은 ASSIGNABLE_TEACHER_ROLES 단일 소스 — 여기 배열을 새로 적지 말 것.
    const { data: target } = await supabase
      .from("users")
      .select("display_name, system_role, status")
      .eq("id", newTeacherId)
      .maybeSingle();
    if (!target || !isAssignableTeacherRole(target.system_role) || target.status !== "active") {
      return { error: "유효한 강사가 아닙니다" };
    }
    newTeacherName = target.display_name ?? undefined;

    // 서버가 보는 진실 = 이 강사의 진행중 담임 반. 화면이 보낸 id와 교집합만 옮긴다.
    const { data: ownRows, error: ownErr } = await supabase
      .from("classes")
      .select("id, class_name")
      .eq("tenant_id", actor.tenantId)
      .eq("teacher_id", id)
      .eq("is_active", true);
    if (ownErr) return { error: ownErr.message };
    const owned = new Set((ownRows ?? []).map((c) => c.id as string));
    const selected = [...new Set(formData.getAll("classIds").map(String))].filter((c) =>
      owned.has(c),
    );
    // 담임은 아니지만 교시로 들어가던 반 — 슬롯만 옮긴다(담임은 남의 것이라 건드리지 않는다).
    const assistable = new Set((await getActiveAssistSlotClasses(id)).map((c) => c.id));
    const assist = [...new Set(formData.getAll("assistClassIds").map(String))].filter((c) =>
      assistable.has(c),
    );
    if (selected.length === 0 && assist.length === 0) {
      return { error: "인계할 반을 선택해주세요" };
    }

    // 두 표면을 함께 옮긴다: 교시별 강사 오버라이드(시간표·ECS가 읽는 값) → 담임.
    const slots = await moveLiveSlotTeacher(supabase, {
      tenantId: actor.tenantId,
      classIds: [...selected, ...assist],
      fromTeacherId: id,
      toTeacherId: newTeacherId,
    });
    if (slots.error) return { error: slots.error };
    const cls = await reassignHomeroom(supabase, {
      tenantId: actor.tenantId,
      classIds: selected,
      fromTeacherId: id,
      toTeacherId: newTeacherId,
    });
    if (cls.error) return { error: cls.error };
    movedClasses = cls.moved;
    movedSlots = slots.moved;

    // 대상 = 퇴사하는 직원. `userId`로 넣어야 뷰어의 '대상' 열이 이름으로 풀린다(auditTargetName 규약).
    await logAction({
      action: "class_handover_bulk",
      targetType: "staff",
      metadata: {
        userId: id,
        newTeacherId,
        classCount: movedClasses,
        slotCount: movedSlots,
        assistClassCount: assist.length,
      },
    });
    // 넘겨받은 강사에게 알림 — best-effort(실패해도 인계는 성공).
    if (movedClasses > 0 || movedSlots > 0) {
      const what = [
        movedClasses > 0 ? `반 ${movedClasses}개의 새 담임` : null,
        assist.length > 0 ? `다른 반 교시 담당` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      await notifyUsers([
        {
          tenantId: actor.tenantId,
          recipientId: newTeacherId,
          type: "teacher_handover",
          title: "담임 인수인계",
          body: `퇴사 처리에 따라 ${what}으로 지정되었습니다.`,
          link: "/classes",
          actorId: actor.id,
        },
      ]);
    }
  }

  const { error: statusErr } = await supabase
    .from("users")
    .update({ status: "inactive" })
    .eq("id", id);
  if (statusErr) return { error: statusErr.message };
  await recordResignNote(id, String(formData.get("resignDate") ?? ""), actor);

  // 인계 후에도 남은 담임 반(화면이 stale했거나 일부만 선택한 경우) — 막지 않고 사후 안내용. head:true(B2).
  const { count } = await supabase
    .from("classes")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", actor.tenantId)
    .eq("teacher_id", id)
    .eq("is_active", true);

  revalidatePath("/staff");
  revalidatePath(`/staff/${id}`);
  revalidatePath("/classes");
  revalidatePath("/timetable");
  return {
    ok: true,
    homeroomCount: count ?? 0,
    movedClasses,
    movedSlots,
    newTeacherName,
  };
}
