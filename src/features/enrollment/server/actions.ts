"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { CLAUDE_MODELS, getAnthropic } from "@/lib/ai/anthropic";

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
  try {
    const client = getAnthropic();
    const response = await client.messages.create({
      model: CLAUDE_MODELS.balanced,
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
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
        },
      ],
    });
    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    analysis = JSON.parse(cleaned) as AnalysisShape;
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

  const modelVersion = `${CLAUDE_MODELS.balanced}-${new Date().toISOString().slice(0, 10)}`;

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
