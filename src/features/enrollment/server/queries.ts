import "server-only";
import { createClient } from "@/lib/supabase/server";

export type LearningHistory = {
  prevAcademy?: string;
  lastScore?: string;
  weakSubjects?: string[];
};

export type Diagnosis = {
  strengths: string[];
  weaknesses: string[];
  level: string;
  summary: string;
};

export type LearningPlan = {
  immediate: string[];
  semester: string[];
  longTerm: string[];
};

export type PrintPayload = {
  prospect: {
    name: string;
    grade: string | null;
    school: string | null;
    parentName: string | null;
    parentPhone: string | null;
  };
  consultedAt: string;
  consultantName: string | null;
  parentRequest: string | null;
  learningHistory: LearningHistory | null;
  diagnosis: Diagnosis;
  learningPlan: LearningPlan;
  recommendedClasses: string[];
};

export type ConsultationListRow = {
  id: string;
  prospectName: string;
  prospectGrade: string | null;
  prospectSchool: string | null;
  parentPhone: string | null;
  parentRequest: string | null;
  consultantName: string | null;
  outcome: string;
  consultedAt: string;
  hasAiAnalysis: boolean;
};

export async function getEnrollmentConsultations(): Promise<ConsultationListRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("enrollment_consultations")
    .select(
      `id, prospect_name, prospect_grade, prospect_school,
       parent_phone, parent_request, outcome, consulted_at,
       consultant:consultant_id ( display_name )`,
    )
    .order("consulted_at", { ascending: false });

  if (!data) return [];

  const ids = data.map((c) => c.id);
  let hasAi = new Set<string>();
  if (ids.length > 0) {
    const { data: ai } = await supabase
      .from("consultation_ai_analysis")
      .select("consultation_id")
      .in("consultation_id", ids);
    hasAi = new Set((ai ?? []).map((a) => a.consultation_id));
  }

  return data.map((c) => {
    const consultant = (Array.isArray(c.consultant) ? c.consultant[0] : c.consultant) as
      | { display_name?: string }
      | undefined;
    return {
      id: c.id,
      prospectName: c.prospect_name,
      prospectGrade: c.prospect_grade,
      prospectSchool: c.prospect_school,
      parentPhone: c.parent_phone,
      parentRequest: c.parent_request,
      consultantName: consultant?.display_name ?? null,
      outcome: c.outcome,
      consultedAt: c.consulted_at,
      hasAiAnalysis: hasAi.has(c.id),
    };
  });
}

export type AiAnalysisDetail = {
  id: string;
  modelVersion: string;
  diagnosis: Diagnosis;
  learningPlan: LearningPlan;
  printPayload: PrintPayload;
  recommendedClassIds: string[] | null;
  generatedAt: string;
};

export type ConsultationDetail = ConsultationListRow & {
  parentName: string | null;
  learningHistory: LearningHistory | null;
  aiAnalysis: AiAnalysisDetail | null;
  recommendedClasses: { id: string; className: string; subject: string }[];
};

export async function getEnrollmentConsultationById(id: string): Promise<ConsultationDetail | null> {
  const supabase = await createClient();
  const { data: c } = await supabase
    .from("enrollment_consultations")
    .select(
      `id, prospect_name, prospect_grade, prospect_school,
       parent_name, parent_phone, parent_request, learning_history,
       outcome, consulted_at,
       consultant:consultant_id ( display_name )`,
    )
    .eq("id", id)
    .single();

  if (!c) return null;

  const { data: aiList } = await supabase
    .from("consultation_ai_analysis")
    .select(
      `id, model_version, diagnosis, learning_plan, print_payload, recommended_class_ids, generated_at`,
    )
    .eq("consultation_id", id)
    .order("generated_at", { ascending: false })
    .limit(1);

  const ai = aiList?.[0] ?? null;

  let recommendedClasses: { id: string; className: string; subject: string }[] = [];
  const recommendedIds = (ai?.recommended_class_ids ?? []) as string[];
  if (recommendedIds.length > 0) {
    const { data: cls } = await supabase
      .from("classes")
      .select("id, class_name, subject")
      .in("id", recommendedIds);
    recommendedClasses = (cls ?? []).map((row) => ({
      id: row.id,
      className: row.class_name,
      subject: row.subject,
    }));
  }

  const consultant = (Array.isArray(c.consultant) ? c.consultant[0] : c.consultant) as
    | { display_name?: string }
    | undefined;

  return {
    id: c.id,
    prospectName: c.prospect_name,
    prospectGrade: c.prospect_grade,
    prospectSchool: c.prospect_school,
    parentName: c.parent_name,
    parentPhone: c.parent_phone,
    parentRequest: c.parent_request,
    learningHistory: c.learning_history as LearningHistory | null,
    consultantName: consultant?.display_name ?? null,
    outcome: c.outcome,
    consultedAt: c.consulted_at,
    hasAiAnalysis: ai !== null,
    aiAnalysis: ai
      ? {
          id: ai.id,
          modelVersion: ai.model_version,
          diagnosis: ai.diagnosis as Diagnosis,
          learningPlan: ai.learning_plan as LearningPlan,
          printPayload: ai.print_payload as PrintPayload,
          recommendedClassIds: ai.recommended_class_ids as string[] | null,
          generatedAt: ai.generated_at,
        }
      : null,
    recommendedClasses,
  };
}
