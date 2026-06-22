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

export type ConsultationProcessingStatus =
  | "idle"
  | "uploaded"
  | "transcribing"
  | "analyzing"
  | "completed"
  | "failed";

// ijw-calander 13-section consultation analysis (audio flow)
export type ConsultationAudioReport = {
  consultationType: string;
  familyBackground: string;
  parentConcerns: string;
  parentQuestions: string;
  parentRequests: string;
  parentSatisfaction: string;
  studentTraits: string;
  teacherResponse: string;
  salesPoints: string;
  agreements: string;
  followUps: string;
  warnings: string;
  extracted: {
    prospectName: string | null;
    grade: string | null;
    school: string | null;
    parentName: string | null;
    parentPhone: string | null;
  };
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
  processingStatus: ConsultationProcessingStatus;
  hasAudio: boolean;
};

export type ConsultationFilter = {
  month?: string | null; // "YYYY-MM" or null/undefined for all
  consultantId?: string | null; // UUID or null/undefined for all
  q?: string | null; // 이름·전화·학교 텍스트 검색
};

function monthBounds(month: string): { startIso: string; endIso: string } {
  const [yStr, mStr] = month.split("-");
  const y = Number(yStr);
  const m = Number(mStr) - 1;
  const start = new Date(y, m, 1);
  const end = new Date(y, m + 1, 1);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export async function getEnrollmentConsultations(
  filter?: ConsultationFilter,
): Promise<ConsultationListRow[]> {
  const supabase = await createClient();
  let q = supabase
    .from("enrollment_consultations")
    .select(
      `id, prospect_name, prospect_grade, prospect_school,
       parent_phone, parent_request, outcome, consulted_at,
       processing_status, audio_path,
       consultant:consultant_id ( display_name )`,
    )
    .order("consulted_at", { ascending: false });

  if (filter?.month) {
    const { startIso, endIso } = monthBounds(filter.month);
    q = q.gte("consulted_at", startIso).lt("consulted_at", endIso);
  }
  if (filter?.consultantId) {
    q = q.eq("consultant_id", filter.consultantId);
  }
  if (filter?.q) {
    // 이름·전화·학교는 enrollment_consultations에 직접 있어 학생 id 조인 불필요(학생상담보다 단순).
    const safe = filter.q.trim().replace(/[(),]/g, " ");
    if (safe)
      q = q.or(
        `prospect_name.ilike.%${safe}%,parent_phone.ilike.%${safe}%,prospect_school.ilike.%${safe}%`,
      );
  }

  const { data } = await q;
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
      processingStatus: c.processing_status as ConsultationProcessingStatus,
      hasAudio: !!c.audio_path,
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
  audioReport: ConsultationAudioReport | null;
  transcription: string | null;
  processingError: string | null;
  audioDurationSec: number | null;
  recommendedClasses: { id: string; className: string; subject: string }[];
  studentId: string | null;
};

export async function getEnrollmentConsultationById(id: string): Promise<ConsultationDetail | null> {
  const supabase = await createClient();
  const { data: c } = await supabase
    .from("enrollment_consultations")
    .select(
      `id, prospect_name, prospect_grade, prospect_school,
       parent_name, parent_phone, parent_request, learning_history,
       outcome, consulted_at, student_id,
       audio_path, audio_duration_sec, transcription,
       processing_status, processing_error,
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

  const printPayload = (ai?.print_payload as (PrintPayload & { audioReport?: ConsultationAudioReport }) | null) ?? null;
  const audioReport =
    printPayload && typeof printPayload === "object" && "audioReport" in printPayload
      ? (printPayload.audioReport as ConsultationAudioReport | undefined) ?? null
      : null;

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
    processingStatus: c.processing_status as ConsultationProcessingStatus,
    hasAudio: !!c.audio_path,
    transcription: c.transcription,
    processingError: c.processing_error,
    audioDurationSec: c.audio_duration_sec,
    audioReport,
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
    studentId: (c as { student_id?: string | null }).student_id ?? null,
  };
}

// ─────────────────────── 대시보드 통계 쿼리 ───────────────────────

export type OutcomeKey =
  | "pending"
  | "scheduled"
  | "consulted"
  | "ai_done"
  | "enrolled"
  | "declined"
  | "no_show";

export const OUTCOME_LABEL: Record<OutcomeKey, string> = {
  pending: "대기",
  scheduled: "예약",
  consulted: "상담완료",
  ai_done: "AI 완료",
  enrolled: "등록",
  declined: "거절",
  no_show: "노쇼",
};

export const OUTCOME_COLOR: Record<OutcomeKey, string> = {
  pending: "#d97706",
  scheduled: "#f59e0b",
  consulted: "#3b82f6",
  ai_done: "#10b981",
  enrolled: "#059669",
  declined: "#6b7280",
  no_show: "#dc2626",
};

export type OutcomeDistribution = { outcome: OutcomeKey; label: string; count: number; color: string }[];

export async function getMonthlyOutcomeDistribution(month: string): Promise<OutcomeDistribution> {
  const supabase = await createClient();
  const { startIso, endIso } = monthBounds(month);
  const { data } = await supabase
    .from("enrollment_consultations")
    .select("outcome")
    .gte("consulted_at", startIso)
    .lt("consulted_at", endIso);

  const counts = new Map<OutcomeKey, number>();
  for (const r of data ?? []) {
    counts.set(r.outcome as OutcomeKey, (counts.get(r.outcome as OutcomeKey) ?? 0) + 1);
  }

  return (Object.keys(OUTCOME_LABEL) as OutcomeKey[]).map((o) => ({
    outcome: o,
    label: OUTCOME_LABEL[o],
    count: counts.get(o) ?? 0,
    color: OUTCOME_COLOR[o],
  }));
}

export type ConversionTrendPoint = {
  month: string; // "5월"
  monthKey: string; // "2026-05"
  total: number;
  consultedRate: number; // (consulted + ai_done + enrolled) / total
  enrolledRate: number; // enrolled / total
};

export async function getMonthlyConversionTrend(months = 6): Promise<ConversionTrendPoint[]> {
  const supabase = await createClient();
  const now = new Date();
  // Earliest month start
  const earliest = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  const { data } = await supabase
    .from("enrollment_consultations")
    .select("outcome, consulted_at")
    .gte("consulted_at", earliest.toISOString());

  // group by YYYY-MM
  const buckets = new Map<string, { total: number; consulted: number; enrolled: number }>();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    buckets.set(key, { total: 0, consulted: 0, enrolled: 0 });
  }

  for (const r of data ?? []) {
    const d = new Date(r.consulted_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const b = buckets.get(key);
    if (!b) continue;
    b.total += 1;
    if (["consulted", "ai_done", "enrolled"].includes(r.outcome)) b.consulted += 1;
    if (r.outcome === "enrolled") b.enrolled += 1;
  }

  const result: ConversionTrendPoint[] = [];
  for (const [key, b] of buckets.entries()) {
    const m = Number(key.slice(5));
    result.push({
      month: `${m}월`,
      monthKey: key,
      total: b.total,
      consultedRate: b.total > 0 ? Math.round((b.consulted / b.total) * 100) : 0,
      enrolledRate: b.total > 0 ? Math.round((b.enrolled / b.total) * 100) : 0,
    });
  }
  return result;
}

export type ConsultantStats = {
  id: string;
  name: string;
  total: number;
  consulted: number;
  enrolled: number;
  conversionRate: number;
};

export async function getConsultantPerformance(months = 3): Promise<ConsultantStats[]> {
  const supabase = await createClient();
  const now = new Date();
  const since = new Date(now.getFullYear(), now.getMonth() - months + 1, 1).toISOString();

  const { data } = await supabase
    .from("enrollment_consultations")
    .select(
      `outcome, consultant_id, consulted_at,
       consultant:consultant_id ( display_name )`,
    )
    .gte("consulted_at", since)
    .not("consultant_id", "is", null);

  const byConsultant = new Map<
    string,
    { name: string; total: number; consulted: number; enrolled: number }
  >();

  for (const r of data ?? []) {
    if (!r.consultant_id) continue;
    const c = (Array.isArray(r.consultant) ? r.consultant[0] : r.consultant) as
      | { display_name?: string }
      | undefined;
    const id = r.consultant_id as string;
    if (!byConsultant.has(id)) {
      byConsultant.set(id, { name: c?.display_name ?? "?", total: 0, consulted: 0, enrolled: 0 });
    }
    const b = byConsultant.get(id)!;
    b.total += 1;
    if (["consulted", "ai_done", "enrolled"].includes(r.outcome)) b.consulted += 1;
    if (r.outcome === "enrolled") b.enrolled += 1;
  }

  return Array.from(byConsultant.entries())
    .map(([id, b]) => ({
      id,
      name: b.name,
      total: b.total,
      consulted: b.consulted,
      enrolled: b.enrolled,
      conversionRate: b.total > 0 ? Math.round((b.enrolled / b.total) * 100) : 0,
    }))
    .sort((a, b) => b.enrolled - a.enrolled);
}

export async function getConsultantOptions(): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("users")
    .select("id, display_name, system_role")
    .in("system_role", ["counselor", "manager", "admin", "master", "teacher"])
    .eq("status", "active")
    .order("display_name");
  return (data ?? []).map((u) => ({ id: u.id, name: u.display_name }));
}
