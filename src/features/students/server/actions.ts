"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import {
  DEFAULT_WITHDRAWAL_METADATA,
  type WithdrawalMetadata,
  type WithdrawalReason,
} from "@/features/withdrawals/types";

export type StudentFormState = { error?: string; fieldErrors?: Record<string, string> } | undefined;

const STATUSES = ["prospect", "consulted", "enrolled", "on_hold", "withdrawn"] as const;
type StudentStatus = (typeof STATUSES)[number];

function readForm(formData: FormData) {
  const get = (k: string) => {
    const v = formData.get(k);
    return v == null ? "" : String(v).trim();
  };
  const status = get("status");
  return {
    name: get("name"),
    grade: get("grade") || null,
    school: get("school") || null,
    studentCode: get("studentCode") || null,
    parentName: get("parentName") || null,
    parentPhone: get("parentPhone") || null,
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
      grade: input.grade,
      school: input.school,
      student_code: input.studentCode,
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
      grade: input.grade,
      school: input.school,
      student_code: input.studentCode,
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
