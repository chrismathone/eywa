"use server";

import { revalidatePath } from "next/cache";
import type { SystemRole } from "@/lib/permissions";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { ROLE_HIERARCHY } from "@/lib/auth/role-hierarchy";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { humanizeDbError } from "@/lib/supabase/db-error";
import { createUploadTicket, MEDIA_KIND, removeObject } from "@/lib/storage/media-storage";
import { isTenantDocumentPath } from "@/lib/storage/legacy-audio-path";
import type { UploadTicket } from "@/lib/storage/types";
import { logAction } from "@/features/audit/server/log";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { EMAIL_RE } from "@/features/staff/email";
import { subjectsFromDepartment } from "../department-subjects";
import {
  INITIAL_STAFF_PASSWORD,
  parseResumeForm,
  resumeTitle,
  RESUME_FORM_TYPE,
  type StaffResumeData,
} from "../resume";
import { canViewResume, RESUME_LOCKED_MSG } from "./resume-access";
import { appendResumeToRoster } from "./resume-roster-sheet";

// 직원 이력서(웹 작성 폼) 변경 액션 — 게이트 2단: ① 역할(canWriteTenant("staff") = 사무실)
// ② 대상 이력서 열람 자격(canViewResume — 작성 본인·원장·재인증 토큰). ②가 없으면 화면에선 잠긴
// 이력서를 서버액션 직접 호출로 덮어쓰기·삭제할 수 있다(2026-07-15 적대검수 실적발).
// 저장소는 academy_documents(kind='form', restricted=true) — 데이터베이스 탐색기에도 같은 행이 보인다.
// restricted 행은 RLS restrictive(0072a)가 DB 레벨에서도 사무실 역할만 통과시킨다.

export type ResumeActionState =
  | {
      ok?: boolean;
      error?: string;
      detail?: string;
      id?: string;
      nonce?: number;
      redirectTo?: string;
      /** 저장은 성공했으나 부가 효과(직원명부 시트 기입)가 실패했을 때의 경고 — 토스트로만 노출. */
      warning?: string;
      /** 부가 효과 성공 안내(시트 기입 완료) — 토스트로만 노출. */
      notice?: string;
    }
  | undefined;

type Gate = { error: string; detail?: string } | { user: CurrentUser };

/**
 * 근무부서 → 담당 과목(users.subjects) 자동 도출. 부서와 과목은 같은 축이라 두 번 입력시키지 않는다
 * (원장 지시 2026-07-29). 과목 라벨은 학원설정 단일 소스 — 코드에 박지 않는다.
 * 교과가 아닌 부서(EIE·경영지원팀·개발팀·아르바이트…)는 빈 배열 = 담당 과목 없이 쓴다.
 */
async function subjectsForDivision(division: string): Promise<string[]> {
  if (!division.trim()) return [];
  const settings = await getTenantSettings();
  return subjectsFromDepartment(division, buildSubjectMaps(settings.operations.subjects).options);
}

async function requireStaffWrite(): Promise<Gate> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "staff"))) {
    return { error: "직원관리 권한이 없습니다" };
  }
  return { user };
}

/** 학생이 아닌 로그인 직원(본인 이력서 작성 포함) — 사진 업로드 티켓처럼 '직원이면 되는' 표면용. */
async function requireStaffMember(): Promise<Gate> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (user.systemRole === "student") return { error: "권한이 없습니다" };
  return { user };
}

/**
 * 역할 게이트 + **대상 이력서 열람 자격**까지 — 잠긴 이력서는 수정·삭제도 불가(화면 게이트와 동일 기준).
 * 화면의 `canWrite = canView && canWriteRole`는 렌더용일 뿐이라 서버가 같은 기준을 다시 확인해야 한다.
 */
async function requireResumeAccess(id: string): Promise<Gate> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("academy_documents")
    .select("uploaded_by, staff_user_id")
    .eq("id", id)
    .eq("form_type", RESUME_FORM_TYPE)
    .maybeSingle();
  if (error) return { error: humanizeDbError(error.message, "확인"), detail: error.message };
  if (!data) return { error: "이력서를 찾을 수 없습니다 — 이미 삭제되었을 수 있습니다" };
  const owner = (data as { staff_user_id?: string | null }).staff_user_id ?? null;
  if (!(await canViewResume(user, owner))) return { error: RESUME_LOCKED_MSG };
  // 남의 이력서를 고치려면 직원관리 쓰기 권한이 필요하다. **본인 이력서는 권한 없이도** 통과
  // (원장 지시 2026-07-29 — 강사·뷰어가 자기 이력서를 직접 채운다). 열람 게이트는 위에서 이미 통과.
  if (owner !== user.id && !(await canWriteTenant(user.systemRole, "staff"))) {
    return { error: "직원관리 권한이 없습니다" };
  }
  return { user };
}

export type ResumePhotoTicketState = { ticket?: UploadTicket; error?: string } | undefined;

// 증명사진 허용 형식 — 이미지 3종만(문서 kind의 넓은 allowCT를 사진 용도로 좁힌다).
const PHOTO_CT = new Set(["image/jpeg", "image/png", "image/webp"]);
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/**
 * 증명사진 업로드 티켓 발급 — documents 2단 티켓 패턴 재사용(경로는 서버가 빌드, 버킷은 academy-documents).
 * 열람은 이력서 재인증 게이트(canViewResume) 뒤에서만 signed URL을 발급하므로 경로 유출 자체로는 못 본다.
 */
export async function issueResumePhotoTicket(
  _prev: ResumePhotoTicketState,
  formData: FormData,
): Promise<ResumePhotoTicketState> {
  // 사무실뿐 아니라 **본인 이력서를 채우는 직원**도 사진을 올린다(2026-07-29). 티켓은 테넌트 내부 경로만
  // 만들 뿐이고, 그 경로가 실제 이력서에 붙는 건 게이트된 saveStaffResume을 통과할 때뿐이다. 학생은 제외.
  const gate = await requireStaffMember();
  if ("error" in gate) return { error: gate.error };

  const contentType = String(formData.get("contentType") ?? "");
  if (!PHOTO_CT.has(contentType)) return { error: "사진은 JPG·PNG·WebP만 첨부할 수 있습니다" };
  const size = Number(formData.get("size") ?? 0);
  if (!Number.isFinite(size) || size <= 0 || size > Math.min(PHOTO_MAX_BYTES, MEDIA_KIND.document.maxBytes)) {
    return { error: "사진이 너무 큽니다 (최대 5MB)" };
  }
  const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const path = `${gate.user.tenantId}/documents/${crypto.randomUUID()}.${ext}`;
  if (!isTenantDocumentPath(path, gate.user.tenantId)) return { error: "경로 생성 실패" };
  try {
    return { ticket: await createUploadTicket({ kind: "document", path, contentType }) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "업로드 티켓 발급 실패" };
  }
}

/**
 * 이력서 원샷 직원 등록(2026-07-28 원장 지시) — 신규 이력서 저장 시 이메일로 로그인 계정까지 생성.
 * 실패해도 이력서 저장은 유효(부분 성공) — 결과는 notice/warning 토스트로만.
 * - 같은 이메일 직원이 이미 있으면 **생성 대신 연결**(시트 이관 직원과의 병합 경로) + 빈 인사 필드만 보강.
 * - 계정 생성은 createStaff와 동일 순서: auth createUser(미러 트리거가 users 최소 행 생성) → UPDATE 보강 → 실패 시 양쪽 롤백.
 */
async function registerStaffFromResume(
  actor: CurrentUser,
  data: StaffResumeData,
  roleRaw: string,
  resumeId: string,
): Promise<{ notice?: string; warning?: string }> {
  if (!(await canWriteTenant(actor.systemRole, "staff"))) {
    return { warning: "직원 계정 등록 권한이 없어 이력서만 저장했습니다" };
  }
  const role = roleRaw as SystemRole;
  if (!(role in ROLE_HIERARCHY) || role === "student") return { warning: "직원 계정 역할을 선택하지 않아 이력서만 저장했습니다" };
  if (ROLE_HIERARCHY[actor.systemRole] >= ROLE_HIERARCHY[role]) {
    return { warning: `'${role}' 역할은 본인 권한으로 부여할 수 없어 이력서만 저장했습니다` };
  }
  const email = data.personal.email.trim();
  if (!email || !EMAIL_RE.test(email)) {
    return { warning: "이메일이 없거나 형식이 잘못돼 직원 계정을 만들지 못했습니다 — 인적사항 E-mail을 확인하세요" };
  }

  const admin = createAdminClient();
  const derivedSubjects = await subjectsForDivision(data.contract.division);
  const profile = {
    phone: data.personal.phone || null,
    hire_date: data.contract.startDate || null,
    department: data.contract.division || null,
    employment_type: data.contract.employmentType || null,
    job_title: data.contract.jobTitle || null,
    // 담당 과목 = 부서에서 파생(별도 입력 없음). 교과 부서가 아니면 빈 배열.
    subjects: derivedSubjects,
  };

  // 같은 테넌트에 같은 이메일 직원이 이미 있으면 = 같은 사람(시트 이관분 등) → 새 계정 대신 연결.
  const { data: dup } = await admin
    .from("users")
    .select("id, display_name, phone, hire_date, department, employment_type, job_title, subjects")
    .eq("tenant_id", actor.tenantId)
    .ilike("email", email)
    .maybeSingle();
  if (dup) {
    // 빈 인사 필드만 보강(기존 값은 절대 덮지 않는다 — 이력서가 옛 정보일 수 있음).
    const fill: Record<string, unknown> = {};
    for (const k of ["phone", "hire_date", "department", "employment_type", "job_title"] as const) {
      if (!dup[k] && profile[k]) fill[k] = profile[k];
    }
    // 담당 과목도 비어 있을 때만 부서에서 채운다(겸임 수동 지정을 덮지 않게).
    if (derivedSubjects.length > 0 && !(Array.isArray(dup.subjects) && dup.subjects.length > 0)) {
      fill.subjects = derivedSubjects;
    }
    if (Object.keys(fill).length > 0) await admin.from("users").update(fill).eq("id", dup.id);
    await admin.from("academy_documents").update({ staff_user_id: dup.id }).eq("id", resumeId);
    await logAction({
      action: "staff_link_from_resume",
      targetType: "user",
      targetLabel: data.personal.name,
      metadata: { resumeId, userId: dup.id, filled: Object.keys(fill) },
    });
    return { notice: `이미 등록된 직원(${dup.display_name ?? email})과 이력서를 연결했습니다` };
  }

  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email,
    password: INITIAL_STAFF_PASSWORD,
    email_confirm: true,
    app_metadata: { tenant_id: actor.tenantId, system_role: role },
  });
  if (authErr || !authData?.user) {
    return { warning: `이력서는 저장됐지만 계정 생성에 실패했습니다 — ${authErr?.message ?? "unknown"}` };
  }
  const { error: dbErr } = await admin
    .from("users")
    .update({
      display_name: data.personal.name,
      system_role: role,
      status: "active",
      ...profile,
    })
    .eq("id", authData.user.id);
  if (dbErr) {
    await admin.auth.admin.deleteUser(authData.user.id);
    await admin.from("users").delete().eq("id", authData.user.id);
    return { warning: `이력서는 저장됐지만 직원 정보 저장에 실패했습니다 — ${dbErr.message}` };
  }
  await admin.from("academy_documents").update({ staff_user_id: authData.user.id }).eq("id", resumeId);
  await logAction({
    action: "staff_create_from_resume",
    targetType: "user",
    targetLabel: data.personal.name,
    metadata: { resumeId, userId: authData.user.id, role, email },
  });
  return { notice: `직원 계정을 등록했습니다 (초기 비밀번호 ${INITIAL_STAFF_PASSWORD} — 본인이 로그인 후 변경)` };
}

/** 생성/수정 겸용 — formData에 id가 있으면 해당 이력서 갱신, 없으면 신규 작성. */
export async function saveStaffResume(
  _prev: ResumeActionState,
  formData: FormData,
): Promise<ResumeActionState> {
  const id = String(formData.get("id") ?? "").trim();
  // 수정은 열람 자격까지(잠긴 이력서 덮어쓰기 차단), 생성은 역할만 —
  // 단 **본인에게 연결되는 이력서를 본인이 처음 쓰는 경우**는 직원관리 권한 없이도 허용(2026-07-29).
  const linkRaw = String(formData.get("staff_user_id") ?? "").trim();
  const me = await getCurrentUser();
  const selfCreate = !id && !!me && linkRaw === me.id;
  const gate = id
    ? await requireResumeAccess(id)
    : selfCreate
      ? await requireStaffMember()
      : await requireStaffWrite();
  if ("error" in gate) return { error: gate.error, detail: gate.detail };

  const data = parseResumeForm(formData);
  if (!data.personal.name) return { error: "성명을 입력하세요" };
  // 사진 경로는 서버 발급 티켓 경로만 유효 — 남의 테넌트 경로를 form_data에 심는 변조 차단.
  for (const p of data.photos) {
    if (!isTenantDocumentPath(p, gate.user.tenantId)) return { error: "사진 경로가 올바르지 않습니다 — 사진을 다시 첨부하세요" };
  }

  const supabase = await createClient();

  if (id) {
    const { data: updated, error } = await supabase
      .from("academy_documents")
      .update({
        title: resumeTitle(data),
        form_data: data,
        restricted: true, // 매 저장마다 재확인 — 어떤 경로로든 false로 뒤집힌 행이 평문 노출되지 않게.
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("form_type", RESUME_FORM_TYPE)
      .select("id, staff_user_id"); // ⚠️ select 없으면 **0행 매칭도 error:null** → "저장됨"인데 아무것도 안 바뀜.
    if (error) return { error: humanizeDbError(error.message, "저장"), detail: error.message };
    if (!updated?.length) {
      return {
        error: "이력서를 찾을 수 없습니다 — 다른 사람이 삭제했을 수 있습니다. 입력한 내용을 복사해 두고 새로 작성하세요",
      };
    }
    // 연결된 직원 동기화(2026-07-28 원장 제보: "부서를 이력서에서 바꿨는데 목록이 안 바뀜") —
    // 직원목록·필터·대시보드는 users를 읽으므로, 이력서 수정이 인사 필드를 users로 밀어줘야 한다.
    // 이력서에 **값이 있는 항목만** 덮는다(빈 칸으로 계정 값을 지우지 않게). admin + tenant 스코프(0104a 규약).
    const linkedId = (updated[0] as { staff_user_id?: string | null }).staff_user_id ?? null;
    if (linkedId) {
      const sync: Record<string, unknown> = {};
      if (data.contract.division) sync.department = data.contract.division;
      if (data.contract.employmentType) sync.employment_type = data.contract.employmentType;
      if (data.contract.jobTitle) sync.job_title = data.contract.jobTitle;
      if (data.personal.phone) sync.phone = data.personal.phone;
      if (data.contract.startDate) sync.hire_date = data.contract.startDate;
      // 담당 과목은 부서에서 파생(별도 입력 없음, 2026-07-29). 부서를 바꾸면 과목도 따라간다.
      // 교과가 아닌 부서(파생 0건)면 손대지 않는다 — 겸임(경영팀이면서 수업)의 수동 지정 보존.
      const derived = await subjectsForDivision(data.contract.division);
      if (derived.length > 0) sync.subjects = derived;
      if (Object.keys(sync).length > 0) {
        await createAdminClient().from("users").update(sync).eq("id", linkedId).eq("tenant_id", gate.user.tenantId);
      }
      revalidatePath(`/staff/${linkedId}`);
    }
    revalidateResume(id);
    return { ok: true, id, nonce: Date.now(), redirectTo: `/staff/resumes/${id}` };
  }

  // 기존 직원 연결 모드(?staff= 프리필) — 넘겨온 id가 **우리 테넌트 직원**인지 서버가 재검증(변조 차단, RLS 스코프).
  let linkStaffUserId: string | null = null;
  const staffUserRaw = String(formData.get("staff_user_id") ?? "").trim();
  if (staffUserRaw) {
    const { data: staffRow } = await supabase.from("users").select("id").eq("id", staffUserRaw).maybeSingle();
    if (!staffRow) return { error: "연결할 직원을 찾을 수 없습니다 — 직원목록에서 다시 열어주세요" };
    linkStaffUserId = staffRow.id;
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
      staff_user_id: linkStaffUserId,
    })
    .select("id")
    .single();
  if (error || !row) return { error: humanizeDbError(error?.message, "저장"), detail: error?.message };
  // 신규 작성만 "신규 직원명부" 구글시트에 한 행 기입(수정 저장은 재기입하지 않음 — 중복 행 방지).
  // 실패해도 이력서 저장은 유효 — 경고 토스트만(시트 공유·env 미설정 등은 운영자가 조치).
  const roster = await appendResumeToRoster(data);
  // 원샷 직원 등록(옵션) — 시트 기입과 독립인 부가 효과. 실패해도 이력서 저장은 유효.
  // 기존 직원 연결 모드에선 계정이 이미 있으므로 등록을 시도하지 않는다.
  const account =
    !linkStaffUserId && formData.get("acct_register") === "1"
      ? await registerStaffFromResume(gate.user, data, String(formData.get("acct_role") ?? ""), row.id)
      : {};
  revalidateResume(row.id);
  if (selfCreate) revalidatePath("/me");
  const notices = [
    // env 미설정(의도적 비활성)은 skipped — 토스트 없음(거짓 '실패' 경고 금지).
    roster.ok ? (roster.skipped ? null : "'신규 직원명부' 구글시트에도 기입했습니다") : null,
    account.notice ?? null,
  ].filter(Boolean);
  const warnings = [
    roster.ok ? null : `이력서는 저장됐지만 직원명부 시트 기입에 실패했습니다 — ${roster.error}`,
    account.warning ?? null,
  ].filter(Boolean);
  return {
    ok: true,
    id: row.id,
    nonce: Date.now(),
    // 본인이 쓴 이력서는 '내 정보'로 돌아간다 — 강사·뷰어는 /staff/* 자체가 차단이라 빈 화면이 된다.
    redirectTo: selfCreate ? "/me" : `/staff/resumes/${row.id}`,
    ...(notices.length ? { notice: notices.join(" · ") } : {}),
    ...(warnings.length ? { warning: warnings.join(" · ") } : {}),
  };
}

export async function deleteStaffResume(
  id: string,
): Promise<{ ok?: boolean; error?: string; detail?: string }> {
  const gate = await requireResumeAccess(id); // 잠긴 이력서는 삭제도 불가
  if ("error" in gate) return { error: gate.error, detail: gate.detail };

  const supabase = await createClient();
  const { data: deleted, error } = await supabase
    .from("academy_documents")
    .delete()
    .eq("id", id)
    .eq("form_type", RESUME_FORM_TYPE)
    .select("id, form_data"); // ⚠️ select 없으면 0행 삭제도 성공으로 보고된다. form_data = 사진 정리용.
  if (error) return { error: humanizeDbError(error.message, "삭제"), detail: error.message };
  if (!deleted?.length) return { error: "이력서를 찾을 수 없습니다 — 이미 삭제되었을 수 있습니다" };
  // 증명사진 스토리지 정리(best-effort) — 실패해도 삭제는 유효(고아 객체는 무해, 게이트 뒤라 노출 없음).
  const photos = (deleted[0]?.form_data as { photos?: unknown } | null)?.photos;
  if (Array.isArray(photos)) {
    await Promise.all(
      photos
        .map(String)
        .filter((p) => isTenantDocumentPath(p, gate.user.tenantId))
        .map((p) => removeObject(p, { bucket: MEDIA_KIND.document.supabaseBucket }).catch(() => {})),
    );
  }
  revalidateResume(id);
  return { ok: true };
}

function revalidateResume(id: string) {
  revalidatePath("/staff");
  revalidatePath(`/staff/resumes/${id}`);
  revalidatePath("/documents"); // 같은 행이 데이터베이스 탐색기에도 노출
}

// (재인증 unlockResumeView는 2026-07-28 원장 지시로 제거 — 열람은 canViewResume(원장·관리자)만.
//  과거 감사로그의 resume_view_unlock 액션 라벨은 log.ts 레지스트리에 유지.)
