"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import {
  DEFAULT_WITHDRAWAL_METADATA,
  type WithdrawalMetadata,
  type WithdrawalReason,
} from "@/features/withdrawals/types";

export type StudentFormState = { error?: string; fieldErrors?: Record<string, string> } | undefined;

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
    grade: get("grade") || null,
    school: get("school") || null,
    studentCode: get("studentCode") || null,
    gender: gender === "male" || gender === "female" ? gender : null,
    birthDate: get("birthDate") || null,
    address: get("address") || null,
    email: get("email") || null,
    studentPhone: normalizePhone(get("studentPhone") || null),
    parentName: get("parentName") || null,
    parentPhone: normalizePhone(get("parentPhone") || null),
    status: (STATUSES.includes(status as StudentStatus) ? status : "prospect") as StudentStatus,
    primaryTeacherId: get("primaryTeacherId") || null,
    secondaryTeacherId: get("secondaryTeacherId") || null,
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

  const input = readForm(formData);
  const fieldErrors = validate(input);
  if (fieldErrors) return { fieldErrors };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("students")
    .insert({
      tenant_id: user.tenantId,
      name: input.name,
      english_name: input.englishName,
      grade: input.grade,
      school: input.school,
      student_code: input.studentCode,
      gender: input.gender,
      birth_date: input.birthDate,
      address: input.address,
      email: input.email,
      student_phone: input.studentPhone,
      parent_name: input.parentName,
      parent_phone: input.parentPhone,
      status: input.status,
      primary_teacher_id: input.primaryTeacherId,
      secondary_teacher_id: input.secondaryTeacherId,
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
  redirect(`/students/${data.id}`);
}

export async function updateStudent(
  _prev: StudentFormState,
  formData: FormData,
): Promise<StudentFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

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
    .select("status, withdrawal_metadata")
    .eq("id", id)
    .single();
  const prevStatus = cur?.status as string | undefined;

  let withdrawalMetadata: unknown = cur?.withdrawal_metadata ?? null;
  if (input.status === "withdrawn" && prevStatus !== "withdrawn") {
    withdrawalMetadata = DEFAULT_WITHDRAWAL_METADATA;
  } else if (input.status !== "withdrawn") {
    withdrawalMetadata = null;
  }

  const { error } = await supabase
    .from("students")
    .update({
      name: input.name,
      english_name: input.englishName,
      grade: input.grade,
      school: input.school,
      student_code: input.studentCode,
      gender: input.gender,
      birth_date: input.birthDate,
      address: input.address,
      email: input.email,
      student_phone: input.studentPhone,
      parent_name: input.parentName,
      parent_phone: input.parentPhone,
      status: input.status,
      primary_teacher_id: input.primaryTeacherId,
      secondary_teacher_id: input.secondaryTeacherId,
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
    const { error: enrErr } = await supabase
      .from("enrollments")
      .update({ end_date: input.withdrawnAt })
      .eq("student_id", id)
      .is("end_date", null);
    if (enrErr) return { error: enrErr.message };
  } else if (input.status === "enrolled" && prevStatus !== "enrolled") {
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
  redirect(`/students/${id}`);
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

    // 활성 enrollment 종료
    const { error: enrErr } = await supabase
      .from("enrollments")
      .update({
        end_date: date,
        withdrawal_reason: reasonStr,
      })
      .eq("student_id", id)
      .is("end_date", null);
    if (enrErr) return { error: enrErr.message };
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

  const enrollmentId = String(formData.get("enrollmentId") ?? "").trim();
  const studentId = String(formData.get("studentId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim() || "other";
  const date = String(formData.get("date") ?? "").trim() || new Date().toISOString().slice(0, 10);

  if (!enrollmentId) return { error: "수강 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("enrollments")
    .update({
      end_date: date,
      withdrawal_reason: reason,
    })
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

export type RecomputeTeacherState = { error?: string; updated?: number } | undefined;

/**
 * 학생의 활성 enrollment들 중 schedule 시간이 가장 많은 강사를 primary_teacher_id로 설정.
 * formData가 비어 있으면 enrolled 전체 학생 일괄 재계산.
 */
export async function recomputePrimaryTeacher(
  _prev: RecomputeTeacherState,
  formData: FormData,
): Promise<RecomputeTeacherState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  const targetStudentId = String(formData.get("studentId") ?? "").trim();

  const supabase = await createClient();

  // 1) 처리할 학생 목록
  let studentIds: string[] = [];
  if (targetStudentId) {
    studentIds = [targetStudentId];
  } else {
    // 일괄 모드: enrolled 전원 — .range() 페이지네이션으로 1000행 절단 방지.
    const stus = await fetchAllPaged<{ id: string }>((from, to) =>
      supabase.from("students").select("id").eq("status", "enrolled").range(from, to),
    );
    studentIds = stus.map((s) => s.id);
  }
  if (studentIds.length === 0) return { updated: 0 };

  // 2) 학생별 활성 enrollment들의 schedule 시간 합산. id 청크로 .in()(414 + error삼킴 방지).
  const enrollments = await fetchInChunks<{
    student_id: string;
    class_id: string;
    class: { teacher_id?: string | null } | { teacher_id?: string | null }[] | null;
  }>(studentIds, (chunk) =>
    supabase
      .from("enrollments")
      .select(
        `student_id, class_id,
       class:class_id ( teacher_id ),
       schedule:class_id ( class_schedules ( start_time, end_time ) )`,
      )
      .in("student_id", chunk)
      .is("end_date", null),
  );

  // 강사별로 시간 합산 (student_id → teacher_id → minutes)
  type Acc = Map<string, number>; // teacher_id → minutes
  const perStudent = new Map<string, Acc>();

  // class_id → schedule minutes
  const classMinutes = new Map<string, number>();
  const classIds = Array.from(new Set(enrollments.map((e) => e.class_id)));
  if (classIds.length > 0) {
    const scheds = await fetchInChunks<{ class_id: string; start_time: string; end_time: string }>(
      classIds,
      (chunk) =>
        supabase.from("class_schedules").select("class_id, start_time, end_time").in("class_id", chunk),
    );
    for (const s of scheds) {
      const [sh, sm] = String(s.start_time).split(":").map(Number);
      const [eh, em] = String(s.end_time).split(":").map(Number);
      const mins = eh * 60 + em - (sh * 60 + sm);
      classMinutes.set(s.class_id, (classMinutes.get(s.class_id) ?? 0) + mins);
    }
  }

  for (const e of enrollments) {
    const cls = (Array.isArray(e.class) ? e.class[0] : e.class) as
      | { teacher_id?: string | null }
      | undefined;
    if (!cls?.teacher_id) continue;
    const acc = perStudent.get(e.student_id) ?? new Map();
    const mins = classMinutes.get(e.class_id) ?? 0;
    acc.set(cls.teacher_id, (acc.get(cls.teacher_id) ?? 0) + mins);
    perStudent.set(e.student_id, acc);
  }

  // 3) 학생별로 시간 최대 강사 → UPDATE
  let updated = 0;
  for (const [sid, acc] of perStudent) {
    if (acc.size === 0) continue;
    let bestTeacher = "";
    let bestMins = 0;
    for (const [tid, mins] of acc) {
      if (mins > bestMins) {
        bestMins = mins;
        bestTeacher = tid;
      }
    }
    if (!bestTeacher) continue;
    const { error } = await supabase
      .from("students")
      .update({ primary_teacher_id: bestTeacher })
      .eq("id", sid);
    if (!error) updated++;
  }

  revalidatePath("/students");
  if (targetStudentId) revalidatePath(`/students/${targetStudentId}`);
  return { updated };
}

export type DeleteGradeState = { error?: string } | undefined;

export async function deleteStudentGrade(
  _prev: DeleteGradeState,
  formData: FormData,
): Promise<DeleteGradeState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

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

  const id = String(formData.get("id") ?? "").trim();
  const studentId = String(formData.get("studentId") ?? "").trim();
  if (!id) return { error: "레벨테스트 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { error } = await supabase.from("level_tests").delete().eq("id", id);
  if (error) return { error: error.message };

  if (studentId) revalidatePath(`/students/${studentId}`);
  return undefined;
}
