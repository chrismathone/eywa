import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";

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
  fromPublicIntake: boolean;
  syncAddedAt: string | null; // 지난 동기화가 새로 추가(다음 동기화 성공 시 해제) → ↻ 동기화 배지
};

export type ConsultationFilter = {
  month?: string | null; // "YYYY-MM" or null/undefined for all
  consultantId?: string | null; // UUID or null/undefined for all
  q?: string | null; // 이름·전화·학교 텍스트 검색
  outcome?: string | null; // 진행 상태(pending/scheduled/consulted/ai_done/enrolled/declined/no_show) or null=전체
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
  // 무필터 기본 칸반은 enrollment_consultations 전건이라 무페이징 select면 1000행에서 silent 절단된다(B2).
  // fetchAllPaged 콜백 안에서 매번 새 빌더로 필터·정렬을 재적용(range/filter 누적 방지).
  const data = await fetchAllPaged((from, to) => {
    let q = supabase
      .from("enrollment_consultations")
      .select(
        `id, prospect_name, prospect_grade, prospect_school,
         parent_phone, parent_request, outcome, consulted_at,
         processing_status, audio_path, from_public_intake, sync_added_at,
         consultant:consultant_id ( display_name )`,
      );
    if (filter?.month) {
      const { startIso, endIso } = monthBounds(filter.month);
      q = q.gte("consulted_at", startIso).lt("consulted_at", endIso);
    }
    if (filter?.consultantId) q = q.eq("consultant_id", filter.consultantId);
    if (filter?.outcome) q = q.eq("outcome", filter.outcome);
    if (filter?.q) {
      // 이름·전화·학교는 enrollment_consultations에 직접 있어 학생 id 조인 불필요(학생상담보다 단순).
      const safe = filter.q.trim().replace(/[(),]/g, " ");
      if (safe)
        q = q.or(
          `prospect_name.ilike.%${safe}%,parent_phone.ilike.%${safe}%,prospect_school.ilike.%${safe}%`,
        );
    }
    return q.order("consulted_at", { ascending: false }).range(from, to);
  });
  if (data.length === 0) return [];

  const ids = data.map((c) => c.id);
  // id가 수백+ 가능 → 청크 분할(.in() URL 414 방지, error는 throw — 조용히 삼키지 않음, B3).
  const ai = await fetchInChunks<{ consultation_id: string }>(ids, (chunk) =>
    supabase.from("consultation_ai_analysis").select("consultation_id").in("consultation_id", chunk),
  );
  const hasAi = new Set(ai.map((a) => a.consultation_id));

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
      fromPublicIntake: !!(c as { from_public_intake?: boolean }).from_public_intake,
      syncAddedAt: (c as { sync_added_at?: string | null }).sync_added_at ?? null,
    };
  });
}

export type IntakeTokenRow = {
  id: string;
  name: string;
  token: string;
  isActive: boolean;
  expiresAt: string | null;
  usageCount: number;
  submissionCount: number;
  createdAt: string;
};

/** 공개 접수 토큰 목록(직원용, 최신순). RLS로 테넌트 격리. */
export async function getIntakeTokens(): Promise<IntakeTokenRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("intake_tokens")
    .select("id, name, token, is_active, expires_at, usage_count, submission_count, created_at")
    .order("created_at", { ascending: false });
  return (data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    token: t.token,
    isActive: t.is_active,
    expiresAt: t.expires_at,
    usageCount: t.usage_count ?? 0,
    submissionCount: t.submission_count ?? 0,
    createdAt: t.created_at,
  }));
}

export type AiAnalysisDetail = {
  id: string;
  modelVersion: string;
  diagnosis: Diagnosis;
  learningPlan: LearningPlan;
  printPayload: PrintPayload;
  recommendedClassIds: string[] | null;
  generatedAt: string;
  reportEditedBy: string | null; // AI 분석 섹션 마지막 수정자
  reportEditedAt: string | null;
};

/** 등록 상담 폼 전체 필드(0046a) — 상세 표시·수정 초기값. */
export type FullConsultationFields = {
  englishName: string | null;
  gender: string | null;
  bloodType: string | null;
  birthDate: string | null;
  studentPhone: string | null;
  homePhone: string | null;
  parentRelation: string | null;
  address: string | null;
  zipCode: string | null;
  addressDetail: string | null;
  consultationPath: string | null;
  subject: string | null;
  careerGoal: string | null;
  siblings: string | null;
  safetyNotes: string | null;
  registrationStatus: string | null;
  paymentAmount: string | null;
  paymentDate: string | null;
  registrar: string | null;
  followUpDate: string | null;
  followUpContent: string | null;
  nonRegistrationReason: string | null;
  shuttleBusRequest: boolean;
  privacyAgreement: boolean;
  installmentAgreement: boolean;
  subjectDetails: Record<string, Record<string, string>> | null;
};

export type ConsultationDetail = ConsultationListRow & {
  parentName: string | null;
  learningHistory: LearningHistory | null;
  aiAnalysis: AiAnalysisDetail | null;
  audioReport: ConsultationAudioReport | null;
  transcription: string | null;
  speakerLabels: { speaker: string; text: string }[] | null;
  speakerRoles: Record<string, string> | null;
  processingError: string | null;
  audioDurationSec: number | null;
  recommendedClasses: { id: string; className: string; subject: string }[];
  studentId: string | null;
  /** makeedu counselSeq — 있으면 makeedu 원본 상세 페이지로 바로 가는 링크를 표시. */
  makeeduId: string | null;
  fields: FullConsultationFields;
};

export async function getEnrollmentConsultationById(id: string): Promise<ConsultationDetail | null> {
  const supabase = await createClient();
  const { data: c } = await supabase
    .from("enrollment_consultations")
    .select(
      `id, prospect_name, prospect_grade, prospect_school,
       parent_name, parent_phone, parent_request, learning_history,
       outcome, consulted_at, student_id, from_public_intake, makeedu_id,
       audio_path, audio_duration_sec, transcription, speaker_labels,
       processing_status, processing_error,
       english_name, gender, blood_type, birth_date, student_phone, home_phone,
       parent_relation, address, zip_code, address_detail, consultation_path,
       subject, career_goal, siblings, safety_notes, registration_status,
       payment_amount, payment_date, registrar, follow_up_date, follow_up_content,
       non_registration_reason, shuttle_bus_request, privacy_agreement,
       installment_agreement, subject_details,
       consultant:consultant_id ( display_name )`,
    )
    .eq("id", id)
    .single();

  if (!c) return null;

  const { data: aiList } = await supabase
    .from("consultation_ai_analysis")
    .select(
      `id, model_version, diagnosis, learning_plan, print_payload, recommended_class_ids, generated_at, report_edited_by, report_edited_at`,
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

  const printPayload =
    (ai?.print_payload as
      | (PrintPayload & { audioReport?: ConsultationAudioReport; speakerRoles?: Record<string, string> })
      | null) ?? null;
  const audioReport =
    printPayload && typeof printPayload === "object" && "audioReport" in printPayload
      ? (printPayload.audioReport as ConsultationAudioReport | undefined) ?? null
      : null;
  const speakerRoles =
    printPayload && typeof printPayload === "object" && printPayload.speakerRoles
      ? printPayload.speakerRoles
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
    fromPublicIntake: !!(c as { from_public_intake?: boolean }).from_public_intake,
    syncAddedAt: null, // 상세 화면은 목록 ↻ 배지가 불필요 → null(타입만 충족)
    transcription: c.transcription,
    // 비배열/null이면 null로(잘못된 jsonb가 TranscriptSection.slice 크래시 안 나게) — meetings 쿼리와 동일 방어.
    speakerLabels: Array.isArray(c.speaker_labels)
      ? (c.speaker_labels as { speaker: string; text: string }[])
      : null,
    speakerRoles,
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
          reportEditedBy: ai.report_edited_by ?? null,
          reportEditedAt: ai.report_edited_at ?? null,
        }
      : null,
    recommendedClasses,
    studentId: (c as { student_id?: string | null }).student_id ?? null,
    makeeduId: (c as { makeedu_id?: string | null }).makeedu_id ?? null,
    fields: mapFullFields(c as Record<string, unknown>),
  };
}

const s = (v: unknown): string | null => (v == null ? null : String(v));

function mapFullFields(c: Record<string, unknown>): FullConsultationFields {
  return {
    englishName: s(c.english_name),
    gender: s(c.gender),
    bloodType: s(c.blood_type),
    birthDate: s(c.birth_date),
    studentPhone: s(c.student_phone),
    homePhone: s(c.home_phone),
    parentRelation: s(c.parent_relation),
    address: s(c.address),
    zipCode: s(c.zip_code),
    addressDetail: s(c.address_detail),
    consultationPath: s(c.consultation_path),
    subject: s(c.subject),
    careerGoal: s(c.career_goal),
    siblings: s(c.siblings),
    safetyNotes: s(c.safety_notes),
    registrationStatus: s(c.registration_status),
    paymentAmount: s(c.payment_amount),
    paymentDate: s(c.payment_date),
    registrar: s(c.registrar),
    followUpDate: s(c.follow_up_date),
    followUpContent: s(c.follow_up_content),
    nonRegistrationReason: s(c.non_registration_reason),
    shuttleBusRequest: !!c.shuttle_bus_request,
    privacyAgreement: !!c.privacy_agreement,
    installmentAgreement: !!c.installment_agreement,
    subjectDetails: (c.subject_details as Record<string, Record<string, string>> | null) ?? null,
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
