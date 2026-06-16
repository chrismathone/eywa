"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { submitTranscript } from "@/lib/ai/assemblyai";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { generateJSON } from "@/lib/ai/generate";

const createSchema = z.object({
  prospectName: z.string().min(1, "학생 이름을 입력해주세요"),
  prospectGrade: z.string().optional().nullable(),
  prospectSchool: z.string().optional().nullable(),
  parentName: z.string().optional().nullable(),
  parentPhone: z.string().optional().nullable(),
  parentRequest: z.string().optional().nullable(),
  prevAcademy: z.string().optional().nullable(),
  lastScore: z.string().optional().nullable(),
});

export type CreateConsultationState = { error?: string } | undefined;

export async function createEnrollmentConsultation(
  _prev: CreateConsultationState,
  formData: FormData,
): Promise<CreateConsultationState> {
  const parsed = createSchema.safeParse({
    prospectName: formData.get("prospectName"),
    prospectGrade: formData.get("prospectGrade"),
    prospectSchool: formData.get("prospectSchool"),
    parentName: formData.get("parentName"),
    parentPhone: formData.get("parentPhone"),
    parentRequest: formData.get("parentRequest"),
    prevAcademy: formData.get("prevAcademy"),
    lastScore: formData.get("lastScore"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "입력값을 확인해주세요" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다" };

  const learningHistory: Record<string, unknown> = {};
  if (parsed.data.prevAcademy) learningHistory.prevAcademy = parsed.data.prevAcademy;
  if (parsed.data.lastScore) learningHistory.lastScore = parsed.data.lastScore;

  const { data, error } = await supabase
    .from("enrollment_consultations")
    .insert({
      prospect_name: parsed.data.prospectName,
      prospect_grade: parsed.data.prospectGrade || null,
      prospect_school: parsed.data.prospectSchool || null,
      parent_name: parsed.data.parentName || null,
      parent_phone: parsed.data.parentPhone || null,
      parent_request: parsed.data.parentRequest || null,
      learning_history: Object.keys(learningHistory).length > 0 ? learningHistory : null,
      consultant_id: user.id,
      outcome: "consulted",
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "저장 실패" };

  revalidatePath("/enrollment");
  redirect(`/enrollment/${data.id}`);
}

type AnalysisShape = {
  diagnosis: {
    strengths: string[];
    weaknesses: string[];
    level: string;
    summary: string;
  };
  learningPlan: {
    immediate: string[];
    semester: string[];
    longTerm: string[];
  };
};

function stubAnalysis(prospectName: string, level: string): AnalysisShape {
  return {
    diagnosis: {
      strengths: ["기초 학력 양호", "성실한 학습 태도", "꾸준한 출석 의지"],
      weaknesses: ["응용 문제 풀이 훈련 부족", "서술형 정리 미숙"],
      level,
      summary:
        `${prospectName} 학생은 기본 학력은 안정적이지만 응용/서술형 영역에서 추가 훈련이 필요합니다. ` +
        `(ANTHROPIC_API_KEY 미연결 — 실제 Claude 호출 대신 stub 결과를 사용합니다)`,
    },
    learningPlan: {
      immediate: ["기본 개념 복습 4주", "주 1회 과제 첨삭"],
      semester: ["응용 문제 100제 풀이", "월말 평가 + 1:1 피드백"],
      longTerm: ["상위 반 진학", "기말고사 1등급 목표"],
    },
  };
}

export type RunAiState = { error?: string } | undefined;

export async function runAiAnalysis(
  _prev: RunAiState,
  formData: FormData,
): Promise<RunAiState> {
  const consultationId = String(formData.get("consultationId") ?? "");
  if (!consultationId) return { error: "상담 ID가 누락되었습니다" };

  const supabase = await createClient();

  const { data: c } = await supabase
    .from("enrollment_consultations")
    .select(
      "id, prospect_name, prospect_grade, prospect_school, parent_request, learning_history, consulted_at, consultant_id",
    )
    .eq("id", consultationId)
    .single();

  if (!c) return { error: "상담을 찾을 수 없습니다" };

  const { data: classes } = await supabase
    .from("classes")
    .select("id, class_name, subject")
    .eq("is_active", true);

  const gradePrefix = (c.prospect_grade ?? "").slice(0, 2);
  const matchingClasses = (classes ?? []).filter((cl) =>
    gradePrefix ? cl.class_name.includes(gradePrefix) : false,
  );

  let analysis: AnalysisShape;
  let modelId = "stub";
  try {
    const { data, model } = await generateJSON<AnalysisShape>({
      maxTokens: 2048,
      prompt: [
        `다음 신입생 상담 정보를 분석해 JSON으로만 답해주세요.`,
        ``,
        `학생: ${c.prospect_name}`,
        `학년: ${c.prospect_grade ?? "미상"}`,
        `학교: ${c.prospect_school ?? "미상"}`,
        `학부모 요구사항: ${c.parent_request ?? "없음"}`,
        `학습 이력: ${JSON.stringify(c.learning_history ?? {})}`,
        ``,
        `JSON schema:`,
        `{`,
        `  "diagnosis": {`,
        `    "strengths": string[3],`,
        `    "weaknesses": string[2],`,
        `    "level": "최상위권" | "상위권" | "중상위권" | "중위권" | "기초",`,
        `    "summary": string (2-3문장)`,
        `  },`,
        `  "learningPlan": {`,
        `    "immediate": string[2-3] (4주 안 할 일),`,
        `    "semester": string[2-3] (이번 학기),`,
        `    "longTerm": string[2-3] (장기 목표)`,
        `  }`,
        `}`,
        ``,
        `JSON만 출력하고 다른 설명은 일체 붙이지 마세요.`,
      ].join("\n"),
    });
    analysis = data;
    modelId = model;
  } catch {
    analysis = stubAnalysis(c.prospect_name, "중상위권");
  }

  const printPayload = {
    prospect: {
      name: c.prospect_name,
      grade: c.prospect_grade,
      school: c.prospect_school,
      parentName: null,
      parentPhone: null,
    },
    consultedAt: c.consulted_at,
    consultantName: null,
    parentRequest: c.parent_request,
    learningHistory: c.learning_history,
    diagnosis: analysis.diagnosis,
    learningPlan: analysis.learningPlan,
    recommendedClasses: matchingClasses.slice(0, 2).map((cl) => cl.class_name),
  };

  const modelVersion = `${modelId}-${new Date().toISOString().slice(0, 10)}`;

  const { error: aiError } = await supabase.from("consultation_ai_analysis").upsert(
    {
      consultation_id: consultationId,
      model_version: modelVersion,
      recommended_class_ids: matchingClasses.slice(0, 2).map((cl) => cl.id),
      diagnosis: analysis.diagnosis,
      learning_plan: analysis.learningPlan,
      print_payload: printPayload,
    },
    { onConflict: "consultation_id,model_version" },
  );

  if (aiError) return { error: aiError.message };

  await supabase
    .from("enrollment_consultations")
    .update({ outcome: "ai_done" })
    .eq("id", consultationId);

  revalidatePath(`/enrollment/${consultationId}`);
  revalidatePath("/enrollment");
  return undefined;
}

// ────────────────── 상담 → 학생 자동 전환 ──────────────────

export type ConvertToStudentState = { error?: string; studentId?: string } | undefined;

/**
 * 등록상담 → 학생 자동 생성. 선택한 반들에 enrollments도 동시에 INSERT.
 * 호출 후 enrollment_consultations.student_id 채우고 outcome='enrolled' 표시.
 */
export async function convertConsultationToStudent(
  _prev: ConvertToStudentState,
  formData: FormData,
): Promise<ConvertToStudentState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  const consultationId = String(formData.get("consultationId") ?? "").trim();
  if (!consultationId) return { error: "상담 ID가 누락되었습니다" };

  // form에서 다중 class id 받음 (선택)
  const classIds = formData
    .getAll("classIds")
    .map((v) => String(v).trim())
    .filter(Boolean);

  // 학생 정보 — 폼에서 받은 값 우선, 없으면 상담의 값
  const overrideName = String(formData.get("name") ?? "").trim();
  const overrideGrade = String(formData.get("grade") ?? "").trim() || null;
  const overrideSchool = String(formData.get("school") ?? "").trim() || null;
  const overrideParentName = String(formData.get("parentName") ?? "").trim() || null;
  const overrideParentPhone = String(formData.get("parentPhone") ?? "").trim() || null;

  const supabase = await createClient();

  const { data: c, error: cErr } = await supabase
    .from("enrollment_consultations")
    .select(
      "id, tenant_id, prospect_name, prospect_grade, prospect_school, parent_name, parent_phone, student_id, outcome",
    )
    .eq("id", consultationId)
    .single();

  if (cErr || !c) return { error: cErr?.message ?? "상담을 찾을 수 없습니다" };

  if (c.student_id) {
    // 이미 연결된 학생이 있으면 그 학생으로 이동
    return { studentId: c.student_id };
  }

  const today = new Date().toISOString().slice(0, 10);

  // students INSERT
  const { data: stu, error: stuErr } = await supabase
    .from("students")
    .insert({
      tenant_id: c.tenant_id,
      name: overrideName || c.prospect_name,
      grade: overrideGrade ?? c.prospect_grade,
      school: overrideSchool ?? c.prospect_school,
      parent_name: overrideParentName ?? c.parent_name,
      parent_phone: overrideParentPhone ?? c.parent_phone,
      status: "enrolled",
      enrolled_at: today,
    })
    .select("id")
    .single();

  if (stuErr || !stu) {
    return { error: stuErr?.message ?? "학생 생성 실패" };
  }

  // enrollments 다중 INSERT
  if (classIds.length > 0) {
    const rows = classIds.map((classId) => ({
      tenant_id: c.tenant_id,
      student_id: stu.id,
      class_id: classId,
      start_date: today,
    }));
    const { error: enrErr } = await supabase.from("enrollments").insert(rows);
    if (enrErr) {
      // 학생은 생성됐지만 enrollment 실패 — 사용자에게 알림 (학생 ID는 반환)
      return { error: `학생은 생성됐으나 반 배정 실패: ${enrErr.message}`, studentId: stu.id };
    }
  }

  // 상담에 학생 ID + outcome=enrolled 연결
  await supabase
    .from("enrollment_consultations")
    .update({ student_id: stu.id, outcome: "enrolled" })
    .eq("id", consultationId);

  revalidatePath("/enrollment");
  revalidatePath(`/enrollment/${consultationId}`);
  revalidatePath("/students");
  return { studentId: stu.id };
}

/**
 * Audio flow: client uploaded an audio file to the consultation-recordings bucket.
 * Server creates a consultation row, generates a signed URL, submits to AssemblyAI
 * with the shared webhook, and redirects to the detail page. The webhook handles
 * the rest (transcript fetch → Claude 13-section analysis → DB update).
 */
export type StartConsultationFromAudioState = { error?: string } | undefined;

export async function startConsultationFromAudio(
  _prev: StartConsultationFromAudioState,
  formData: FormData,
): Promise<StartConsultationFromAudioState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  const prospectName = String(formData.get("prospectName") ?? "").trim();
  const prospectGrade = String(formData.get("prospectGrade") ?? "").trim() || null;
  const prospectSchool = String(formData.get("prospectSchool") ?? "").trim() || null;
  const parentName = String(formData.get("parentName") ?? "").trim() || null;
  const parentPhone = String(formData.get("parentPhone") ?? "").trim() || null;
  const audioPath = String(formData.get("audioPath") ?? "").trim();
  const audioSizeBytes = Number(formData.get("audioSizeBytes") ?? 0);

  if (!prospectName) return { error: "학생 이름을 입력해주세요" };
  if (!audioPath) return { error: "음성 파일이 누락되었습니다" };

  const admin = createAdminClient();

  // Verify path belongs to this tenant
  const expectedPrefix = `${user.tenantId}/`;
  if (!audioPath.startsWith(expectedPrefix)) {
    return { error: "파일 경로가 잘못되었습니다" };
  }

  // Signed URL for AssemblyAI to fetch
  const { data: signed, error: signErr } = await admin.storage
    .from("consultation-recordings")
    .createSignedUrl(audioPath, 60 * 60);
  if (signErr || !signed?.signedUrl) {
    return { error: `signed URL 생성 실패: ${signErr?.message ?? "unknown"}` };
  }

  // Create consultation row in uploaded state
  const { data: consult, error: insertErr } = await admin
    .from("enrollment_consultations")
    .insert({
      tenant_id: user.tenantId,
      prospect_name: prospectName,
      prospect_grade: prospectGrade,
      prospect_school: prospectSchool,
      parent_name: parentName,
      parent_phone: parentPhone,
      consultant_id: user.id,
      outcome: "consulted",
      audio_path: audioPath,
      audio_size_bytes: audioSizeBytes,
      processing_status: "uploaded",
    })
    .select("id")
    .single();

  if (insertErr || !consult) {
    return { error: `상담 생성 실패: ${insertErr?.message ?? "unknown"}` };
  }

  // Kick off AssemblyAI with webhook
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://eywa-alpha.vercel.app");
  const webhookUrl = `${appUrl}/api/webhooks/assemblyai`;

  try {
    const result = await submitTranscript({
      audioUrl: signed.signedUrl,
      webhookUrl,
      webhookAuthHeader: process.env.ASSEMBLYAI_WEBHOOK_SECRET
        ? { name: "x-eywa-webhook-secret", value: process.env.ASSEMBLYAI_WEBHOOK_SECRET }
        : undefined,
    });
    await admin
      .from("enrollment_consultations")
      .update({
        assemblyai_transcript_id: result.id,
        processing_status: "transcribing",
      })
      .eq("id", consult.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin
      .from("enrollment_consultations")
      .update({ processing_status: "failed", processing_error: `AssemblyAI 제출 실패: ${msg}` })
      .eq("id", consult.id);
    return { error: msg };
  }

  revalidatePath("/enrollment");
  redirect(`/enrollment/${consult.id}`);
}
