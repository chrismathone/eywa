"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { accessLevelTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { kstToday } from "@/lib/date-kst";
import { fetchAllPaged } from "@/lib/supabase/batch";
import {
  DEFAULT_WITHDRAWAL_METADATA,
  type WithdrawalMetadata,
  type WithdrawalReason,
} from "@/features/withdrawals/types";
import { currentPeriod, isCommentCategory } from "../grades-meta";
import { resolveUniqueStudentName } from "../name-suffix";

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
 * 앞자리 0 누락(예: "1065317203")도 보정. 인식 못 하는 길이는 원본 유지(과도한 변형 방지).
 */
function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10 && d.startsWith("10")) d = "0" + d; // 1065317203 → 01065317203
  if (d.length === 11 && d.startsWith("010")) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10 && d.startsWith("02")) return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 9 && d.startsWith("02")) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  return raw;
}

function readForm(formData: FormData) {
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
    school: get("school") || null,
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
  if (input.status === "withdrawn" && !input.withdrawnAt) {
    errors.withdrawnAt = "퇴원일을 입력해주세요";
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

function translateDbError(message: string): string {
  if (/duplicate key/i.test(message) || /students_natural_key/i.test(message)) {
    return "동일한 이름·학교·학년의 재원 학생이 이미 있습니다";
  }
  return message;
}

export async function createStudent(
  _prev: StudentFormState,
  formData: FormData,
): Promise<StudentFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "students"))) return { error: "학생 관리 권한이 없습니다" };

  const input = readForm(formData);
  const fieldErrors = validate(input);
  if (fieldErrors) return { fieldErrors };

  const supabase = await createClient();

  // 이름 중복 방지 — 같은 이름이 이미 있으면 다음 빈 알파벳 접미사(A·B·C…) 강제(ijw/makeedu 규약).
  // 테넌트 전체 이름(퇴원 포함)과 대조해 표시 이름을 절대 유일하게. (수백 명 수준, fetchAllPaged=B2 안전)
  const existingNames = await fetchAllPaged<{ name: string | null }>((from, to) =>
    supabase.from("students").select("name").eq("tenant_id", user.tenantId).range(from, to),
  );
  const takenNames = new Set(existingNames.map((r) => (r.name ?? "").trim()).filter(Boolean));
  const resolvedName = resolveUniqueStudentName(input.name, takenNames);

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
      status: input.status,
      enrolled_at: input.enrolledAt,
      withdrawn_at: input.withdrawnAt,
      withdrawal_metadata:
        input.status === "withdrawn" ? DEFAULT_WITHDRAWAL_METADATA : null,
      notes: input.notes,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { error: translateDbError(error?.message ?? "학생 등록 실패") };
  }

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
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "admin"))) return { error: "영구 삭제 권한이 없습니다(관리 도구 권한 필요)" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "학생 ID가 누락되었습니다" };

  const supabase = await createClient();
  // 청구(invoices) 기록 있으면 FK restrict라 삭제 실패 → 미리 막고 퇴원 처리 안내(count head:true = 행 안 받음, B2).
  const { count } = await supabase
    .from("invoices")
    .select("*", { count: "exact", head: true })
    .eq("student_id", id);
  if ((count ?? 0) > 0) {
    return { error: "청구(수납) 기록이 있어 영구 삭제할 수 없습니다. 퇴원 처리를 이용하세요." };
  }

  const { error, count: deleted } = await supabase.from("students").delete({ count: "exact" }).eq("id", id);
  if (error) return { error: translateDbError(error.message) };
  if (!deleted) return { error: "학생을 찾을 수 없거나 권한이 없습니다" };

  revalidatePath("/students");
  revalidatePath("/withdrawals");
  return { ok: true };
}

export async function updateStudent(
  _prev: StudentFormState,
  formData: FormData,
): Promise<StudentFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "students"))) return { error: "학생 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "학생 ID가 누락되었습니다" };

  const input = readForm(formData);
  const fieldErrors = validate(input);
  if (fieldErrors) return { fieldErrors };

  const supabase = await createClient();

  // status 전환 시 withdrawal_metadata 처리 — 새로 퇴원으로 가면 기본 메타 채움,
  // 다시 재원으로 돌리면 null로 비움. 이미 퇴원 상태였으면 손대지 않음.
  const { data: cur } = await supabase
    .from("students")
    .select("status, withdrawal_metadata, withdrawn_at, name")
    .eq("id", id)
    .single();
  const prevStatus = cur?.status as string | undefined;

  let withdrawalMetadata: unknown = cur?.withdrawal_metadata ?? null;
  if (input.status === "withdrawn" && prevStatus !== "withdrawn") {
    withdrawalMetadata = DEFAULT_WITHDRAWAL_METADATA;
  } else if (input.status !== "withdrawn") {
    withdrawalMetadata = null;
  }

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

  const { error } = await supabase
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
      status: input.status,
      enrolled_at: input.enrolledAt,
      withdrawn_at: input.status === "withdrawn" ? input.withdrawnAt : null,
      withdrawal_metadata: withdrawalMetadata,
      notes: input.notes,
    })
    .eq("id", id);

  if (error) return { error: translateDbError(error.message) };

  // 상태 전환에 맞춰 활성 enrollment 정합성 유지 (changeStudentStatus와 동일 불변식).
  // 편집 폼 경로가 enrollment를 안 닫던 누수(F8) 보강 — 퇴원 시 종료, 복구/재원 시 on_hold 해제.
  if (input.status === "withdrawn" && prevStatus !== "withdrawn") {
    const enrErr = await closeActiveEnrollmentsClamped(supabase, id, input.withdrawnAt ?? null);
    if (enrErr) return { error: enrErr };
  } else if (input.status === "enrolled" && prevStatus !== "enrolled") {
    // 퇴원이 닫은 enrollment(end_date=퇴원일)를 다시 연다 — 안 하면 재원인데 시간표 '퇴원'에 남음.
    const withdrawnDate = cur?.withdrawn_at ? String(cur.withdrawn_at).slice(0, 10) : null;
    const reopenErr = await reopenEnrollmentsClosedByWithdrawal(supabase, id, withdrawnDate);
    if (reopenErr) return { error: reopenErr };
    const { error: enrErr } = await supabase
      .from("enrollments")
      .update({ on_hold: false })
      .eq("student_id", id)
      .is("end_date", null);
    if (enrErr) return { error: enrErr.message };
  } else if (input.status === "on_hold" && prevStatus !== "on_hold") {
    const { error: enrErr } = await supabase
      .from("enrollments")
      .update({ on_hold: true })
      .eq("student_id", id)
      .is("end_date", null);
    if (enrErr) return { error: enrErr.message };
  }

  revalidatePath(`/students/${id}`);
  revalidatePath("/students");
  // redirect 대신 결과 반환 — 클라가 성공 확정 후 동시편집 신호(publish) → 이동(B-2). nonce로 연속 저장 구분.
  return {
    ok: true,
    redirectTo: `/students/${id}`,
    nonce: Date.now(),
    notice: renamed ? `이미 '${input.name}' 학생이 있어 '${finalName}'(으)로 저장했습니다.` : undefined,
  };
}

/**
 * 재원 복구 시, 그 퇴원(withdrawnDate)이 닫은 enrollment를 다시 연다.
 * 퇴원은 활성 enrollment를 end_date=퇴원일로 닫으므로, 복구는 그 날짜로 닫힌 것만 되돌린다
 * (그 이전에 개별 종료된 과거 수강은 유지). 안 하면 학생은 재원인데 수강이 종료로 남아
 * 시간표 셀 '퇴원' 섹션에 계속 뜬다. withdrawnDate가 없으면(휴원→재원 등) no-op.
 */
async function reopenEnrollmentsClosedByWithdrawal(
  supabase: Awaited<ReturnType<typeof createClient>>,
  studentId: string,
  withdrawnDate: string | null,
): Promise<string | null> {
  if (!withdrawnDate) return null;
  const { error } = await supabase
    .from("enrollments")
    .update({ end_date: null, withdrawal_reason: null, on_hold: false })
    .eq("student_id", studentId)
    .eq("end_date", withdrawnDate);
  return error?.message ?? null;
}

/**
 * 학생의 활성(end_date null) 수강을 date로 종료한다. ⚠️ 미래 시작(start_date > date) 수강에
 * end_date=date를 넣으면 daterange(start_date, date)가 lower>upper로 throw("range lower bound must be
 * less than or equal to range upper bound") → 그 건은 end_date=start_date(zero-length=미활성=사실상 취소)로 클램프.
 * (admin 데이터정리 closeOrphanEnrollments와 동일 원리 — 그쪽은 다중 학생 청크판.) date 없으면 원래 동작(미종료).
 */
async function closeActiveEnrollmentsClamped(
  supabase: Awaited<ReturnType<typeof createClient>>,
  studentId: string,
  date: string | null,
  extra: Record<string, unknown> = {},
): Promise<string | null> {
  if (!date) {
    const { error } = await supabase
      .from("enrollments")
      .update({ end_date: null, ...extra })
      .eq("student_id", studentId)
      .is("end_date", null);
    return error?.message ?? null;
  }
  // 정상(시작일 ≤ date): 일괄 end_date=date.
  const { error } = await supabase
    .from("enrollments")
    .update({ end_date: date, ...extra })
    .eq("student_id", studentId)
    .is("end_date", null)
    .lte("start_date", date);
  if (error) return error.message;
  // 미래 시작(배정 예정): 행마다 start_date가 달라 개별 종료(end_date = 그 수강의 start_date).
  const { data: future, error: fErr } = await supabase
    .from("enrollments")
    .select("id, start_date")
    .eq("student_id", studentId)
    .is("end_date", null)
    .gt("start_date", date);
  if (fErr) return fErr.message;
  for (const e of future ?? []) {
    const { error: uErr } = await supabase
      .from("enrollments")
      .update({ end_date: e.start_date, ...extra })
      .eq("id", e.id);
    if (uErr) return uErr.message;
  }
  return null;
}

// ────────────────────── 상태 전환 모달 (퇴원/휴원/수강종료/복구) ──────────────────────

const WITHDRAWAL_REASONS: WithdrawalReason[] = [
  "graduated",
  "relocation",
  "competitor",
  "financial",
  "schedule",
  "dissatisfaction",
  "other",
];

export type ChangeStatusState = { error?: string } | undefined;

/**
 * 학생 상태 전환 (퇴원/휴원/복구). 학생 상세에서 호출.
 * - withdrawn: 학생 status='withdrawn' + 모든 활성 enrollment의 end_date 설정 + withdrawal_metadata 채움
 * - on_hold: 학생 status='on_hold' + 활성 enrollment에 on_hold=true
 * - enrolled (복구): 학생 status='enrolled' + withdrawn_at/metadata null + on_hold 해제
 */
export async function changeStudentStatus(
  _prev: ChangeStatusState,
  formData: FormData,
): Promise<ChangeStatusState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "students"))) return { error: "학생 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const target = String(formData.get("target") ?? "").trim();
  const reasonStr = String(formData.get("reason") ?? "").trim();
  const memo = String(formData.get("memo") ?? "").trim() || null;
  const date = String(formData.get("date") ?? "").trim() || null;

  if (!id) return { error: "학생 ID가 누락되었습니다" };
  if (!["withdrawn", "on_hold", "enrolled"].includes(target)) {
    return { error: "유효하지 않은 상태 전환입니다" };
  }

  const supabase = await createClient();

  if (target === "withdrawn") {
    if (!WITHDRAWAL_REASONS.includes(reasonStr as WithdrawalReason)) {
      return { error: "퇴원 사유를 선택해주세요" };
    }
    if (!date) return { error: "퇴원일을 입력해주세요" };

    const metadata: WithdrawalMetadata = {
      reason: reasonStr as WithdrawalReason,
      memo,
      consultation: {
        adminCalledParent: false,
        teacherCalledParent: false,
        talkedWithStudent: false,
      },
    };

    const { error: stuErr } = await supabase
      .from("students")
      .update({
        status: "withdrawn",
        withdrawn_at: date,
        withdrawal_metadata: metadata,
      })
      .eq("id", id);
    if (stuErr) return { error: stuErr.message };

    // 활성 enrollment 종료 (미래 시작 수강은 end_date=start_date로 클램프 — daterange 에러 방지).
    const enrErr = await closeActiveEnrollmentsClamped(supabase, id, date, { withdrawal_reason: reasonStr });
    if (enrErr) return { error: enrErr };
  } else if (target === "on_hold") {
    const { error: stuErr } = await supabase
      .from("students")
      .update({ status: "on_hold" })
      .eq("id", id);
    if (stuErr) return { error: stuErr.message };

    const { error: enrErr } = await supabase
      .from("enrollments")
      .update({ on_hold: true })
      .eq("student_id", id)
      .is("end_date", null);
    if (enrErr) return { error: enrErr.message };
  } else if (target === "enrolled") {
    // 복구 전에 이 학생의 퇴원일(withdrawn_at)을 먼저 읽는다 — 그 날짜로 닫힌 enrollment가 이번 퇴원이 종료시킨 것.
    const { data: before } = await supabase
      .from("students")
      .select("withdrawn_at")
      .eq("id", id)
      .single();
    const withdrawnDate = before?.withdrawn_at ? String(before.withdrawn_at).slice(0, 10) : null;

    // 복구: status=enrolled, withdrawn_at=null, metadata=null, on_hold=false
    const { error: stuErr } = await supabase
      .from("students")
      .update({
        status: "enrolled",
        withdrawn_at: null,
        withdrawal_metadata: null,
      })
      .eq("id", id);
    if (stuErr) return { error: stuErr.message };

    // ⚠️ 퇴원이 닫은 enrollment(end_date=퇴원일)를 다시 연다 — 안 하면 재원인데 수강이 종료로 남아 시간표 '퇴원'에 뜬다.
    const reopenErr = await reopenEnrollmentsClosedByWithdrawal(supabase, id, withdrawnDate);
    if (reopenErr) return { error: reopenErr };

    // 나머지 이미 열려있던 enrollment의 on_hold 해제.
    const { error: enrErr } = await supabase
      .from("enrollments")
      .update({ on_hold: false })
      .eq("student_id", id)
      .is("end_date", null);
    if (enrErr) return { error: enrErr.message };
  }

  revalidatePath(`/students/${id}`);
  revalidatePath("/students");
  revalidatePath("/withdrawals");
  return undefined;
}

/** 단일 수강 종료 (전체 퇴원과 별개) */
export async function endSingleEnrollment(
  _prev: ChangeStatusState,
  formData: FormData,
): Promise<ChangeStatusState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  // 수강 종료 = 학생 쓰기(full) 권한 이상만(master·admin·manager·counselor). UI 숨김 + 이 서버 게이트 이중 방어.
  if ((await accessLevelTenant(user.systemRole, "students")) !== "full") {
    return { error: "수강 종료 권한이 없습니다" };
  }

  const enrollmentId = String(formData.get("enrollmentId") ?? "").trim();
  const studentId = String(formData.get("studentId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim() || "other";
  const date = String(formData.get("date") ?? "").trim() || kstToday();

  if (!enrollmentId) return { error: "수강 ID가 누락되었습니다" };

  const supabase = await createClient();
  // 미래 시작(배정 예정) 수강을 date로 종료하면 daterange(start_date, date) lower>upper로 throw →
  // end_date=max(start_date, date)로 클램프(미래 시작 건은 start_date로 종료=zero-length).
  const { data: enr, error: selErr } = await supabase
    .from("enrollments")
    .select("start_date")
    .eq("id", enrollmentId)
    .maybeSingle();
  if (selErr) return { error: selErr.message };
  const endDate = enr && String(enr.start_date) > date ? String(enr.start_date) : date;
  const { error } = await supabase
    .from("enrollments")
    .update({ end_date: endDate, withdrawal_reason: reason })
    .eq("id", enrollmentId);

  if (error) return { error: error.message };

  if (studentId) revalidatePath(`/students/${studentId}`);
  revalidatePath("/students");
  return undefined;
}

// ────────────────────── 메모 + 성적 ──────────────────────

export type CreateMemoState = { error?: string } | undefined;

export async function createStudentMemo(
  _prev: CreateMemoState,
  formData: FormData,
): Promise<CreateMemoState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "students"))) return { error: "학생 관리 권한이 없습니다" };

  const studentId = String(formData.get("studentId") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim() || "general";
  const content = String(formData.get("content") ?? "").trim();

  if (!studentId) return { error: "학생 ID가 누락되었습니다" };
  if (!content) return { error: "메모 내용을 입력해주세요" };

  const supabase = await createClient();
  const { error } = await supabase.from("student_memos").insert({
    tenant_id: user.tenantId,
    student_id: studentId,
    category,
    content,
    created_by: user.id,
  });

  if (error) return { error: error.message };

  revalidatePath(`/students/${studentId}`);
  return undefined;
}

export type DeleteMemoState = { error?: string } | undefined;

export async function deleteStudentMemo(
  _prev: DeleteMemoState,
  formData: FormData,
): Promise<DeleteMemoState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "students"))) return { error: "학생 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const studentId = String(formData.get("studentId") ?? "").trim();
  if (!id) return { error: "메모 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { error } = await supabase.from("student_memos").delete().eq("id", id);
  if (error) return { error: error.message };

  if (studentId) revalidatePath(`/students/${studentId}`);
  return undefined;
}

export type UpdateMemoState = { error?: string; ok?: boolean } | undefined;

export async function updateStudentMemo(
  _prev: UpdateMemoState,
  formData: FormData,
): Promise<UpdateMemoState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "students"))) return { error: "학생 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const studentId = String(formData.get("studentId") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim() || "general";
  const content = String(formData.get("content") ?? "").trim();
  if (!id) return { error: "메모 ID가 누락되었습니다" };
  if (!content) return { error: "메모 내용을 입력해주세요" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("student_memos")
    .update({ category, content, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  if (studentId) revalidatePath(`/students/${studentId}`);
  return { ok: true };
}

export type ToggleMemoPinState = { error?: string } | undefined;

export async function toggleStudentMemoPin(
  _prev: ToggleMemoPinState,
  formData: FormData,
): Promise<ToggleMemoPinState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "students"))) return { error: "학생 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const studentId = String(formData.get("studentId") ?? "").trim();
  const pinned = String(formData.get("pinned") ?? "false") === "true";
  if (!id) return { error: "메모 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("student_memos")
    .update({ pinned, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  if (studentId) revalidatePath(`/students/${studentId}`);
  return undefined;
}

export type CreateGradeState = { error?: string } | undefined;

export async function createStudentGrade(
  _prev: CreateGradeState,
  formData: FormData,
): Promise<CreateGradeState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "students"))) return { error: "학생 관리 권한이 없습니다" };

  const studentId = String(formData.get("studentId") ?? "").trim();
  const examName = String(formData.get("examName") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const scoreStr = String(formData.get("score") ?? "").trim();
  const maxScoreStr = String(formData.get("maxScore") ?? "").trim();
  const takenOn = String(formData.get("takenOn") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!studentId) return { error: "학생 ID가 누락되었습니다" };
  if (!examName) return { error: "시험명을 입력해주세요" };
  if (!subject) return { error: "과목을 선택해주세요" };
  if (!takenOn) return { error: "시험일을 입력해주세요" };

  const supabase = await createClient();
  const { error } = await supabase.from("student_grades").insert({
    tenant_id: user.tenantId,
    student_id: studentId,
    exam_name: examName,
    subject,
    score: scoreStr || null,
    max_score: maxScoreStr || null,
    taken_on: takenOn,
    notes,
    created_by: user.id,
  });

  if (error) return { error: error.message };

  revalidatePath(`/students/${studentId}`);
  return undefined;
}

export type DeleteGradeState = { error?: string } | undefined;

export async function deleteStudentGrade(
  _prev: DeleteGradeState,
  formData: FormData,
): Promise<DeleteGradeState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  const grdLvl = await accessLevelTenant(user.systemRole, "students");
  if (grdLvl !== "full" && grdLvl !== "scoped") return { error: "성적 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const studentId = String(formData.get("studentId") ?? "").trim();
  if (!id) return { error: "성적 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { error } = await supabase.from("student_grades").delete().eq("id", id);
  if (error) return { error: error.message };

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
  const user = await getCurrentUser();
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
  if (error) return { error: error.message };

  revalidatePath(`/students/${studentId}`);
  return undefined;
}

export async function deleteStudentLevelTest(
  _prev: LevelTestState,
  formData: FormData,
): Promise<LevelTestState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "students"))) return { error: "학생 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const studentId = String(formData.get("studentId") ?? "").trim();
  if (!id) return { error: "레벨테스트 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { error } = await supabase.from("level_tests").delete().eq("id", id);
  if (error) return { error: error.message };

  if (studentId) revalidatePath(`/students/${studentId}`);
  return undefined;
}

// === 성적 목표설정(grade_goals) / 성적 코멘트(grade_comments) ===
// 쓰기 권한: 성적(=students) full/scoped. deleteStudentGrade 게이트와 동일.
async function requireGradeWrite() {
  const user = await getCurrentUser();
  if (!user) return { user: null, error: "로그인이 필요합니다" };
  const lvl = await accessLevelTenant(user.systemRole, "students");
  if (lvl !== "full" && lvl !== "scoped") return { user: null, error: "성적 관리 권한이 없습니다" };
  return { user, error: undefined as string | undefined };
}

export type GoalState = { error?: string; ok?: boolean } | undefined;

export async function createStudentGoal(_prev: GoalState, formData: FormData): Promise<GoalState> {
  const { user, error } = await requireGradeWrite();
  if (error || !user) return { error };

  const studentId = String(formData.get("studentId") ?? "").trim();
  const examName = String(formData.get("examName") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const examId = String(formData.get("examId") ?? "").trim() || null;
  const targetStr = String(formData.get("targetScore") ?? "").trim();
  const maxStr = String(formData.get("maxScore") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim() || null;

  if (!studentId) return { error: "학생 ID가 누락되었습니다" };
  if (!examName) return { error: "시험명을 입력해주세요" };
  if (!subject) return { error: "과목을 선택해주세요" };
  if (!targetStr || !Number.isFinite(Number(targetStr))) return { error: "목표 점수를 입력해주세요" };

  const supabase = await createClient();
  const { error: insErr } = await supabase.from("grade_goals").insert({
    tenant_id: user.tenantId,
    student_id: studentId,
    exam_id: examId,
    exam_name: examName,
    subject,
    target_score: Number(targetStr),
    max_score: maxStr && Number.isFinite(Number(maxStr)) ? Number(maxStr) : null,
    reason,
    created_by: user.id,
  });
  if (insErr) return { error: insErr.message };

  revalidatePath(`/students/${studentId}`);
  return { ok: true };
}

export async function deleteStudentGoal(_prev: GoalState, formData: FormData): Promise<GoalState> {
  const { user, error } = await requireGradeWrite();
  if (error || !user) return { error };

  const id = String(formData.get("id") ?? "").trim();
  const studentId = String(formData.get("studentId") ?? "").trim();
  if (!id) return { error: "목표 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { error: delErr } = await supabase.from("grade_goals").delete().eq("id", id);
  if (delErr) return { error: delErr.message };

  if (studentId) revalidatePath(`/students/${studentId}`);
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
  if (insErr) return { error: insErr.message };

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

  const supabase = await createClient();
  const { error: updErr } = await supabase
    .from("grade_comments")
    .update({
      category: f.category,
      subject: f.subject,
      content: f.content,
      period: f.period,
      shared_with_parent: f.sharedWithParent,
    })
    .eq("id", id);
  if (updErr) return { error: updErr.message };

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

  const supabase = await createClient();
  const { error: delErr } = await supabase.from("grade_comments").delete().eq("id", id);
  if (delErr) return { error: delErr.message };

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
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "students"))) return { error: "학생 관리 권한이 없습니다" };
  const id = String(studentId ?? "").trim();
  if (!id) return { error: "학생 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { error } = await supabase.from("students").update({ dup_suspect: false }).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(`/students/${id}`);
  revalidatePath("/students");
  return { ok: true };
}
