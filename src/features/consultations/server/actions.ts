"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { attendanceRate } from "@/lib/calc/attendance";
import { generateJSON } from "@/lib/ai/generate";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccess } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

type CareFocus = {
  priority: "high" | "medium" | "low";
  area: string;
  recommendation: string;
};

type CareAnalysisShape = {
  summary: string;
  focus: CareFocus[];
};

export type StudentCareState = { error?: string } | undefined;

export async function runStudentCareAnalysis(
  _prev: StudentCareState,
  formData: FormData,
): Promise<StudentCareState> {
  // 역할 게이트 — 유료 AI 호출은 학생 접근권이 있는 역할만(비용통제, #S5 형제).
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!canAccess(user.systemRole, "students")) {
    return { error: "학생 권한이 없습니다" };
  }

  const studentId = String(formData.get("studentId") ?? "");
  if (!studentId) return { error: "학생 ID가 누락되었습니다" };

  const supabase = await createClient();

  const [{ data: student }, { data: consults }, { data: attendance }, { data: enrollments }] =
    await Promise.all([
      supabase
        .from("students")
        .select(
          `id, name, grade, school, status, enrolled_at,
           teacher:primary_teacher_id ( display_name )`,
        )
        .eq("id", studentId)
        .single(),
      supabase
        .from("student_consultations")
        .select(
          `consulted_at, summary, follow_up_action,
           counselor:counselor_id ( display_name )`,
        )
        .eq("student_id", studentId)
        .order("consulted_at", { ascending: false })
        .limit(10),
      supabase
        .from("attendance_records")
        .select("status")
        .eq("student_id", studentId)
        .gte("session_date", new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)),
      supabase
        .from("enrollments")
        .select(`start_date, end_date, class:class_id ( class_name, subject )`)
        .eq("student_id", studentId)
        .is("end_date", null),
    ]);

  if (!student) return { error: "학생을 찾을 수 없습니다" };

  const teacher = (Array.isArray(student.teacher) ? student.teacher[0] : student.teacher) as
    | { display_name?: string }
    | undefined;

  const consultationsBlock = (consults ?? [])
    .map((c) => {
      const co = (Array.isArray(c.counselor) ? c.counselor[0] : c.counselor) as
        | { display_name?: string }
        | undefined;
      const date = new Date(c.consulted_at).toLocaleDateString("ko-KR");
      return [
        `[${date} · ${co?.display_name ?? "?"}]`,
        `요약: ${c.summary}`,
        c.follow_up_action ? `Follow-up: ${c.follow_up_action}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const attRows = attendance ?? [];
  const total = attRows.length;
  const present = attRows.filter((r) => r.status === "present").length;
  const absent = attRows.filter((r) => r.status === "absent").length;
  const late = attRows.filter((r) => r.status === "late").length;
  const rate = total > 0 ? attendanceRate(present, total).toFixed(1) : "—";

  const enrolledClasses = (enrollments ?? [])
    .map((e) => {
      const k = (Array.isArray(e.class) ? e.class[0] : e.class) as
        | { class_name?: string; subject?: string }
        | undefined;
      return k?.class_name ?? "?";
    })
    .join(", ");

  let analysis: CareAnalysisShape;
  let modelId: string;
  try {
    const { data, model } = await generateJSON<CareAnalysisShape>({
      keyName: "consultations",
      maxTokens: 2048,
      prompt: [
        "재원생 한 명의 케어 종합 분석을 JSON으로만 답해주세요.",
        "",
        `학생: ${student.name} (${student.grade ?? "—"}, ${student.school ?? "—"})`,
        `담임: ${teacher?.display_name ?? "—"}`,
        `등록일: ${student.enrolled_at ?? "—"}`,
        `수강 중인 반: ${enrolledClasses || "없음"}`,
        "",
        "최근 30일 출결:",
        `  전체 ${total}건 · 출석 ${present} · 결석 ${absent} · 지각 ${late} · 출석률 ${rate}%`,
        "",
        "최근 상담 기록 (최대 10건):",
        consultationsBlock || "  없음",
        "",
        "JSON schema:",
        "{",
        '  "summary": string (한국어 3-4문장 — 학생 현재 상태 + 주요 케어 포인트),',
        '  "focus": [{ "priority": "high" | "medium" | "low", "area": string (영역, 예: 학습/태도/출결), "recommendation": string (구체적 액션) }]',
        "}",
        "",
        "focus는 2~4개. 이미 잘하고 있는 영역은 제외, 개선이 필요하거나 주의가 필요한 영역만.",
        "추측이 아닌 위 데이터에 근거한 분석을 할 것.",
        "JSON만 출력, 마크다운 코드 블록 없이.",
      ].join("\n"),
    });
    analysis = data;
    modelId = model;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `AI 호출 실패: ${msg}` };
  }

  const modelVersion = `${modelId}-${new Date().toISOString().slice(0, 10)}`;

  const { error } = await supabase
    .from("students")
    .update({
      ai_care_summary: analysis.summary,
      ai_care_focus: analysis.focus,
      ai_care_model_version: modelVersion,
      ai_care_generated_at: new Date().toISOString(),
    })
    .eq("id", studentId);

  if (error) return { error: error.message };

  revalidatePath(`/students/${studentId}`);
  revalidatePath("/consultations");
  return undefined;
}

// ───────── 학생상담 CRUD ─────────
export type ConsultationFormState =
  | { error?: string; fieldErrors?: Record<string, string> }
  | undefined;

const CATEGORIES = ["general", "academic", "emotional", "career", "social", "other"] as const;
const AUDIENCES = ["parent", "student", "both"] as const;

function readConsultationForm(formData: FormData) {
  const get = (k: string) => {
    const v = formData.get(k);
    return v == null ? "" : String(v).trim();
  };
  const category = get("category");
  const audience = get("audience");
  return {
    studentId: get("studentId"),
    counselorId: get("counselorId") || null,
    consultedAt: get("consultedAt"),
    category: CATEGORIES.includes(category as (typeof CATEGORIES)[number]) ? category : null,
    subject: get("subject") || null,
    audience: AUDIENCES.includes(audience as (typeof AUDIENCES)[number]) ? audience : null,
    summary: get("summary"),
    followUpAction: get("followUpAction") || null,
    followUpDate: get("followUpDate") || null,
    followUpDone: get("followUpDone") === "true",
  };
}

function validateConsultation(input: ReturnType<typeof readConsultationForm>): Record<string, string> | null {
  const errors: Record<string, string> = {};
  if (!input.studentId) errors.studentId = "학생을 선택해주세요";
  if (!input.summary || input.summary.length < 5) errors.summary = "요약을 5자 이상 작성해주세요";
  if (!input.consultedAt) errors.consultedAt = "상담 일시를 입력해주세요";
  return Object.keys(errors).length > 0 ? errors : null;
}

export async function createStudentConsultation(
  _prev: ConsultationFormState,
  formData: FormData,
): Promise<ConsultationFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  const input = readConsultationForm(formData);
  const fieldErrors = validateConsultation(input);
  if (fieldErrors) return { fieldErrors };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("student_consultations")
    .insert({
      tenant_id: user.tenantId,
      student_id: input.studentId,
      counselor_id: input.counselorId ?? user.id,
      consulted_at: new Date(input.consultedAt).toISOString(),
      category: input.category,
      subject: input.subject,
      audience: input.audience,
      summary: input.summary,
      follow_up_action: input.followUpAction,
      follow_up_date: input.followUpDate,
      follow_up_done: input.followUpDone,
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "상담 저장 실패" };

  revalidatePath("/consultations");
  revalidatePath(`/students/${input.studentId}`);
  redirect("/consultations");
}

export async function updateStudentConsultation(
  _prev: ConsultationFormState,
  formData: FormData,
): Promise<ConsultationFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "상담 ID가 누락되었습니다" };

  const input = readConsultationForm(formData);
  const fieldErrors = validateConsultation(input);
  if (fieldErrors) return { fieldErrors };

  const supabase = await createClient();
  const { error } = await supabase
    .from("student_consultations")
    .update({
      student_id: input.studentId,
      counselor_id: input.counselorId ?? user.id,
      consulted_at: new Date(input.consultedAt).toISOString(),
      category: input.category,
      subject: input.subject,
      audience: input.audience,
      summary: input.summary,
      follow_up_action: input.followUpAction,
      follow_up_date: input.followUpDate,
      follow_up_done: input.followUpDone,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/consultations");
  revalidatePath(`/students/${input.studentId}`);
  redirect("/consultations");
}

export type ToggleFollowUpState = { error?: string } | undefined;

export async function toggleConsultationFollowUp(
  _prev: ToggleFollowUpState,
  formData: FormData,
): Promise<ToggleFollowUpState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  const id = String(formData.get("id") ?? "").trim();
  const done = String(formData.get("done") ?? "false") === "true";
  if (!id) return { error: "상담 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("student_consultations")
    .update({ follow_up_done: done })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/consultations");
  return undefined;
}

export type DeleteConsultationState = { error?: string } | undefined;

export async function deleteStudentConsultation(
  _prev: DeleteConsultationState,
  formData: FormData,
): Promise<DeleteConsultationState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  const id = String(formData.get("id") ?? "").trim();
  const studentId = String(formData.get("studentId") ?? "").trim();
  const redirectTo = String(formData.get("redirectTo") ?? "").trim();
  if (!id) return { error: "상담 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { error } = await supabase.from("student_consultations").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/consultations");
  if (studentId) revalidatePath(`/students/${studentId}`);
  if (redirectTo) redirect(redirectTo);
  return undefined;
}
