"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";

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
      notes: input.notes,
    })
    .eq("id", id);

  if (error) return { error: translateDbError(error.message) };

  revalidatePath(`/students/${id}`);
  revalidatePath("/students");
  redirect(`/students/${id}`);
}
