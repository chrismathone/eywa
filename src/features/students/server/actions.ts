"use server";

import { seatBlockReason } from "@/lib/license/server";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { recordMathWithdrawalToSheet } from "@/features/withdrawals/server/withdrawal-sheet";
import { pushIjwProfiles } from "@/features/ijw/server/profile-push";
import { goalExamLabel, parseGoalAxis } from "@/features/grades/goals";
import { goalAxisReady } from "@/features/grades/server/goals";
import {
  clearOnHoldForActiveEnrollments,
  endEnrollmentById,
  listOpenEnrollments,
  reopenEnrollmentsClosedByWithdrawal,
} from "./enrollment-sync";
// 퇴원은 퇴원보고서로만(원장 2026-10-23) — 직접 퇴원·새 퇴원 예약·마지막 반 종료를 같은 판정으로 거절한다(#77).
import { formWithdrawalViaReport, WITHDRAWAL_VIA_REPORT } from "@/features/withdrawals/via-report";
import { lastCourseViaReport } from "@/features/withdrawals/server/via-report";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { explainDbError, logDbError } from "@/lib/supabase/db-error";
import { canonicalSchoolName, type SchoolSaveAlias } from "@/features/schools/school-name";
import { completeSchoolKind } from "@/features/schools/server/complete-kind";
import { getTenantSettings } from "@/features/owner/server/queries";
import { accessLevelTenant, canManageTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { logAction } from "@/features/audit/server/log";
import { kstToday } from "@/lib/date-kst";
import { formWithdrawalNeedsReason, planFormWithdrawal } from "../withdrawal-plan";
import { fetchAllPaged } from "@/lib/supabase/batch";
import {
  DEFAULT_WITHDRAWAL_METADATA,
  WITHDRAWAL_REASONS,
  type WithdrawalMetadata,
  type WithdrawalReason,
} from "@/features/withdrawals/types";
import { checkReasonInput, readReasonForm } from "@/features/withdrawals/reason-detail";
import { currentPeriod, isCommentCategory } from "../detail/grades-meta";
import { normalizeExamSlot } from "@/features/grades/exam-slots";
import { defaultTermOf, normalizeTerm, normalizeYear, termWindow } from "@/features/grades/term";
// 성적 칸 저장은 **단일 경로**다 — 성적관리 격자·엑셀·이 폼이 같은 함수를 지난다(칸 키를 여러 곳이 알지 않게).
import { gradesSchemaReady, writeGradeCells } from "@/features/grades/server/write";
// 생성 = 공용 진입점(전 경로 공유) / 수정 = 자기 자신을 taken에서 빼야 해서 순수 함수 직접 호출.
import { resolveUniqueStudentName } from "../name-suffix";
import { preserveMergeNote } from "../status/merged";
import { resolveUniqueStudentNameFor } from "./unique-name";
import { canViewStudentDetail } from "./read-scope";
import { canManageStudentStatusNow } from "./status-access";
import { saveStudentSiblings } from "./siblings";
import { statusCreationNeedsPermission, STUDENT_STATUS_DENIED } from "../status-access";
import { GUARDIAN2_NAME_MAX, isGuardianRelation } from "../guardian";

export type StudentFormState =
  | {
      error?: string;
      fieldErrors?: Record<string, string>;
      ok?: true;
      redirectTo?: string;
      nonce?: number;
      notice?: string; // 이름 중복으로 접미사(A·B·C)가 강제 부여됐을 때 안내.
    }
  | undefined;

const STATUSES = ["prospect", "consulted", "enrolled", "on_hold", "withdrawn"] as const;
type StudentStatus = (typeof STATUSES)[number];

/**
 * 한국 전화번호 정규화 (F5). 숫자만 추출 후 휴대폰/지역번호 규칙으로 하이픈 삽입,
 * 앞자리 0 누락(예: "1000009106")도 보정. 인식 못 하는 길이는 원본 유지(과도한 변형 방지).
 */
function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10 && d.startsWith("10")) d = "0" + d; // 1000009106 → 01000009106
  if (d.length === 11 && d.startsWith("010")) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10 && d.startsWith("02")) return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 9 && d.startsWith("02")) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  return raw;
}

function readForm(formData: FormData, schoolAliases: readonly SchoolSaveAlias[]) {
  const get = (k: string) => {
    const v = formData.get(k);
    return v == null ? "" : String(v).trim();
  };
  const status = get("status");
  const gender = get("gender");
  return {
    name: get("name"),
    englishName: get("englishName") || null,
    classnoteName: get("classnoteName") || null,
    grade: get("grade") || null,
    // 저장 표기 강제(원장 2026-09-01) — 학생 자연키가 학교를 쓰므로 표기가 갈리면 중복도 갈린다.
    school: canonicalSchoolName(get("school"), schoolAliases),
    studentCode: get("studentCode") || null,
    attendanceCode: get("attendanceCode") || null,
    gender: gender === "male" || gender === "female" ? gender : null,
    birthDate: get("birthDate") || null,
    nickname: get("nickname") || null,
    graduationYear: get("graduationYear") || null,
    address: get("address") || null,
    zipCode: get("zipCode") || null,
    addressDetail: get("addressDetail") || null,
    email: get("email") || null,
    studentPhone: normalizePhone(get("studentPhone") || null),
    homePhone: normalizePhone(get("homePhone") || null),
    otherPhone: normalizePhone(get("otherPhone") || null),
    parentName: get("parentName") || null,
    parentPhone: normalizePhone(get("parentPhone") || null),
    parentRelation: get("parentRelation") || null,
    // 보호자2(s2_0024) — 정규화·검증은 보호자1 연락처와 같다.
    parent2Name: get("parent2Name") || null,
    parent2Phone: normalizePhone(get("parent2Phone") || null),
    parent2Relation: get("parent2Relation") || null,
    status: (STATUSES.includes(status as StudentStatus) ? status : "prospect") as StudentStatus,
    enrolledAt: get("enrolledAt") || null,
    withdrawnAt: get("withdrawnAt") || null,
    notes: get("notes") || null,
  };
}

function validate(input: ReturnType<typeof readForm>): Record<string, string> | null {
  const errors: Record<string, string> = {};
  if (!input.name) errors.name = "이름은 필수입니다";
  if (input.parentPhone && !/^[\d\s\-+()]{8,}$/.test(input.parentPhone)) {
    errors.parentPhone = "연락처 형식을 확인해주세요";
  }
  if (input.parent2Phone && !/^[\d\s\-+()]{8,}$/.test(input.parent2Phone)) {
    errors.parent2Phone = "연락처 형식을 확인해주세요";
  }
  // 보호자2만 — 관계는 화면 목록(보호자1과 같은 한 벌) 밖의 값을 받지 않고, 이름은 길이 상한(보호자1의 종전 동작은 그대로).
  if (input.parent2Name && input.parent2Name.length > GUARDIAN2_NAME_MAX) {
    errors.parent2Name = `보호자2 이름은 ${GUARDIAN2_NAME_MAX}자까지 적을 수 있습니다`;
  }
  if (input.parent2Relation && !isGuardianRelation(input.parent2Relation)) {
    errors.parent2Relation = "보호자2 관계는 목록에서 골라 주세요";
  }
  if (input.status === "withdrawn" && !input.withdrawnAt) {
    errors.withdrawnAt = "퇴원일을 입력해주세요";
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

/**
 * 학생 저장의 DB 오류 → 이유 + 그 칸 표시([[#138]]). 🔴 23505를 한 문장으로 뭉치지 말 것 — 예전 `translateDbError`는
 * 모든 중복을 "이름·학교·학년 중복"으로 말해 **출결번호 중복**도 이름 칸을 고치게 만들었다. 제약 이름으로 가른다.
 */
function studentSaveError(error: unknown, scope: string, fallback: string): StudentFormState {
  const why = explainDbError(error, { scope, fallback });
  return why.field ? { error: why.message, fieldErrors: { [why.field]: why.message } } : { error: why.message };
}

/** DB 오류 → 화면용 한글 이유 + 로그(scope로 Vercel 로그 검색). 모르는 오류면 fallback 그대로. */
function dbWhy(error: unknown, scope: string, fallback: string, op?: "write" | "delete"): string {
  return explainDbError(error, { scope, fallback, op }).message;
}

/**
 * 학생 기록 변경(등록·수정·상태 전환) 게이트 = students **full**만 (master·admin·manager·counselor).
 * 🔴 `canWriteTenant`는 scoped(강사)도 통과한다 — 2026-08-18 원장 지시("강사들은 퇴원처리 막아,
 * 수정도 안되게, AI 케어도 — 읽기만 해") 이후 강사는 학생 상세 **열람 전용**이다. 배경: 실제 등원 중인
 * 학생 7명이 7월 날짜로 소급 퇴원 처리되는 사고 + 감사로그 부재로 행위자 역추적 불가.
 * UI(학생 상세 헤더 버튼·edit 라우트)와 이 서버 게이트가 한 쌍이다(#77 — 화면 숨김은 게이트가 아니다).
 */
async function canManageStudentRecords(role: Parameters<typeof canManageTenant>[0]): Promise<boolean> {
  // canManageTenant(=full 판정) 위임 — 같은 의미를 두 벌 구현하면 다음 조정 때 한쪽만 고친다(적대 리뷰 F8).
  return canManageTenant(role, "students");
}

const STUDENT_MANAGE_DENIED = "학생 정보 변경 권한이 없습니다 — 강사 계정은 열람 전용입니다";

/** 폼에서 읽은 사유 → 새 퇴원 메타데이터(상담 기록은 빈 채로 시작 — 상태 전환 창과 같은 모양). */
function freshWithdrawalMetadata(r: { reason: WithdrawalReason; detail: string | null; memo: string | null }): WithdrawalMetadata {
  return {
    reason: r.reason,
    ...(r.detail ? { detail: r.detail } : {}),
    memo: r.memo,
    consultation: { adminCalledParent: false, teacherCalledParent: false, talkedWithStudent: false },
  };
}

export async function createStudent(
  _prev: StudentFormState,
  formData: FormData,
): Promise<StudentFormState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canManageStudentRecords(user.systemRole))) return { error: STUDENT_MANAGE_DENIED };

  const input = readForm(formData, (await getTenantSettings()).operations.schoolSaveAliases);
  const fieldErrors = validate(input);
  if (fieldErrors) return { fieldErrors };
  // 퇴원일 칸 — 미래면 퇴원 예약(상태 그대로), 재원·휴원에 지난 날짜는 거절(수정 폼과 같은 `planFormWithdrawal`).
  if (statusCreationNeedsPermission(input.status, input.withdrawnAt) && !(await canManageStudentStatusNow())) {
    return { error: STUDENT_STATUS_DENIED };
  }
  const createPlan = planFormWithdrawal({ prevStatus: null, status: input.status, withdrawnAt: input.withdrawnAt, today: kstToday() });
  if (createPlan.error) return { fieldErrors: { withdrawnAt: createPlan.error } };
  // 새 원생에 퇴원 예약은 걸지 않는다(퇴원보고서로 — 원장 2026-10-23). 지난 날짜의 퇴원 상태로 등록하는 것(옛 기록)은 그대로.
  const createViaReport = formWithdrawalViaReport({ prevStatus: null, kind: createPlan.kind, withdrawnAt: createPlan.withdrawnAt });
  if (createViaReport) return { fieldErrors: { withdrawnAt: createViaReport } };
  // 퇴원(또는 퇴원 예약)으로 등록하면 사유를 받는다 — 상태 전환 창과 같은 칸·같은 검사(원장 2026-10-15 *"기타는 모든 곳을
  // 일치하게"*). 예전엔 사유 칸 없이 '기타'를 박았다.
  let createMeta: WithdrawalMetadata | null = null;
  if (formWithdrawalNeedsReason({ prevStatus: null, kind: createPlan.kind })) {
    const picked = readReasonForm(formData);
    if (picked.error !== undefined) return { error: picked.error };
    createMeta = freshWithdrawalMetadata(picked);
  }
  if (createPlan.status === "enrolled") {
    // 재원생 좌석 한도(슈퍼관리자 라이선스) — 한도가 없는 지점은 조회 한 번으로 통과.
    const seat = await seatBlockReason(user.tenantId, 1);
    if (seat) return { error: seat };
  }

  const supabase = await createClient();
  // 급이 빠진 학교(`칠성`)는 학년으로 급을 채운다 — 학교알리미에 있는 학교만(2026-10-20 김지유 건).
  input.school = await completeSchoolKind(
    supabase,
    user.tenantId,
    input.school,
    input.grade,
    (await getTenantSettings()).operations.schoolSaveAliases,
  );

  // 이름 중복 방지 — 같은 이름이 이미 있으면 다음 빈 알파벳 접미사(A·B·C…) 강제(ijw/makeedu 규약).
  // 판정은 공용 진입점 하나로(상담 전환·엑셀 가져오기도 같은 함수) — 한 경로만 지키면 소용없다.
  const resolvedName = await resolveUniqueStudentNameFor(supabase, user.tenantId, input.name);

  const { data, error } = await supabase
    .from("students")
    .insert({
      tenant_id: user.tenantId,
      name: resolvedName.name,
      english_name: input.englishName,
      classnote_name: input.classnoteName,
      grade: input.grade,
      school: input.school,
      student_code: input.studentCode,
      attendance_code: input.attendanceCode,
      gender: input.gender,
      birth_date: input.birthDate,
      nickname: input.nickname,
      graduation_year: input.graduationYear,
      address: input.address,
      zip_code: input.zipCode,
      address_detail: input.addressDetail,
      email: input.email,
      student_phone: input.studentPhone,
      home_phone: input.homePhone,
      other_phone: input.otherPhone,
      parent_name: input.parentName,
      parent_phone: input.parentPhone,
      parent_relation: input.parentRelation,
      parent2_name: input.parent2Name,
      parent2_phone: input.parent2Phone,
      parent2_relation: input.parent2Relation,
      status: createPlan.status,
      enrolled_at: input.enrolledAt,
      withdrawn_at: createPlan.withdrawnAt,
      withdrawal_metadata: createMeta,
      notes: input.notes,
    })
    .select("id")
    .single();

  if (error || !data) {
    return studentSaveError(error, "students.create", "학생을 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }

  await logAction({
    action: "student_create",
    targetType: "student",
    targetLabel: resolvedName.name,
    metadata: { studentId: data.id, ...(createMeta ? { reason: createMeta.reason, detail: createMeta.detail ?? null } : {}) },
  });

  revalidatePath("/students");
  // redirect 대신 결과 반환 — 클라가 성공 확정(nonce) 후 초안 삭제·동시편집 신호·이동(B-2).
  // (redirect()면 NEXT_REDIRECT throw로 폼의 nonce 효과가 안 돌아 'student:new' 초안이 안 비워진다.)
  return {
    ok: true,
    redirectTo: `/students/${data.id}`,
    nonce: Date.now(),
    notice: resolvedName.suffixed
      ? `이미 '${input.name}' 학생이 있어 '${resolvedName.name}'(으)로 등록했습니다.`
      : undefined,
  };
}

export type DeleteStudentState = { error?: string; ok?: true } | undefined;

/**
 * 학생 영구 삭제(단건) — 잘못 추가한 학생 즉시 정정용. 대부분 FK는 cascade지만 invoices는 restrict라
 * 청구(수납) 기록이 있으면 삭제 불가(퇴원 처리 권장). 파괴적이라 관리 도구(admin) 쓰기 권한으로 조임
 * (기본 master, 역할·권한에서 위임 시 admin/manager). 되돌릴 수 없음 → UI에서 2단계 확인.
 */
export async function deleteStudent(_prev: DeleteStudentState, formData: FormData): Promise<DeleteStudentState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "admin"))) return { error: "영구 삭제 권한이 없습니다(관리 도구 권한 필요)" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "학생 ID가 누락되었습니다" };

  const supabase = await createClient();
  // 감사 기록용 이름 선조회 — 삭제 뒤엔 uuid로 이름을 되찾을 수 없다(describe.ts student_delete 참조).
  const { data: target } = await supabase.from("students").select("name").eq("id", id).maybeSingle();
  // 청구(invoices) 기록 있으면 FK restrict라 삭제 실패 → 미리 막고 퇴원 처리 안내(count head:true = 행 안 받음, B2).
  const { count } = await supabase
    .from("invoices")
    .select("*", { count: "exact", head: true })
    .eq("student_id", id);
  if ((count ?? 0) > 0) {
    return { error: "청구(수납) 기록이 있어 영구 삭제할 수 없습니다. 그만둔 학생이면 '퇴원보고서'로 퇴원을 처리해 주세요." };
  }

  const { error, count: deleted } = await supabase.from("students").delete({ count: "exact" }).eq("id", id);
  if (error) return { error: dbWhy(error, "students.delete", "학생을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.", "delete") };
  if (!deleted) return { error: "학생을 찾을 수 없거나 권한이 없습니다" };

  await logAction({
    action: "student_delete",
    targetType: "student",
    targetLabel: target?.name ?? null,
    metadata: { studentId: id, studentName: target?.name ?? null },
  });

  revalidatePath("/students");
  revalidatePath("/withdrawals");
  return { ok: true };
}

export async function updateStudent(
  _prev: StudentFormState,
  formData: FormData,
): Promise<StudentFormState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canManageStudentRecords(user.systemRole))) return { error: STUDENT_MANAGE_DENIED };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "학생 ID가 누락되었습니다" };

  const input = readForm(formData, (await getTenantSettings()).operations.schoolSaveAliases);
  const fieldErrors = validate(input);
  if (fieldErrors) return { fieldErrors };

  const supabase = await createClient();
  // 급이 빠진 학교(`칠성`)는 학년으로 급을 채운다 — 학교알리미에 있는 학교만(2026-10-20 김지유 건).
  input.school = await completeSchoolKind(
    supabase,
    user.tenantId,
    input.school,
    input.grade,
    (await getTenantSettings()).operations.schoolSaveAliases,
  );

  // status 전환 시 withdrawal_metadata 처리 — 새로 퇴원으로 가면 기본 메타 채움,
  // 다시 재원으로 돌리면 null로 비움. 이미 퇴원 상태였으면 손대지 않음.
  const { data: cur } = await supabase
    .from("students")
    // `notes`는 병합 표식(`중복 병합: …`)을 지켜내려고 함께 읽는다 — 아래 preserveMergeNote 주석 참조.
    .select("status, withdrawal_metadata, withdrawn_at, name, notes")
    .eq("id", id)
    .single();
  if (!cur) return { error: "학생을 찾을 수 없습니다" };
  // A basic edit omits these fields. Old forms may send unchanged values, but cannot change them.
  if (!formData.has("status")) input.status = cur.status as StudentStatus;
  if (!formData.has("withdrawnAt")) input.withdrawnAt = cur.withdrawn_at ? String(cur.withdrawn_at).slice(0, 10) : null;
  const statusAccess = await canManageStudentStatusNow();
  if (!statusAccess && (input.status !== cur.status || input.withdrawnAt !== (cur.withdrawn_at ? String(cur.withdrawn_at).slice(0, 10) : null))) {
    return { error: STUDENT_STATUS_DENIED };
  }
  const prevStatus = cur?.status as string | undefined;
  if (input.status === "enrolled" && prevStatus !== "enrolled") {
    const seat = await seatBlockReason(user.tenantId, 1, [id]);
    if (seat) return { error: seat };
  }

  // 🔴 퇴원 예약(원장 2026-09-28 *"퇴원이 미래인학생은 퇴원당일전까지 '재원'"*) — 상태 변경 창과 **같은 규칙**:
  //    퇴원일이 미래면 상태·수강은 그대로 두고 날짜·사유만 적는다(그날 cron이 퇴원 처리). 표식 = 퇴원이 아닌데 withdrawn_at 있음.
  //    이 폼은 **퇴원일 칸이 예약을 정한다**(폼이 칸을 늘 보여 주고 예약일을 채워 둔다):
  //      · 재원·휴원으로 저장 + 미래 날짜 = 그 날짜로 예약(새로 걸거나 날짜를 바꾼다) · 빈칸 = 예약 취소
  //      · 재원·휴원으로 저장 + 오늘 이전 날짜 = 거절(이미 그만뒀다면 상태를 '퇴원'으로)
  //      · 퇴원에서 되돌리는 저장(복구) = 종전대로 비운다
  //    예전 식(`퇴원 아니면 withdrawn_at = null`)이면 이름 한 글자 고치는 저장이 예약을 조용히 지웠다.
  const today = kstToday();
  const scheduledPrev = prevStatus !== "withdrawn" && !!cur?.withdrawn_at;
  const withdrawalPlan = statusAccess ? planFormWithdrawal({
    prevStatus: prevStatus ?? null,
    prevWithdrawnAt: (cur?.withdrawn_at as string | null) ?? null,
    status: input.status,
    withdrawnAt: input.withdrawnAt,
    today,
  }) : { status: cur.status as StudentStatus, withdrawnAt: cur.withdrawn_at ? String(cur.withdrawn_at).slice(0, 10) : null,
    kind: scheduledPrev ? "schedule" as const : cur.status === "withdrawn" ? "withdraw" as const : "none" as const, error: undefined };
  if (withdrawalPlan.error) return { fieldErrors: { withdrawnAt: withdrawalPlan.error } };
  // 🔴 퇴원은 퇴원보고서로만(원장 2026-10-23 *"퇴원 보고서를 써야 퇴원처리가 가능하도록"*) — 이 폼으로는 새로 퇴원시키거나(예약을
  //    오늘로 당기는 것 포함) 새 예약을 걸거나 예약 날짜를 바꾸지 못한다. 이미 퇴원한 학생 고치기 · 걸린 예약 그대로 저장 · 예약 취소는 그대로.
  //    그래서 아래에는 '새 퇴원'·'새 예약'의 사유 받기·수강 닫기 갈래가 없다(예전 갈래는 이 판정 뒤로 닿지 않아 걷었다).
  const viaReport = formWithdrawalViaReport({
    prevStatus: prevStatus ?? null,
    prevWithdrawnAt: (cur?.withdrawn_at as string | null) ?? null,
    kind: withdrawalPlan.kind,
    withdrawnAt: withdrawalPlan.withdrawnAt,
  });
  if (viaReport) return { error: viaReport };
  const schedulingNow = statusAccess && withdrawalPlan.kind === "schedule";
  const savedStatus = withdrawalPlan.status;

  let withdrawalMetadata: unknown = cur?.withdrawal_metadata ?? null;
  if (schedulingNow) {
    // 걸려 있던 예약을 그대로 다시 저장 — 예약 때 고른 사유를 살린다(사유가 비어 있던 옛 예약만 기본값).
    withdrawalMetadata = cur?.withdrawal_metadata ?? DEFAULT_WITHDRAWAL_METADATA;
  } else if (statusAccess && withdrawalPlan.kind === "none") {
    withdrawalMetadata = null;
  }
  const savedWithdrawnAt = withdrawalPlan.withdrawnAt;
  const cancelledSchedule = statusAccess && scheduledPrev && withdrawalPlan.kind === "none" ? String(cur?.withdrawn_at).slice(0, 10) : null;

  // 이름을 새 값으로 바꾼 경우만 중복 검사 — 기존(=현재) 이름 유지 저장은 제외(원장 지시). 자기 자신(id)은 taken에서 빼서
  // 자기 이름과 충돌로 오인되지 않게. 신규 이름이 다른 학생과 겹치면 접미사(A·B·C…) 강제.
  const currentName = ((cur?.name as string | null) ?? "").trim();
  let finalName = input.name;
  let renamed = false;
  if (input.name.trim() !== currentName) {
    const existingNames = await fetchAllPaged<{ id: string; name: string | null }>((from, to) =>
      supabase.from("students").select("id, name").eq("tenant_id", user.tenantId).range(from, to),
    );
    const taken = new Set(
      existingNames.filter((r) => r.id !== id).map((r) => (r.name ?? "").trim()).filter(Boolean),
    );
    const resolved = resolveUniqueStudentName(input.name, taken);
    finalName = resolved.name;
    renamed = resolved.suffixed;
  }

  let update = supabase
    .from("students")
    .update({
      name: finalName,
      english_name: input.englishName,
      classnote_name: input.classnoteName,
      grade: input.grade,
      school: input.school,
      student_code: input.studentCode,
      attendance_code: input.attendanceCode,
      gender: input.gender,
      birth_date: input.birthDate,
      nickname: input.nickname,
      graduation_year: input.graduationYear,
      address: input.address,
      zip_code: input.zipCode,
      address_detail: input.addressDetail,
      email: input.email,
      student_phone: input.studentPhone,
      home_phone: input.homePhone,
      other_phone: input.otherPhone,
      parent_name: input.parentName,
      parent_phone: input.parentPhone,
      parent_relation: input.parentRelation,
      // 보호자2 칸(s2_0024)은 그 칸이 있던 화면에서만 건드린다 — 칸 없이 들어온 저장(배포 사이 열려 있던 옛 화면)이 보호자2를 지우지 않게.
      ...(formData.has("parent2Phone")
        ? { parent2_name: input.parent2Name, parent2_phone: input.parent2Phone, parent2_relation: input.parent2Relation }
        : {}),
      ...(statusAccess ? { status: savedStatus, withdrawn_at: savedWithdrawnAt, withdrawal_metadata: withdrawalMetadata } : {}),
      enrolled_at: input.enrolledAt,
      // 🔴 병합 표식은 사람이 지울 수 없다 — 이 칸('학생 정보 수정용 특이사항')이 곧 `students.notes`라, 표식이
      //    사람 메모와 **같은 칸**에 들어 있다. 그냥 저장하면 표식이 날아가고 그 학생이 집계에서
      //    **퇴원으로 조용히 되살아난다**(에러도 경고도 없다). 병합된 학생이 아니면 입력값 그대로다.
      //    ⚠️ 단 **퇴원에서 되돌리는 저장이면 놓아 준다** — 잘못 병합한 건을 푸는 유일한 손잡이다.
      notes: preserveMergeNote(
        cur?.notes as string | null,
        input.notes,
        input.status === "withdrawn",
      ),
    })
    .eq("id", id).eq("status", cur.status);
  update = cur.withdrawn_at === null ? update.is("withdrawn_at", null) : update.eq("withdrawn_at", cur.withdrawn_at);
  const { data: changed, error } = await update.select("id").maybeSingle();

  if (error) return studentSaveError(error, "students.update", "학생 정보를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  if (!changed) return { error: "원생 상태가 변경되었습니다. 새로고침한 뒤 다시 저장해 주세요." };
  // 인재원 짝이 있는 학생이면 학교·학년·생일을 인재원에 보낸다(원장 2026-10-08) — 응답 뒤에, 짝이 없으면 아무것도 안 한다.
  {
    const ijwTenant = user.tenantId;
    after(() => pushIjwProfiles(ijwTenant, { studentIds: [id] }));
  }

  // 상태 전환에 맞춰 활성 enrollment 정합성 유지 (changeStudentStatus와 동일 불변식) — 복구/재원 시 on_hold 해제.
  // (새 퇴원은 위 퇴원보고서 판정이 막는다 — 수강을 닫는 것은 퇴원보고서의 처리 함수 몫이다.)
  if (savedStatus === "enrolled" && prevStatus !== "enrolled") {
    // 퇴원이 닫은 enrollment(end_date=퇴원일)를 다시 연다 — 안 하면 재원인데 시간표 '퇴원'에 남음.
    // 🔴 퇴원에서 돌아올 때만 — 휴원·예비의 withdrawn_at은 **퇴원 예약**이라 그 날짜로 끝나는 다른 수강을 잘못 연다.
    const withdrawnDate = prevStatus === "withdrawn" && cur?.withdrawn_at ? String(cur.withdrawn_at).slice(0, 10) : null;
    const reopenErr = await reopenEnrollmentsClosedByWithdrawal(supabase, id, withdrawnDate);
    if (reopenErr) return { error: reopenErr };
    const holdErr = await clearOnHoldForActiveEnrollments(supabase, id);
    if (holdErr) return { error: holdErr };
  } else if (savedStatus === "on_hold" && prevStatus !== "on_hold") {
    const { error: enrErr } = await supabase
      .from("enrollments")
      .update({ on_hold: true })
      .eq("student_id", id)
      .is("end_date", null);
    if (enrErr) return { error: dbWhy(enrErr, "students.update.holdEnrollments", "수강을 휴원으로 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.") };
  }

  // 형제 칸(0376a) — 칸이 있던 화면에서만 건드린다(옛 화면·다른 경로의 저장은 형제를 그대로 둔다).
  let siblingNotice: string | null = null;
  if (formData.has("siblingsField")) {
    const ids = (key: string): string[] => {
      try {
        const v: unknown = JSON.parse(String(formData.get(key) ?? "[]"));
        return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)).map((x) => x.toLowerCase()) : [];
      } catch {
        return [];
      }
    };
    // 🔴 실패해도 여기서 돌아가지 않는다 — 학생 정보는 이미 저장됐다(감사로그·갱신을 건너뛰면 안 되고, 폼은 제출 뒤 열 때 값으로
    //    리셋돼 '다시 저장'하면 방금 바꾼 정보가 되돌아간다 #83). 저장은 끝내고 형제만 못 했다고 알린다.
    try {
      const sib = await saveStudentSiblings(supabase, {
        tenantId: user.tenantId, userId: user.id, studentId: id,
        final: ids("siblings"), initial: ids("siblingsInitial"), suggested: ids("siblingsSuggested"),
      });
      if (sib.added.length + sib.excluded.length + sib.removed.length > 0) {
        await logAction({
          action: "student_siblings_update",
          targetType: "student",
          targetLabel: finalName,
          metadata: { studentId: id, added: sib.added, excluded: sib.excluded, removed: sib.removed },
        });
      }
    } catch (e) {
      logDbError(e, "students.update.siblings", { studentId: id });
      siblingNotice = "원생 정보는 저장했습니다. 형제는 저장하지 못했습니다 — 학생 수정 화면에서 다시 지정해 주세요.";
    }
  }

  await logAction({
    action: "student_update",
    targetType: "student",
    targetLabel: finalName,
    metadata: {
      studentId: id,
      statusFrom: prevStatus ?? null,
      statusTo: savedStatus,
      // 예약을 새로 걸거나 날짜를 바꾸는 저장은 위에서 막힌다 — 남는 사건은 예약 취소뿐이다.
      ...(cancelledSchedule ? { cancelledWithdrawal: cancelledSchedule } : {}),
    },
  });

  revalidatePath(`/students/${id}`);
  revalidatePath("/students");
  // redirect 대신 결과 반환 — 클라가 성공 확정 후 동시편집 신호(publish) → 이동(B-2). nonce로 연속 저장 구분.
  return {
    ok: true,
    redirectTo: `/students/${id}`,
    nonce: Date.now(),
    notice: [renamed ? `이미 '${input.name}' 학생이 있어 '${finalName}'(으)로 저장했습니다.` : null, siblingNotice]
      .filter(Boolean).join("\n") || undefined,
  };
}


// ────────────────────── 상태 전환 모달 (퇴원/휴원/수강종료/복구) ──────────────────────


// ⚠️ `ok`는 다이얼로그가 **성공을 감지**하는 유일한 신호다 — 종전엔 성공 시 undefined를 돌려
// useActionState state가 초깃값 그대로였고, StatusDialog의 `if (state && !state.error)` 닫기 effect가
// 영영 발화하지 않아 퇴원을 눌러도 모달이 그대로 남았다(뒤 화면만 조용히 갱신).
export type ChangeStatusState = { error?: string; ok?: true } | undefined;

/**
 * 학생 상태 전환 (휴원/복구). 학생 상세에서 호출.
 * - on_hold: 학생 status='on_hold' + 활성 enrollment에 on_hold=true
 * - enrolled (복구): 학생 status='enrolled' + withdrawn_at/metadata null + on_hold 해제
 * - withdrawn: 🔴 **거절** — 퇴원은 퇴원보고서로만(원장 2026-10-23 *"퇴원 보고서를 써야 퇴원처리가 가능하도록"*). 퇴원(오늘·지난 날짜)도
 *   퇴원 예약(미래 날짜)도 퇴원보고서의 처리 함수가 한다(강사 작성 요청 → 승인, 또는 관리자 바로 처리 — `withdrawal-reports`).
 *   예전 갈래(상태를 퇴원으로 + 수강 닫기 / 미래 날짜면 예약만)는 걷었다 — 되살리지 말 것(가드 `via-report-wiring.test.ts`).
 */
export async function changeStudentStatus(
  _prev: ChangeStatusState,
  formData: FormData,
): Promise<ChangeStatusState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  // 🔴 휴원·복구 = full만(강사 차단, 원장 지시 2026-08-18) — canManageStudentRecords 주석 참조.
  if (!(await canManageStudentStatusNow())) return { error: STUDENT_STATUS_DENIED };

  const id = String(formData.get("id") ?? "").trim();
  const target = String(formData.get("target") ?? "").trim();
  const memo = String(formData.get("memo") ?? "").trim() || null;

  if (!id) return { error: "학생 ID가 누락되었습니다" };
  if (!["withdrawn", "on_hold", "enrolled"].includes(target)) {
    return { error: "유효하지 않은 상태 전환입니다" };
  }
  // 옛 화면·직접 호출이 보내도 같은 문구로 거절한다(화면에서 버튼을 걷은 것은 게이트가 아니다 — #77).
  if (target === "withdrawn") return { error: WITHDRAWAL_VIA_REPORT };
  if (target === "enrolled") {
    // 복구(퇴원·휴원 → 재원)도 자리를 하나 차지한다 — 이미 재원이면 본인을 빼고 세서 0이 된다.
    const seat = await seatBlockReason(user.tenantId, 1, [id]);
    if (seat) return { error: seat };
  }

  const supabase = await createClient();

  // 휴원/복구는 전부 감사로그에 actor를 남긴다 — "누가 상태를 바꿨는지 역검수 불가" 사고(2026-08-18) 재발 방지.
  // 🔴 로그는 students.update **성공 직후**에 남긴다 — 뒤의 enrollment 정합 단계가 실패해도 상태는 이미
  //    바뀌었으므로, 끝에서 몰아 남기면 "상태는 바뀌었는데 기록이 없는" 무기록 창이 생긴다(적대 리뷰 F6).
  const writeStatusLog = () =>
    logAction({
      action: target === "on_hold" ? "student_hold" : "student_restore",
      targetType: "student",
      metadata:
        // 🔴 휴원 메모는 담을 컬럼이 없어 종전엔 폼에서 받고 **버려졌다**(거짓 약속).
        //    students엔 휴원용 칸이 없으니 감사로그가 유일한 자리다 — 적었으면 남는다.
        target === "on_hold" ? { studentId: id, memo } : { studentId: id },
    });

  if (target === "on_hold") {
    const { error: stuErr } = await supabase
      .from("students")
      .update({ status: "on_hold" })
      .eq("id", id);
    if (stuErr) return { error: dbWhy(stuErr, "students.status.hold", "휴원 처리를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.") };
    await writeStatusLog();

    const { error: enrErr } = await supabase
      .from("enrollments")
      .update({ on_hold: true })
      .eq("student_id", id)
      .is("end_date", null);
    if (enrErr) return { error: dbWhy(enrErr, "students.status.hold.enrollments", "수강을 휴원으로 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.") };
  } else if (target === "enrolled") {
    // 복구 전에 이 학생의 퇴원일(withdrawn_at)을 먼저 읽는다 — 그 날짜로 닫힌 enrollment가 이번 퇴원이 종료시킨 것.
    const { data: before } = await supabase
      .from("students")
      .select("status, withdrawn_at")
      .eq("id", id)
      .single();
    // 🔴 퇴원이 아니던 학생(휴원 → 재원)의 withdrawn_at은 **퇴원 예약**이다 — 지우지 않고, 그 날짜로 수강을 다시 열지도 않는다
    //    (예약은 수강을 닫지 않았다 · 그 날짜로 끝나는 다른 수강을 잘못 연다). 예약 취소는 '퇴원 예약 취소'로만.
    const wasWithdrawn = before?.status === "withdrawn";
    const withdrawnDate = wasWithdrawn && before?.withdrawn_at ? String(before.withdrawn_at).slice(0, 10) : null;

    // 복구: status=enrolled (+ 퇴원에서 돌아올 때만 withdrawn_at·metadata 비움), on_hold=false
    const { error: stuErr } = await supabase
      .from("students")
      .update(
        wasWithdrawn
          ? { status: "enrolled", withdrawn_at: null, withdrawal_metadata: null }
          : { status: "enrolled" },
      )
      .eq("id", id);
    if (stuErr) return { error: dbWhy(stuErr, "students.status.restore", "재원 복구를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.") };
    await writeStatusLog();

    // ⚠️ 퇴원이 닫은 enrollment(end_date=퇴원일)를 다시 연다 — 안 하면 재원인데 수강이 종료로 남아 시간표 '퇴원'에 뜬다.
    const reopenErr = await reopenEnrollmentsClosedByWithdrawal(supabase, id, withdrawnDate);
    if (reopenErr) return { error: reopenErr };

    // 나머지 이미 열려있던 enrollment의 on_hold 해제.
    const { error: enrErr } = await supabase
      .from("enrollments")
      .update({ on_hold: false })
      .eq("student_id", id)
      .is("end_date", null);
    if (enrErr) return { error: dbWhy(enrErr, "students.status.restore.enrollments", "수강을 다시 열지 못했습니다. 잠시 후 다시 시도해 주세요.") };
  }

  revalidatePath(`/students/${id}`);
  revalidatePath("/students");
  revalidatePath("/withdrawals");
  return { ok: true };
}

/**
 * **퇴원 예약 취소** — 미래 퇴원일로 저장해 둔 예약(상태는 재원·휴원, `withdrawn_at`만 있음)을 지운다.
 * 원장 2026-09-28 *"퇴원이 미래인학생은 퇴원당일전까지 '재원'"* — 예전엔 상태 변경 창의 퇴원(미래 날짜)으로 걸었고, 여기서만 푼다.
 * 2026-10-23부터 새 예약은 걸 수 없다(퇴원은 퇴원보고서로만 — 미래 날짜 퇴원은 보고서가 그날 처리한다). 이미 걸린 예약을 푸는 문은 남긴다.
 * 🔴 이미 퇴원 처리된 학생(status='withdrawn')은 대상이 아니다 — 그건 '재원으로 복구'(수강 재개까지 함께)다.
 */
export async function cancelScheduledWithdrawal(
  _prev: ChangeStatusState,
  formData: FormData,
): Promise<ChangeStatusState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canManageStudentStatusNow())) return { error: STUDENT_STATUS_DENIED };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "학생 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { data: cur } = await supabase.from("students").select("withdrawn_at").eq("id", id).maybeSingle();
  const { data, error } = await supabase
    .from("students")
    .update({ withdrawn_at: null, withdrawal_metadata: null })
    .eq("id", id)
    .neq("status", "withdrawn")
    .not("withdrawn_at", "is", null)
    .select("id, name");
  if (error) return { error: dbWhy(error, "students.cancelScheduledWithdrawal", "퇴원 예약을 취소하지 못했습니다. 잠시 후 다시 시도해 주세요.") };
  if (!data || data.length === 0) return { error: "취소할 퇴원 예약이 없습니다. 화면을 새로고침해 주세요." };
  const before = cur?.withdrawn_at ? String(cur.withdrawn_at).slice(0, 10) : null;
  await logAction({
    action: "student_restore",
    targetType: "student",
    targetLabel: (data[0]?.name as string | null) ?? null,
    metadata: { studentId: id, cancelledWithdrawal: before },
  });
  revalidatePath(`/students/${id}`);
  revalidatePath("/students");
  revalidatePath("/withdrawals");
  return { ok: true };
}

/**
 * 퇴원 다이얼로그의 **부분 종료** — 고른 수강만 닫고 **학생은 재원으로 남긴다.**
 *
 * 원장 2026-08-20: *"한과목 퇴원인데 두과목 퇴원처리되서 말싸움"* — 종전엔 퇴원 다이얼로그가 활성 수강을
 * 전부 닫는 길 하나뿐이었고, 정식 경로(단일 수강 종료)는 실데이터에서 5건만 쓰이고 있었다.
 *
 * 🔴 종료 자체는 단일 수강 종료와 **같은 원시함수**(endEnrollmentById)를 돈다 — 새 종료 로직을 또 짜면
 *    한쪽만 고쳐진다(#77). 감사로그도 같은 키(`enrollment_end`)라 기존 뷰어·이름 검색이 그대로 먹는다.
 * 🔴 학생 상태(students.status)는 **건드리지 않는다** — 퇴원이 아니므로 퇴원관리 목록
 *    (getWithdrawnStudents는 status='withdrawn'만)에 뜨지 않는다. 과목을 통째로 끊었다면
 *    퇴원관리 '수강종료'(getSubjectEndedStudents) 쪽에 잡힌다 — 그게 이 동작의 올바른 자리다.
 */
export async function endStudentEnrollments(
  _prev: ChangeStatusState,
  formData: FormData,
): Promise<ChangeStatusState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  // 🔴 단일 수강 종료와 **같은 게이트** — 강사(scoped)는 학생 기록 열람 전용(원장 2026-08-18).
  if (!(await canManageStudentStatusNow())) return { error: STUDENT_STATUS_DENIED };

  const studentId = String(formData.get("studentId") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim();
  const reasonStr = String(formData.get("reason") ?? "").trim();
  const detailStr = String(formData.get("detail") ?? "").trim() || null;
  const memo = String(formData.get("memo") ?? "").trim() || null;
  const picked = new Set(
    formData
      .getAll("enrollmentIds")
      .map((v) => String(v).trim())
      .filter(Boolean),
  );

  if (!studentId) return { error: "학생 ID가 누락되었습니다" };
  if (!date) return { error: "종료일을 입력해주세요" };
  if (!WITHDRAWAL_REASONS.includes(reasonStr as WithdrawalReason)) {
    return { error: "종료 사유를 선택해주세요" };
  }
  const checked = checkReasonInput({ reason: reasonStr as WithdrawalReason, detail: detailStr, memo });
  if (checked.error !== undefined) return { error: checked.error };
  if (picked.size === 0) return { error: "종료할 수업을 1개 이상 선택해주세요" };

  const supabase = await createClient();

  // 🔴 고른 id를 그대로 믿지 않는다 — **이 학생의 활성 수강**과 교집합만 닫는다(남의 학생 행·이미 끝난
  //    행이 낡은 화면에서 섞여 오는 것을 서버에서 잘라낸다. 화면 조건은 게이트가 아니다 — #77).
  const { error: listErr, rows: open } = await listOpenEnrollments(supabase, studentId);
  if (listErr) return { error: "수강 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." };
  const targets = open.filter((r) => picked.has(r.id));
  if (targets.length === 0) {
    return { error: "종료할 수 있는 수강이 없습니다. 화면을 새로고침한 뒤 다시 시도해 주세요." };
  }
  // 🔴 고른 수강을 끝내면 이어지는 반이 하나도 없으면 사실상 퇴원이다 — 퇴원보고서로(원장 2026-10-23). 시간표 확인 문구와 같은 판정.
  const lastCourse = await lastCourseViaReport(supabase, { studentId, enrollmentIds: targets.map((t) => t.id), date });
  if (lastCourse) return { error: lastCourse };

  for (const t of targets) {
    // 세부·메모는 수강 행에 함께 남긴다(0367a `withdrawal_detail`·`withdrawal_memo` — 퇴원관리 명단·사유 카드가 읽는다).
    const res = await endEnrollmentById(supabase, t.id, date, reasonStr, { detail: checked.detail, memo });
    if (res.error) {
      // 앞의 몇 건은 이미 닫혔다 — 그 기록은 아래 루프 밖이 아니라 **건별로** 남겼으므로 유실되지 않는다.
      return { error: "수강을 종료하지 못했습니다. 잠시 후 다시 시도해 주세요." };
    }
    // 수강을 바꾸는 모든 경로는 감사로그 필수(원장 2026-08-18). 단일 수강 종료와 같은 키·모양 +
    // `partial`로 "전체 퇴원이 아니라 골라서 닫았다"를 구분한다.
    await logAction({
      action: "enrollment_end",
      targetType: "student",
      metadata: {
        studentId,
        classId: res.classId,
        date: res.endDate,
        reason: reasonStr,
        detail: checked.detail,
        memo,
        source: "status_dialog",
        partial: targets.length < open.length,
      },
    });
  }

  // 고른 수강 중 수학이 있고 그로써 수학을 그만뒀으면(반이동 제외) 시트에 적는다(원장 2026-10-07 '수학만 퇴원'도 적는다).
  const sheetTenant = user.tenantId;
  const sheetIds = targets.map((t) => t.id);
  after(() => recordMathWithdrawalToSheet({ tenantId: sheetTenant, studentId, date, enrollmentIds: sheetIds }));

  revalidatePath(`/students/${studentId}`);
  revalidatePath("/students");
  revalidatePath("/withdrawals");
  revalidatePath("/timetable");
  return { ok: true };
}

/**
 * 휴원 다이얼로그의 **부분 휴원** — 고른 수강만 대기로 돌리고 **학생은 재원으로 남긴다.**
 *
 * 원장 2026-09-16: *"퇴원이든 휴원이든 … 누르면 수강중인 수업 전부 보여주고 그중에서 선택한 과목만
 * 휴원 및 퇴원처리할 수 있게."* — 퇴원엔 2026-08-20부터 있던 길이 휴원엔 없어서, 영어만 쉬려 해도
 * 수학까지 함께 멈췄다(`changeStudentStatus`의 on_hold 갈래는 활성 수강 전건을 대기로 돌린다).
 *
 * 🔴 **선택이 곧 "휴원 중인 수업" 전체다** — 체크한 것은 대기로, **체크가 풀렸는데 지금 대기인 것은
 *    다시 수강으로** 돌린다. 되돌릴 문을 같은 화면에 두지 않으면 부분 휴원을 풀 방법이 없다(학생 상태가
 *    '재원'이라 메뉴에 '재원 복구'가 안 뜬다). 규칙은 [`hold-selection.ts`](../hold-selection.ts) 단일 소스.
 * 🔴 **바뀐 행만 쓴다** — 이미 대기인 행을 또 쓰면 감사로그가 같은 사실로 부풀고, 아무것도 안 바뀐
 *    저장이 "처리했다"는 기록을 남긴다.
 * 🔴 학생 상태(students.status)는 **건드리지 않는다** — 휴원이 아니므로 퇴원관리·재원생 집계가 움직이지 않는다.
 *    전부 선택은 화면이 종전 `changeStudentStatus(target=on_hold)`로 보낸다(행선지가 갈린다).
 */
export async function setStudentEnrollmentHolds(
  _prev: ChangeStatusState,
  formData: FormData,
): Promise<ChangeStatusState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  // 🔴 퇴원·부분 종료와 **같은 게이트** — 강사(scoped)는 학생 기록 열람 전용(원장 2026-08-18).
  if (!(await canManageStudentStatusNow())) return { error: STUDENT_STATUS_DENIED };

  const studentId = String(formData.get("studentId") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim() || kstToday();
  const picked = new Set(
    formData
      .getAll("enrollmentIds")
      .map((v) => String(v).trim())
      .filter(Boolean),
  );
  if (!studentId) return { error: "학생 ID가 누락되었습니다" };

  const supabase = await createClient();

  // 🔴 고른 id를 그대로 믿지 않는다 — **이 학생의 활성 수강**과 교집합만 쓴다(낡은 화면·남의 행 차단, #77).
  const { error: listErr, rows: open } = await listOpenEnrollments(supabase, studentId);
  if (listErr) return { error: "수강 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." };

  const toHold = open.filter((r) => picked.has(r.id) && !r.onHold);
  const toResume = open.filter((r) => !picked.has(r.id) && r.onHold);
  // 🔴 `picked.size`가 아니라 **이 학생의 활성 수강과의 교집합**으로 센다 — 낡은 화면이 남의 id를
  //    섞어 보내면 picked.size가 부풀어 "전부 휴원"으로 기록된다(숫자만 거짓이 되는 자리).
  const heldAfter = open.filter((r) => picked.has(r.id)).length;
  if (toHold.length === 0 && toResume.length === 0) {
    // 바뀐 게 없다 — 에러가 아니라 성공으로 통과(멱등). 화면은 그대로 닫힌다.
    return { ok: true };
  }

  for (const r of toHold) {
    const { error } = await supabase.from("enrollments").update({ on_hold: true }).eq("id", r.id);
    if (error) return { error: dbWhy(error, "students.enrollmentHolds.hold", "수강을 대기로 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.") };
    // 수강을 바꾸는 모든 경로는 감사로그 필수(원장 2026-08-18). 시간표 드래그(holdSingleEnrollment)와 같은 키.
    await logAction({
      action: "enrollment_hold",
      targetType: "student",
      metadata: { studentId, classId: r.classId, date, source: "status_dialog", partial: heldAfter < open.length },
    });
  }
  for (const r of toResume) {
    const { error } = await supabase.from("enrollments").update({ on_hold: false }).eq("id", r.id);
    if (error) return { error: dbWhy(error, "students.enrollmentHolds.resume", "수강을 되돌리지 못했습니다. 잠시 후 다시 시도해 주세요.") };
    await logAction({
      action: "enrollment_resume",
      targetType: "student",
      metadata: { studentId, classId: r.classId, date, source: "status_dialog" },
    });
  }

  revalidatePath(`/students/${studentId}`);
  revalidatePath("/students");
  revalidatePath("/timetable");
  // 반 상세 명단이 대기 표시를 그린다 — holdSingleEnrollment와 같은 갱신 범위.
  for (const id of new Set([...toHold, ...toResume].map((r) => r.classId).filter(Boolean))) {
    revalidatePath(`/classes/${id}`);
  }
  return { ok: true };
}

/**
 * 단일 수강 **대기(휴원)** 전환 — 이 수강 한 건만 대기로 돌린다(퇴원·반 폐지 아님).
 *
 * 원장 2026-09-07(시간표 통합뷰): 학생을 대기 칸으로 끌어 놓으면 확인 팝업이 뜨고, 날짜를 고른다(기본 오늘).
 *
 * 🔴 **게이트는 수강 종료와 같다**(`canManageStudentRecords` = students full) — 강사는 학생 기록 열람 전용
 *    (원장 2026-08-18). 화면이 드래그를 숨기고 여기서 한 번 더 막는다(#77 이중 방어).
 * 🔴 **날짜는 기록이다** — `enrollments`엔 "언제부터 대기"를 담는 칸이 없다(퇴원은 `end_date`가 있다).
 *    그래서 화면은 저장 즉시 대기로 바뀌고, 고른 날짜는 감사로그(`metadata.date`)에 남아 되짚을 수 있다.
 *    미래 날짜 예약이 필요하면 컬럼(예: `hold_from`) 신설이 선행돼야 한다 — 원장 결정 사항.
 * ⚠️ 이미 종료된 수강은 거절한다(끝난 기록을 되살리는 것처럼 보인다). 이미 대기면 **성공으로 통과**(멱등).
 */
export async function holdSingleEnrollment(
  _prev: ChangeStatusState,
  formData: FormData,
): Promise<ChangeStatusState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canManageStudentStatusNow())) return { error: STUDENT_STATUS_DENIED };

  const enrollmentId = String(formData.get("enrollmentId") ?? "").trim();
  const studentId = String(formData.get("studentId") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim() || kstToday();
  if (!enrollmentId) return { error: "수강 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { data: row, error: readErr } = await supabase
    .from("enrollments")
    .select("id, class_id, student_id, end_date, on_hold")
    .eq("id", enrollmentId)
    .maybeSingle();
  if (readErr) return { error: dbWhy(readErr, "students.holdSingleEnrollment.read", "수강 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.") };
  if (!row || (studentId && studentId !== row.student_id)) return { error: "수강 기록을 찾을 수 없습니다" };
  if (row.end_date) return { error: "이미 종료된 수강입니다" };

  if (!row.on_hold) {
    const { error } = await supabase.from("enrollments").update({ on_hold: true }).eq("id", enrollmentId);
    if (error) return { error: dbWhy(error, "students.holdSingleEnrollment", "수강을 대기로 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.") };
    await logAction({
      action: "enrollment_hold",
      targetType: "student",
      metadata: {
        studentId: row.student_id,
        classId: row.class_id,
        date,
        source: "timetable_integrated_drag",
      },
    });
  }

  const sid = row.student_id;
  if (sid) revalidatePath(`/students/${sid}`);
  revalidatePath("/students");
  if (row.class_id) revalidatePath(`/classes/${row.class_id}`);
  revalidatePath("/timetable");
  return undefined;
}

/** 단일 수강 종료 (전체 퇴원과 별개) */
export async function endSingleEnrollment(
  _prev: ChangeStatusState,
  formData: FormData,
): Promise<ChangeStatusState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  // 수강 종료 = 학생 쓰기(full) 권한 이상만(master·admin·manager·counselor). UI 숨김 + 이 서버 게이트 이중 방어.
  if (!(await canManageStudentStatusNow())) return { error: STUDENT_STATUS_DENIED };

  const enrollmentId = String(formData.get("enrollmentId") ?? "").trim();
  const studentId = String(formData.get("studentId") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim() || kstToday();

  if (!enrollmentId) return { error: "수강 ID가 누락되었습니다" };
  // 사유는 고른다 — 예전엔 칸 없이 '기타'를 박아 퇴원관리에 메모 없는 '기타'가 쌓였다(원장 2026-10-15 *"기타는 모든 곳을
  // 일치하게"*). 반·학생 상세의 수강 종료 창과 시간표의 종료(Delete · 퇴원 칸 끌기)가 같은 칸(`ReasonFields`)을 보낸다.
  const picked = readReasonForm(formData, "종료");
  if (picked.error !== undefined) return { error: picked.error };
  const reason = picked.reason;

  const supabase = await createClient();
  // 🔴 학생이 다니는 마지막 반이면 끝내지 않는다 — 끝내면 사실상 퇴원이라 퇴원보고서로(원장 2026-10-23). 반·학생 상세의 수강 종료 창과
  //    시간표(Delete · 퇴원 칸 끌기)가 모두 이 액션을 지난다. 판정은 시간표 확인 문구와 같다(`endScopeFor`).
  const lastCourse = await lastCourseViaReport(supabase, { studentId: studentId || null, enrollmentIds: [enrollmentId], date });
  if (lastCourse) return { error: lastCourse };
  // 종료 규약(미래 시작 클램프 + withdrawal_reason)은 공용 원시함수 한 곳에 있다 — 퇴원 다이얼로그의
  // 부분 종료(endStudentEnrollments)도 같은 함수를 돈다(#77: 표면마다 다시 짜면 한쪽만 고쳐진다).
  const res = await endEnrollmentById(supabase, enrollmentId, date, reason, { detail: picked.detail, memo: picked.memo }, studentId || undefined);
  if (res.error) return { error: res.error };
  // 이 종료로 수학을 그만뒀으면(반이동 제외 · 다른 수학 반이 남아 있으면 아님) 시트에 적는다(원장 2026-10-07).
  const sheetStudent = res.studentId || null;
  if (sheetStudent && res.endDate) {
    const sheetTenant = user.tenantId;
    const sheetDate = String(res.endDate).slice(0, 10);
    after(() =>
      recordMathWithdrawalToSheet({ tenantId: sheetTenant, studentId: sheetStudent, date: sheetDate, enrollmentIds: [enrollmentId] }),
    );
  }

  await logAction({
    action: "enrollment_end",
    targetType: "student",
    metadata: {
      studentId: res.studentId || null,
      classId: res.classId ?? null,
      date: res.endDate,
      reason,
      detail: picked.detail,
      memo: picked.memo,
    },
  });

  if (studentId) revalidatePath(`/students/${studentId}`);
  revalidatePath("/students");
  // 반 상세에서도 바로 종료하므로(원장 2026-09-01) 그 반 화면·목록도 함께 갱신한다 —
  // 호출부의 router.refresh()는 그 문서 하나만 다시 그린다(창이 여러 개면 나머지는 stale).
  if (res.classId) revalidatePath(`/classes/${res.classId}`);
  revalidatePath("/classes");
  return undefined;
}

// ────────────────────── 메모 + 성적 ──────────────────────

/**
 * 담당 학생 범위(감사 S4, 원장 2026-09-23) — 강사에게 메모·성적·목표·레벨테스트 **쓰기**를 연 것은 결정대로지만,
 * 그 쓰기도 학생 상세 열람과 **같은 범위**(canViewStudentDetail — 담임∪교시 담당∪임시 위임)여야 한다.
 * 안 그러면 요청을 직접 보내 남의 학생 메모를 지울 수 있다(#77). 판정 대상은 students가 scoped인 사용자뿐.
 */
const OUT_OF_STUDENT_SCOPE = "담당 학생의 기록만 고칠 수 있습니다";

async function studentsScoped(role: Parameters<typeof accessLevelTenant>[0]): Promise<boolean> {
  return (await accessLevelTenant(role, "students")) === "scoped";
}

/** 새 기록을 쓸 학생이 범위 안인가 — 밖이면 오류 문구. */
async function studentScopeError(
  role: Parameters<typeof accessLevelTenant>[0],
  studentId: string,
): Promise<string | null> {
  if (!(await studentsScoped(role))) return null;
  return (await canViewStudentDetail(studentId)) ? null : OUT_OF_STUDENT_SCOPE;
}

/**
 * 기존 행(id)을 고치거나 지우기 전 — 강사면 **행을 먼저 읽어** 그 학생이 범위 안인지 본다
 * (폼의 studentId는 믿지 않는다). 사무실은 추가 조회 없이 통과.
 */
async function rowScopeError(
  role: Parameters<typeof accessLevelTenant>[0],
  table: "student_memos" | "student_grades" | "level_tests" | "grade_goals" | "grade_comments",
  id: string,
): Promise<string | null> {
  if (!(await studentsScoped(role))) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from(table).select("student_id").eq("id", id).maybeSingle();
  if (error) return "기록을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  if (!data) return "기록을 찾을 수 없습니다";
  return (await canViewStudentDetail(data.student_id as string)) ? null : OUT_OF_STUDENT_SCOPE;
}

export type CreateMemoState = { error?: string; ok?: boolean } | undefined;

export async function createStudentMemo(
  _prev: CreateMemoState,
  formData: FormData,
): Promise<CreateMemoState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "students"))) return { error: "학생 관리 권한이 없습니다" };

  const studentId = String(formData.get("studentId") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim() || "general";
  const content = String(formData.get("content") ?? "").trim();
  // '검색 허용'(0250a) — 체크박스는 꺼져 있으면 아예 안 실려 오므로 **존재 여부**로 읽는다.
  const searchable = formData.get("searchable") !== null;

  if (!studentId) return { error: "학생 ID가 누락되었습니다" };
  if (!content) return { error: "특이사항 내용을 입력해주세요" };
  const scopeErr = await studentScopeError(user.systemRole, studentId);
  if (scopeErr) return { error: scopeErr };

  const supabase = await createClient();
  const { error } = await supabase.from("student_memos").insert({
    tenant_id: user.tenantId,
    student_id: studentId,
    category,
    content,
    searchable,
    created_by: user.id,
  });

  if (error) return { error: dbWhy(error, "students.memo.create", "특이사항을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.") };

  // 🔴 메모 **본문은 담지 않는다**(학생 서술) — 분류·검색 허용 여부까지만.
  await logAction({
    action: "student_memo_create",
    targetType: "student",
    metadata: { studentId, category, searchable },
  });

  revalidatePath(`/students/${studentId}`);
  // 성공을 undefined로 돌리면 useActionState 소비처가 성공을 감지할 수 없다(성공 시 reset·초안 삭제가 죽는다).
  return { ok: true };
}

export type DeleteMemoState = { error?: string } | undefined;

export async function deleteStudentMemo(
  _prev: DeleteMemoState,
  formData: FormData,
): Promise<DeleteMemoState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "students"))) return { error: "학생 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const studentId = String(formData.get("studentId") ?? "").trim();
  if (!id) return { error: "특이사항 ID가 누락되었습니다" };
  const scopeErr = await rowScopeError(user.systemRole, "student_memos", id);
  if (scopeErr) return { error: scopeErr };

  const supabase = await createClient();
  const { data: gone, error } = await supabase.from("student_memos").delete().eq("id", id).select("student_id");
  if (error) return { error: dbWhy(error, "students.memo.delete", "특이사항을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.", "delete") };

  // 지운 행이 없으면(이미 지워졌거나 DB가 허락하지 않음) 남기지 않는다 — 없는 삭제를 기록하지 않는다.
  if (gone?.length) {
    await logAction({
      action: "student_memo_delete",
      targetType: "student",
      metadata: { memoId: id, studentId: (gone[0].student_id as string | null) ?? (studentId || null) },
    });
  }

  if (studentId) revalidatePath(`/students/${studentId}`);
  return undefined;
}

export type UpdateMemoState = { error?: string; ok?: boolean } | undefined;

export async function updateStudentMemo(
  _prev: UpdateMemoState,
  formData: FormData,
): Promise<UpdateMemoState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "students"))) return { error: "학생 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const studentId = String(formData.get("studentId") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim() || "general";
  const content = String(formData.get("content") ?? "").trim();
  const searchable = formData.get("searchable") !== null;
  if (!id) return { error: "특이사항 ID가 누락되었습니다" };
  if (!content) return { error: "특이사항 내용을 입력해주세요" };
  const scopeErr = await rowScopeError(user.systemRole, "student_memos", id);
  if (scopeErr) return { error: scopeErr };

  const supabase = await createClient();
  const { data: saved, error } = await supabase
    .from("student_memos")
    .update({ category, content, searchable, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("student_id");
  if (error) return { error: dbWhy(error, "students.memo.update", "특이사항을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.") };

  // 본문은 담지 않는다(작성과 같은 규칙). 바뀐 행이 없으면 남기지 않는다.
  if (saved?.length) {
    await logAction({
      action: "student_memo_update",
      targetType: "student",
      metadata: { memoId: id, studentId: (saved[0].student_id as string | null) ?? (studentId || null), category, searchable },
    });
  }

  if (studentId) revalidatePath(`/students/${studentId}`);
  return { ok: true };
}

export type ToggleMemoPinState = { error?: string } | undefined;

export async function toggleStudentMemoPin(
  _prev: ToggleMemoPinState,
  formData: FormData,
): Promise<ToggleMemoPinState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "students"))) return { error: "학생 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const studentId = String(formData.get("studentId") ?? "").trim();
  const pinned = String(formData.get("pinned") ?? "false") === "true";
  if (!id) return { error: "특이사항 ID가 누락되었습니다" };
  const scopeErr = await rowScopeError(user.systemRole, "student_memos", id);
  if (scopeErr) return { error: scopeErr };

  const supabase = await createClient();
  const { data: saved, error } = await supabase
    .from("student_memos")
    .update({ pinned, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("student_id");
  if (error) return { error: dbWhy(error, "students.memo.pin", "특이사항 고정을 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.") };

  if (saved?.length) {
    await logAction({
      action: "student_memo_pin",
      targetType: "student",
      metadata: { memoId: id, studentId: (saved[0].student_id as string | null) ?? (studentId || null), pinned },
    });
  }

  if (studentId) revalidatePath(`/students/${studentId}`);
  return undefined;
}

export type CreateGradeState = { error?: string } | undefined;

export async function createStudentGrade(
  _prev: CreateGradeState,
  formData: FormData,
): Promise<CreateGradeState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "students"))) return { error: "학생 관리 권한이 없습니다" };

  const studentId = String(formData.get("studentId") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const scoreStr = String(formData.get("score") ?? "").trim();
  const maxScoreStr = String(formData.get("maxScore") ?? "").trim();
  const takenOn = String(formData.get("takenOn") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim() || null;
  // 학기 축(2026-09-22) — 시험명 자유 입력을 없애고 성적관리 격자와 **같은 칸**에 적는다.
  const fallback = defaultTermOf(kstToday());
  const year = normalizeYear(formData.get("year"), fallback.year);
  const term = normalizeTerm(formData.get("term"), fallback.term);
  const slot = normalizeExamSlot(subject, formData.get("slot"));

  if (!studentId) return { error: "학생 ID가 누락되었습니다" };
  if (!subject) return { error: "과목을 선택해주세요" };
  if (!takenOn) return { error: "시험일을 입력해주세요" };
  const scopeErr = await studentScopeError(user.systemRole, studentId);
  if (scopeErr) return { error: scopeErr };
  // 🔴 시험일이 학기 밖이면 **어느 화면에도 안 잡히는 행**이 된다 — 월말평가는 월이 시험일에서
  //    나오므로(0288a) 학기에 없는 달로 저장되면 격자의 월 드롭다운에 그 달이 없어 영영 못 고친다.
  //    엑셀·주소는 이미 같은 창으로 누른다(sheet.ts·selection.ts).
  const window = termWindow(year, term);
  if (takenOn < window.start || takenOn > window.end) {
    return { error: `시험일이 그 학기(${window.start} ~ ${window.end}) 밖입니다` };
  }
  // 🔴 점수를 비우면 공용 저장 경로가 그 칸을 **지운다** — '성적 추가'가 삭제로 동작하면 안 되니 여기서 막는다
  //    (지우는 자리는 성적 기록 표의 휴지통·성적관리 격자다).
  if (!scoreStr) return { error: "점수를 입력해주세요" };
  const score = Number(scoreStr);
  if (!Number.isFinite(score)) return { error: "점수는 숫자로 입력해주세요" };
  const maxScore = maxScoreStr ? Number(maxScoreStr) : null;
  if (maxScoreStr && !Number.isFinite(maxScore)) return { error: "만점은 숫자로 입력해주세요" };

  // 0283a 미적용이면 저장 자체가 400이라, 실패 메시지 대신 **왜 안 되는지**를 말한다([[#95]]).
  if (!(await gradesSchemaReady())) {
    return { error: "성적 학기 구조(0283a)가 아직 적용되지 않아 저장할 수 없습니다" };
  }

  try {
    // 메모도 같은 저장 경로가 함께 받는다 — 칸 키를 아는 곳을 하나로 둔다(격자 저장은 notes를 안 보낸다).
    await writeGradeCells(
      { subject, year, term, slot, date: takenOn, maxScore },
      [{ studentId, classId: null, score, notes }],
    );
  } catch (e) {
    return { error: e instanceof Error ? e.message : "성적을 저장하지 못했습니다" };
  }

  // 🔴 점수·메모는 담지 않는다 — 어느 학생·과목·학기·시험 칸에 적었는지만(성적 원장 저장 `exam_scores`와 같은 축).
  await logAction({
    action: "student_grade_create",
    targetType: "student",
    metadata: { studentId, subject, year, term, slot, date: takenOn },
  });

  revalidatePath(`/students/${studentId}`);
  return undefined;
}

export type DeleteGradeState = { error?: string } | undefined;

export async function deleteStudentGrade(
  _prev: DeleteGradeState,
  formData: FormData,
): Promise<DeleteGradeState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  const grdLvl = await accessLevelTenant(user.systemRole, "students");
  if (grdLvl !== "full" && grdLvl !== "scoped") return { error: "성적 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const studentId = String(formData.get("studentId") ?? "").trim();
  if (!id) return { error: "성적 ID가 누락되었습니다" };
  const scopeErr = await rowScopeError(user.systemRole, "student_grades", id);
  if (scopeErr) return { error: scopeErr };

  const supabase = await createClient();
  const { data: gone, error } = await supabase
    .from("student_grades")
    .delete()
    .eq("id", id)
    .select("student_id, subject, taken_on");
  if (error) return { error: dbWhy(error, "students.grade.delete", "성적을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.", "delete") };

  // 🔴 점수는 담지 않는다 — 어느 학생·과목·시험일의 성적을 지웠는지만. 지운 행이 없으면 남기지 않는다.
  if (gone?.length) {
    const g = gone[0] as { student_id: string | null; subject: string | null; taken_on: string | null };
    await logAction({
      action: "student_grade_delete",
      targetType: "student",
      metadata: { gradeId: id, studentId: g.student_id ?? (studentId || null), subject: g.subject, date: g.taken_on },
    });
  }

  if (studentId) revalidatePath(`/students/${studentId}`);
  return undefined;
}

// === 레벨테스트(배치/승급/진단) ===
export type LevelTestState = { error?: string } | undefined;

const LEVEL_TEST_TYPES = ["placement", "promotion", "diagnostic"];
// 과목별 세부점수 키 — UI 폼 필드명(sub_<키>)과 일치(client level-tests.tsx와 동기 유지).
const LEVEL_SUBSCORE_KEYS: Record<string, string[]> = {
  math: ["계산", "이해", "추론", "문제해결"],
  english: ["어휘", "문법", "청해", "독해"],
};

export async function createStudentLevelTest(
  _prev: LevelTestState,
  formData: FormData,
): Promise<LevelTestState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "students"))) return { error: "학생 관리 권한이 없습니다" };

  const studentId = String(formData.get("studentId") ?? "").trim();
  const testTypeRaw = String(formData.get("testType") ?? "placement").trim();
  const testType = LEVEL_TEST_TYPES.includes(testTypeRaw) ? testTypeRaw : "placement";
  const subject = String(formData.get("subject") ?? "").trim();
  const testedOn = String(formData.get("testedOn") ?? "").trim();
  const level = String(formData.get("level") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!studentId) return { error: "학생 ID가 누락되었습니다" };
  if (!subject) return { error: "과목을 선택해주세요" };
  if (!testedOn) return { error: "시험일을 입력해주세요" };
  const scopeErr = await studentScopeError(user.systemRole, studentId);
  if (scopeErr) return { error: scopeErr };

  const subscores: Record<string, number> = {};
  for (const k of LEVEL_SUBSCORE_KEYS[subject] ?? []) {
    const v = String(formData.get(`sub_${k}`) ?? "").trim();
    if (v !== "" && Number.isFinite(Number(v))) subscores[k] = Number(v);
  }

  const supabase = await createClient();
  const { error } = await supabase.from("level_tests").insert({
    tenant_id: user.tenantId,
    student_id: studentId,
    test_type: testType,
    subject,
    tested_on: testedOn,
    level,
    subscores: Object.keys(subscores).length ? subscores : null,
    notes,
    created_by: user.id,
  });
  if (error) return { error: dbWhy(error, "students.levelTest.create", "레벨테스트를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.") };

  // 🔴 결과(레벨·세부점수)와 메모는 담지 않는다 — 언제·무슨 시험을 적었는지만.
  await logAction({
    action: "student_level_test_create",
    targetType: "student",
    metadata: { studentId, subject, testType, date: testedOn },
  });

  revalidatePath(`/students/${studentId}`);
  return undefined;
}

export async function deleteStudentLevelTest(
  _prev: LevelTestState,
  formData: FormData,
): Promise<LevelTestState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "students"))) return { error: "학생 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const studentId = String(formData.get("studentId") ?? "").trim();
  if (!id) return { error: "레벨테스트 ID가 누락되었습니다" };
  const scopeErr = await rowScopeError(user.systemRole, "level_tests", id);
  if (scopeErr) return { error: scopeErr };

  const supabase = await createClient();
  const { data: gone, error } = await supabase
    .from("level_tests")
    .delete()
    .eq("id", id)
    .select("student_id, subject, test_type, tested_on");
  if (error) return { error: dbWhy(error, "students.levelTest.delete", "레벨테스트를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.", "delete") };

  if (gone?.length) {
    const t = gone[0] as { student_id: string | null; subject: string | null; test_type: string | null; tested_on: string | null };
    await logAction({
      action: "student_level_test_delete",
      targetType: "student",
      metadata: { levelTestId: id, studentId: t.student_id ?? (studentId || null), subject: t.subject, testType: t.test_type, date: t.tested_on },
    });
  }

  if (studentId) revalidatePath(`/students/${studentId}`);
  return undefined;
}

// === 성적 목표설정(grade_goals) / 성적 코멘트(grade_comments) ===
// 쓰기 권한: 성적(=students) full/scoped. deleteStudentGrade 게이트와 동일.
async function requireGradeWrite() {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { user: null, error: "로그인이 필요합니다" };
  const lvl = await accessLevelTenant(user.systemRole, "students");
  if (lvl !== "full" && lvl !== "scoped") return { user: null, error: "성적 관리 권한이 없습니다" };
  return { user, error: undefined as string | undefined };
}

export type GoalState = { error?: string; ok?: boolean } | undefined;

/**
 * 시험 목표 추가 — **성적 칸 축**(과목·년도·학기·시험·월)으로 저장한다(원장 2026-09-24, codex 합의).
 * 🔴 같은 칸에 목표가 이미 있으면 **거절**한다 — 갱신 경로를 만들지 않아 수정 경합이 없다(바꾸려면 지우고 다시).
 *    동시에 두 번 눌러도 유니크(0291a `ux_grade_goals_cell`)가 막고 같은 문구로 돌려준다.
 * 🔴 0291a 적용 전엔 저장을 잠근다 — 축 없이 넣으면 옛 이름 매칭으로 새어 다른 해 성적에 붙는다.
 */
const GOAL_DUPLICATE = "이 시험의 목표가 이미 있습니다 — 기존 목표를 지우고 다시 추가하세요";

export async function createStudentGoal(_prev: GoalState, formData: FormData): Promise<GoalState> {
  const { user, error } = await requireGradeWrite();
  if (error || !user) return { error };

  const studentId = String(formData.get("studentId") ?? "").trim();
  const targetStr = String(formData.get("targetScore") ?? "").trim();
  const maxStr = String(formData.get("maxScore") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim() || null;
  if (!studentId) return { error: "학생 ID가 누락되었습니다" };
  const axis = parseGoalAxis({
    subject: String(formData.get("subject") ?? ""), year: formData.get("year"), term: formData.get("term"),
    slot: formData.get("slot"), month: formData.get("month"),
  });
  if (typeof axis === "string") return { error: axis };
  const max = Number(maxStr);
  if (!maxStr || !Number.isFinite(max) || max < 1 || max > 1000) return { error: "만점은 1~1000 사이로 입력해주세요" };
  const target = Number(targetStr);
  if (!targetStr || !Number.isFinite(target) || target < 0 || target > max) return { error: "목표 점수는 0 이상 만점 이하로 입력해주세요" };
  const scopeErr = await studentScopeError(user.systemRole, studentId);
  if (scopeErr) return { error: scopeErr };
  if (!(await goalAxisReady())) return { error: "목표 구조(0291a)가 아직 적용되지 않아 목표를 저장할 수 없습니다" };

  const supabase = await createClient();
  const { data: existing, error: findErr } = await supabase.from("grade_goals").select("id")
    .eq("tenant_id", user.tenantId).eq("student_id", studentId).eq("subject", axis.subject)
    .eq("school_year", axis.year).eq("term", axis.term).eq("exam_slot", axis.slot).eq("exam_month", axis.month).limit(1);
  if (findErr) return { error: dbWhy(findErr, "students.goal.create.read", "목표를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.") };
  if (existing?.length) return { error: GOAL_DUPLICATE };

  const { error: insErr } = await supabase.from("grade_goals").insert({
    tenant_id: user.tenantId,
    student_id: studentId,
    exam_id: null,
    exam_name: goalExamLabel(axis),
    subject: axis.subject,
    school_year: axis.year,
    term: axis.term,
    exam_slot: axis.slot,
    exam_month: axis.month,
    target_score: target,
    max_score: max,
    reason,
    created_by: user.id,
  });
  if (insErr) {
    const why = explainDbError(insErr, {
      scope: "students.goal.create",
      fallback: "목표를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      constraints: { ux_grade_goals_cell: { message: GOAL_DUPLICATE } },
    });
    return { error: why.message };
  }

  // 🔴 목표 점수·사유는 담지 않는다 — 어느 시험 칸에 목표를 두었는지만.
  await logAction({
    action: "student_goal_create",
    targetType: "student",
    metadata: { studentId, subject: axis.subject, year: axis.year, term: axis.term, slot: axis.slot, month: axis.month },
  });

  revalidatePath(`/students/${studentId}`);
  revalidatePath("/exams");
  return { ok: true };
}

export async function deleteStudentGoal(_prev: GoalState, formData: FormData): Promise<GoalState> {
  const { user, error } = await requireGradeWrite();
  if (error || !user) return { error };

  const id = String(formData.get("id") ?? "").trim();
  const studentId = String(formData.get("studentId") ?? "").trim();
  if (!id) return { error: "목표 ID가 누락되었습니다" };
  const scopeErr = await rowScopeError(user.systemRole, "grade_goals", id);
  if (scopeErr) return { error: scopeErr };

  const supabase = await createClient();
  const { data: gone, error: delErr } = await supabase.from("grade_goals").delete().eq("id", id).select("student_id, subject");
  if (delErr) return { error: dbWhy(delErr, "students.goal.delete", "목표를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.", "delete") };

  if (gone?.length) {
    const g = gone[0] as { student_id: string | null; subject: string | null };
    await logAction({
      action: "student_goal_delete",
      targetType: "student",
      metadata: { goalId: id, studentId: g.student_id ?? (studentId || null), subject: g.subject },
    });
  }

  if (studentId) revalidatePath(`/students/${studentId}`);
  revalidatePath("/exams");
  return undefined;
}

export type GradeCommentState = { error?: string; ok?: boolean } | undefined;

function readCommentForm(formData: FormData) {
  const category = String(formData.get("category") ?? "general").trim();
  const subjectRaw = String(formData.get("subject") ?? "").trim();
  const subject = subjectRaw && subjectRaw !== "all" ? subjectRaw : null;
  const content = String(formData.get("content") ?? "").trim();
  const period = String(formData.get("period") ?? "").trim() || currentPeriod();
  const sharedWithParent = formData.get("sharedWithParent") != null;
  return { category, subject, content, period, sharedWithParent };
}

export async function createStudentGradeComment(
  _prev: GradeCommentState,
  formData: FormData,
): Promise<GradeCommentState> {
  const { user, error } = await requireGradeWrite();
  if (error || !user) return { error };

  const studentId = String(formData.get("studentId") ?? "").trim();
  const f = readCommentForm(formData);
  if (!studentId) return { error: "학생 ID가 누락되었습니다" };
  if (!isCommentCategory(f.category)) return { error: "유효한 카테고리가 아닙니다" };
  if (!f.content) return { error: "코멘트 내용을 입력해주세요" };
  const scopeErr = await studentScopeError(user.systemRole, studentId);
  if (scopeErr) return { error: scopeErr };

  const supabase = await createClient();
  const { error: insErr } = await supabase.from("grade_comments").insert({
    tenant_id: user.tenantId,
    student_id: studentId,
    category: f.category,
    subject: f.subject,
    content: f.content,
    period: f.period,
    shared_with_parent: f.sharedWithParent,
    author_id: user.id,
  });
  if (insErr) return { error: dbWhy(insErr, "students.gradeComment.create", "코멘트를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.") };

  // 🔴 코멘트 **본문은 담지 않는다** — 분류·과목·기간·학부모 공유 여부까지만.
  await logAction({
    action: "student_grade_comment_create",
    targetType: "student",
    metadata: { studentId, category: f.category, subject: f.subject, period: f.period, sharedWithParent: f.sharedWithParent },
  });

  revalidatePath(`/students/${studentId}`);
  return { ok: true };
}

export async function updateStudentGradeComment(
  _prev: GradeCommentState,
  formData: FormData,
): Promise<GradeCommentState> {
  const { user, error } = await requireGradeWrite();
  if (error || !user) return { error };

  const id = String(formData.get("id") ?? "").trim();
  const studentId = String(formData.get("studentId") ?? "").trim();
  const f = readCommentForm(formData);
  if (!id) return { error: "코멘트 ID가 누락되었습니다" };
  if (!isCommentCategory(f.category)) return { error: "유효한 카테고리가 아닙니다" };
  if (!f.content) return { error: "코멘트 내용을 입력해주세요" };
  const scopeErr = await rowScopeError(user.systemRole, "grade_comments", id);
  if (scopeErr) return { error: scopeErr };

  const supabase = await createClient();
  const { data: saved, error: updErr } = await supabase
    .from("grade_comments")
    .update({
      category: f.category,
      subject: f.subject,
      content: f.content,
      period: f.period,
      shared_with_parent: f.sharedWithParent,
    })
    .eq("id", id)
    .select("student_id");
  if (updErr) return { error: dbWhy(updErr, "students.gradeComment.update", "코멘트를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.") };

  // 본문은 담지 않는다(작성과 같은 규칙). 바뀐 행이 없으면 남기지 않는다.
  if (saved?.length) {
    await logAction({
      action: "student_grade_comment_update",
      targetType: "student",
      metadata: {
        commentId: id,
        studentId: (saved[0].student_id as string | null) ?? (studentId || null),
        category: f.category,
        subject: f.subject,
        period: f.period,
        sharedWithParent: f.sharedWithParent,
      },
    });
  }

  if (studentId) revalidatePath(`/students/${studentId}`);
  return { ok: true };
}

export async function deleteStudentGradeComment(
  _prev: GradeCommentState,
  formData: FormData,
): Promise<GradeCommentState> {
  const { user, error } = await requireGradeWrite();
  if (error || !user) return { error };

  const id = String(formData.get("id") ?? "").trim();
  const studentId = String(formData.get("studentId") ?? "").trim();
  if (!id) return { error: "코멘트 ID가 누락되었습니다" };
  const scopeErr = await rowScopeError(user.systemRole, "grade_comments", id);
  if (scopeErr) return { error: scopeErr };

  const supabase = await createClient();
  const { data: gone, error: delErr } = await supabase
    .from("grade_comments")
    .delete()
    .eq("id", id)
    .select("student_id, category, subject, period");
  if (delErr) return { error: dbWhy(delErr, "students.gradeComment.delete", "코멘트를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.", "delete") };

  if (gone?.length) {
    const c = gone[0] as { student_id: string | null; category: string | null; subject: string | null; period: string | null };
    await logAction({
      action: "student_grade_comment_delete",
      targetType: "student",
      metadata: { commentId: id, studentId: c.student_id ?? (studentId || null), category: c.category, subject: c.subject, period: c.period },
    });
  }

  if (studentId) revalidatePath(`/students/${studentId}`);
  return undefined;
}

/**
 * 동명이인 '의심' 해제 — 사람이 확인해 "실제 다른 학생이 맞다"고 확정하면 dup_suspect=false(배지 제거).
 * (실제로 같은 사람(중복)이면 이 버튼이 아니라 관리자 병합 도구로 합친다.) students 쓰기(full) 권한 필요.
 */
export async function clearDupSuspect(
  studentId: string,
): Promise<{ ok?: boolean; error?: string }> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  // 학생 레코드 변경 = full만 — canWriteTenant는 scoped(강사)도 통과한다(적대 리뷰 F3, #77).
  if (!(await canManageStudentRecords(user.systemRole))) return { error: STUDENT_MANAGE_DENIED };
  const id = String(studentId ?? "").trim();
  if (!id) return { error: "학생 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { data: cleared, error } = await supabase.from("students").update({ dup_suspect: false }).eq("id", id).select("id");
  if (error) return { error: dbWhy(error, "students.clearDupSuspect", "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.") };
  // 0행 = DB가 이 학생 수정을 허락하지 않았다(역할 쓰기 게이트·다른 지점 id). 성공으로 답하고 감사로그를 남기면 표식은 그대로인데
  // "정상 확인함"이 기록된다(적대 리뷰 2026-10-14 — 데이터 정리에 버튼이 하나 더 생기며 드러남).
  if (!cleared || cleared.length === 0) return { error: "표식을 내리지 못했습니다 — 이 학생 정보를 바꿀 수 없는 계정이거나 이미 없는 학생입니다" };

  // 학생 레코드를 바꾸는 모든 경로는 감사로그 필수(원장 2026-08-18). 이 해제는 **통합 후보를 없애는**
  // 판단이기도 하다(중복 병합의 접미사 신호가 이 표식을 본다) — 누가 "다른 사람이 맞다"고 확정했는지
  // 남지 않으면 나중에 되짚을 근거가 0이다.
  await logAction({
    action: "student_dup_confirm",
    targetType: "student",
    metadata: { studentId: id },
  });

  revalidatePath(`/students/${id}`);
  revalidatePath("/students");
  // 통합 후보 목록(데이터 정리 면)이 이 표식을 읽는다 — 해제하면 그 자리에서 후보가 빠져야 한다.
  revalidatePath("/owner");
  return { ok: true };
}
