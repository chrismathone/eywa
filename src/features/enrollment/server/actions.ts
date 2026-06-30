"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { submitTranscript } from "@/lib/ai/assemblyai";
import { getAssemblyaiWebhookUrl } from "@/lib/config/app-url";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { kstToday } from "@/lib/date-kst";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { generateJSON } from "@/lib/ai/generate";
import { isTenantAudioPath } from "@/lib/storage/audio-path";
import {
  getMediaBackend,
  removeObject,
  resolveAudioReadUrl,
  verifyUploadedObject,
} from "@/lib/storage/media-storage";
import { localizeTranscriptionError } from "@/lib/ai/transcription-error";

const opt = z.string().optional().nullable();
const createSchema = z.object({
  prospectName: z.string().min(1, "학생 이름을 입력해주세요"),
  prospectGrade: opt,
  prospectSchool: opt,
  parentName: opt,
  parentPhone: opt,
  parentRequest: opt, // 상담 내용
  prevAcademy: opt,
  lastScore: opt,
  // 등록 상담 폼 전체(0046a)
  englishName: opt,
  gender: opt,
  bloodType: opt,
  birthDate: opt,
  studentPhone: opt,
  homePhone: opt,
  parentRelation: opt,
  address: opt,
  zipCode: opt,
  addressDetail: opt,
  consultationPath: opt,
  subject: opt,
  careerGoal: opt,
  siblings: opt,
  safetyNotes: opt,
  registrationStatus: opt,
  paymentAmount: opt,
  paymentDate: opt,
  registrar: opt,
  followUpDate: opt,
  followUpContent: opt,
  nonRegistrationReason: opt,
  shuttleBusRequest: opt,
  privacyAgreement: opt,
  installmentAgreement: opt,
  subjectDetails: opt, // 과목 탭 JSON 문자열
});

type FullForm = z.infer<typeof createSchema>;

const asBool = (v?: string | null) => v === "true" || v === "on";
const asNum = (v?: string | null) => {
  if (!v) return null;
  const n = Number(String(v).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** 폼 → DB 컬럼(공통). learning_history·tenant_id·consultant_id·outcome는 호출부에서 별도 처리. */
function buildConsultationRow(d: FullForm) {
  let subjectDetails: unknown = null;
  if (d.subjectDetails) {
    try {
      subjectDetails = JSON.parse(d.subjectDetails);
    } catch {
      subjectDetails = null;
    }
  }
  return {
    prospect_name: d.prospectName,
    prospect_grade: d.prospectGrade || null,
    prospect_school: d.prospectSchool || null,
    english_name: d.englishName || null,
    gender: d.gender || null,
    blood_type: d.bloodType || null,
    birth_date: d.birthDate || null,
    student_phone: d.studentPhone || null,
    home_phone: d.homePhone || null,
    parent_name: d.parentName || null,
    parent_phone: d.parentPhone || null,
    parent_relation: d.parentRelation || null,
    address: d.address || null,
    zip_code: d.zipCode || null,
    address_detail: d.addressDetail || null,
    consultation_path: d.consultationPath || null,
    subject: d.subject || null,
    career_goal: d.careerGoal || null,
    siblings: d.siblings || null,
    safety_notes: d.safetyNotes || null,
    registration_status: d.registrationStatus || null,
    payment_amount: asNum(d.paymentAmount),
    payment_date: d.paymentDate || null,
    registrar: d.registrar || null,
    follow_up_date: d.followUpDate || null,
    follow_up_content: d.followUpContent || null,
    non_registration_reason: d.nonRegistrationReason || null,
    parent_request: d.parentRequest || null,
    shuttle_bus_request: asBool(d.shuttleBusRequest),
    privacy_agreement: asBool(d.privacyAgreement),
    installment_agreement: asBool(d.installmentAgreement),
    subject_details: subjectDetails,
  };
}

export type CreateConsultationState = { error?: string } | undefined;

export async function createEnrollmentConsultation(
  _prev: CreateConsultationState,
  formData: FormData,
): Promise<CreateConsultationState> {
  const parsed = createSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "입력값을 확인해주세요" };
  }

  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "enrollment"))) return { error: "등록상담 권한이 없습니다" };

  const learningHistory: Record<string, unknown> = {};
  if (parsed.data.prevAcademy) learningHistory.prevAcademy = parsed.data.prevAcademy;
  if (parsed.data.lastScore) learningHistory.lastScore = parsed.data.lastScore;

  // 녹음 동반 생성(통합 폼): 구조화 필드 + 음성 첨부 + 전사·13섹션 AI 분석을 한 번에.
  // 웹훅(handleConsultation)의 buildFormPatch가 **빈 필드만** 보강하므로 수기 입력값은 보존된다.
  const audioPath = String(formData.get("audioPath") ?? "").trim();
  if (audioPath) {
    return createConsultationWithAudio(
      user,
      parsed.data,
      learningHistory,
      audioPath,
      Number(formData.get("audioSizeBytes") ?? 0),
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("enrollment_consultations")
    .insert({
      tenant_id: user.tenantId,
      ...buildConsultationRow(parsed.data),
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

/**
 * 녹음 동반 등록상담 생성 — 구조화 필드(buildConsultationRow)로 행을 만들고 음성을 첨부한 뒤
 * AssemblyAI 전사를 시작한다(startConsultationFromAudio와 동일 파이프라인, 단 풀 폼 필드 포함).
 * 웹훅이 전사 완료 후 13섹션 분석 + buildFormPatch(빈 필드만 보강)를 수행 → 수기 입력 보존.
 */
async function createConsultationWithAudio(
  user: { id: string; tenantId: string },
  data: FullForm,
  learningHistory: Record<string, unknown>,
  audioPath: string,
  audioSizeBytes: number,
): Promise<CreateConsultationState> {
  const admin = createAdminClient();
  if (!isTenantAudioPath(audioPath, user.tenantId)) return { error: "파일 경로가 잘못되었습니다" };

  let audioUrl: string;
  let verifiedSize = audioSizeBytes;
  try {
    const meta = await verifyUploadedObject("registration", audioPath);
    if (meta.size > 0) verifiedSize = meta.size;
    audioUrl = await resolveAudioReadUrl(audioPath, "registration", user.tenantId);
  } catch (e) {
    await removeObject(audioPath, { backend: getMediaBackend(), bucket: "consultation-recordings" }).catch(() => {});
    return { error: e instanceof Error ? e.message : "오디오 검증 실패" };
  }

  const { data: consult, error: insertErr } = await admin
    .from("enrollment_consultations")
    .insert({
      tenant_id: user.tenantId,
      ...buildConsultationRow(data),
      learning_history: Object.keys(learningHistory).length > 0 ? learningHistory : null,
      consultant_id: user.id,
      outcome: "consulted",
      audio_path: audioPath,
      audio_size_bytes: verifiedSize,
      processing_status: "uploaded",
    })
    .select("id")
    .single();
  if (insertErr || !consult) return { error: `상담 생성 실패: ${insertErr?.message ?? "unknown"}` };

  const webhookUrl = getAssemblyaiWebhookUrl();
  try {
    const result = await submitTranscript({
      audioUrl,
      webhookUrl,
      webhookAuthHeader: process.env.ASSEMBLYAI_WEBHOOK_SECRET
        ? { name: "x-eywa-webhook-secret", value: process.env.ASSEMBLYAI_WEBHOOK_SECRET }
        : undefined,
    });
    await admin
      .from("enrollment_consultations")
      .update({ assemblyai_transcript_id: result.id, processing_status: "transcribing" })
      .eq("id", consult.id);
  } catch (e) {
    const ko = localizeTranscriptionError(e instanceof Error ? e.message : String(e));
    await admin
      .from("enrollment_consultations")
      .update({ processing_status: "failed", processing_error: ko })
      .eq("id", consult.id);
    return { error: ko };
  }

  revalidatePath("/enrollment");
  redirect(`/enrollment/${consult.id}`);
}

export type UpdateConsultationState = { error?: string; ok?: boolean } | undefined;

/** 등록상담 레코드 수정 — 생성과 동일 필드. learning_history는 기존 키(weakSubjects 등) 보존하며 병합. */
export async function updateEnrollmentConsultation(
  _prev: UpdateConsultationState,
  formData: FormData,
): Promise<UpdateConsultationState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "enrollment"))) return { error: "등록상담 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "상담 ID가 누락되었습니다" };

  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "입력값을 확인해주세요" };
  }

  const supabase = await createClient();
  // 기존 learning_history를 읽어 prevAcademy/lastScore만 갱신(AI 파생 weakSubjects 등 보존).
  const { data: existing } = await supabase
    .from("enrollment_consultations")
    .select("learning_history")
    .eq("id", id)
    .single();
  const lh: Record<string, unknown> = { ...((existing?.learning_history as Record<string, unknown>) ?? {}) };
  if (parsed.data.prevAcademy) lh.prevAcademy = parsed.data.prevAcademy;
  else delete lh.prevAcademy;
  if (parsed.data.lastScore) lh.lastScore = parsed.data.lastScore;
  else delete lh.lastScore;

  const { error } = await supabase
    .from("enrollment_consultations")
    .update({
      ...buildConsultationRow(parsed.data),
      learning_history: Object.keys(lh).length > 0 ? lh : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/enrollment");
  revalidatePath(`/enrollment/${id}`);
  return { ok: true };
}

const OUTCOMES = [
  "pending",
  "scheduled",
  "consulted",
  "ai_done",
  "enrolled",
  "declined",
  "no_show",
] as const;
type Outcome = (typeof OUTCOMES)[number];

export type SetOutcomeState = { error?: string; ok?: boolean } | undefined;

/** 상담 상태(outcome) 수동 변경 — 칸반 컬럼(대기·예약/거절·노쇼) 활성화. */
export async function setEnrollmentOutcome(
  _prev: SetOutcomeState,
  formData: FormData,
): Promise<SetOutcomeState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "enrollment"))) return { error: "등록상담 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const outcome = String(formData.get("outcome") ?? "") as Outcome;
  if (!id) return { error: "상담 ID가 누락되었습니다" };
  if (!(OUTCOMES as readonly string[]).includes(outcome)) return { error: "유효한 상태가 아닙니다" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("enrollment_consultations")
    .update({ outcome, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/enrollment");
  revalidatePath(`/enrollment/${id}`);
  return { ok: true };
}

export type DeleteConsultationState = { error?: string } | undefined;

/**
 * 등록상담 완전 삭제(상세 페이지 인라인 확인) — deleteMeeting과 동일 패턴.
 * RLS가 테넌트 스코프를 보장하고, consultation_ai_analysis는 FK onDelete cascade(0046a)라 함께 제거된다.
 * 첨부 음성(테넌트 경로)이 있으면 Storage 객체도 정리한다. 성공 시 redirectTo(목록)로 이동.
 * ⚠️ makeedu 동기화로 들어온 상담(makeedu_id 보유)은 영구 삭제해도 다음 동기화에 additive로 다시 추가된다
 * (자체 생성 테스트 카드 = makeedu_id NULL이라 영구 삭제). 이는 의도된 동작(실데이터 안전판).
 */
export async function deleteEnrollmentConsultation(
  _prev: DeleteConsultationState,
  formData: FormData,
): Promise<DeleteConsultationState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "enrollment"))) return { error: "등록상담 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const redirectTo = String(formData.get("redirectTo") ?? "").trim();
  if (!id) return { error: "상담 ID가 누락되었습니다" };

  const supabase = await createClient();
  // RLS 스코프 — 같은 테넌트 상담만 조회/삭제. 음성 경로 정리를 위해 audio_path만 선조회.
  const { data: c } = await supabase
    .from("enrollment_consultations")
    .select("id, audio_path")
    .eq("id", id)
    .single();
  if (!c) return { error: "상담을 찾을 수 없습니다" };

  // 1) 첨부 음성(테넌트 경로) Storage 제거 — 레거시/공유 경로는 isTenantAudioPath로 걸러 미삭제.
  const audioPath = (c as { audio_path?: string | null }).audio_path;
  if (audioPath && isTenantAudioPath(audioPath, user.tenantId)) {
    await removeObject(audioPath, { backend: getMediaBackend(), bucket: "consultation-recordings" }).catch(() => {});
  }

  // 2) row 삭제(RLS). consultation_ai_analysis는 FK cascade.
  const { error } = await supabase.from("enrollment_consultations").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/enrollment");
  if (redirectTo) redirect(redirectTo);
  return undefined;
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
  // 역할 게이트 — 유료 AI 호출은 등록상담 접근권이 있는 역할만(비용통제, #S5). 데이터 누수는 RLS가 막지만
  // enrollment:none 역할도 호출 자체는 트리거할 수 있어 막는다.
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "enrollment"))) {
    return { error: "등록상담 권한이 없습니다" };
  }

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
      // 같은 날·같은 모델 재분석은 onConflict DO UPDATE라 DEFAULT가 안 먹는다 → 명시 갱신(인쇄물 '생성일' 정확).
      generated_at: new Date().toISOString(),
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
  if (!(await canWriteTenant(user.systemRole, "enrollment"))) return { error: "등록상담 권한이 없습니다" };

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

  const today = kstToday();

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
  if (!(await canWriteTenant(user.systemRole, "enrollment"))) return { error: "등록상담 권한이 없습니다" };

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

  // Verify the path is a single object key under this tenant (#S4).
  if (!isTenantAudioPath(audioPath, user.tenantId)) {
    return { error: "파일 경로가 잘못되었습니다" };
  }

  // 업로드 객체 검증(exists·size·contentType) 후 AssemblyAI가 fetch할 signed URL.
  let audioUrl: string;
  let verifiedSize = audioSizeBytes;
  try {
    const meta = await verifyUploadedObject("registration", audioPath);
    if (meta.size > 0) verifiedSize = meta.size;
    audioUrl = await resolveAudioReadUrl(audioPath, "registration", user.tenantId);
  } catch (e) {
    await removeObject(audioPath, { backend: getMediaBackend(), bucket: "consultation-recordings" }).catch(() => {});
    return { error: e instanceof Error ? e.message : "오디오 검증 실패" };
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
      audio_size_bytes: verifiedSize,
      processing_status: "uploaded",
    })
    .select("id")
    .single();

  if (insertErr || !consult) {
    return { error: `상담 생성 실패: ${insertErr?.message ?? "unknown"}` };
  }

  // Kick off AssemblyAI with webhook
  const webhookUrl = getAssemblyaiWebhookUrl();

  try {
    const result = await submitTranscript({
      audioUrl,
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
    const ko = localizeTranscriptionError(msg);
    await admin
      .from("enrollment_consultations")
      .update({ processing_status: "failed", processing_error: ko })
      .eq("id", consult.id);
    return { error: ko };
  }

  revalidatePath("/enrollment");
  redirect(`/enrollment/${consult.id}`);
}

export type UpdateConsultationReportState =
  | { error?: string; ok?: true; editedBy?: string; editedAt?: string }
  | undefined;

// 인라인 수정 가능한 12개 audioReport 섹션(extracted는 구조화 데이터라 제외).
const EDITABLE_AUDIO_KEYS = new Set([
  "consultationType",
  "familyBackground",
  "parentConcerns",
  "parentQuestions",
  "parentRequests",
  "parentSatisfaction",
  "studentTraits",
  "teacherResponse",
  "salesPoints",
  "agreements",
  "followUps",
  "warnings",
]);

/**
 * 등록상담 AI 분석 섹션 인라인 수정 — print_payload.audioReport의 해당 섹션만 머지(다른 섹션·구조화 데이터 보존)
 * + 마지막 수정자·시각 기록. ⚠️ 동결 스냅샷이지만 명시적 교정은 허용(재분석 누르면 덮어쓸 수 있음 — 명시 버튼).
 */
export async function updateConsultationReportSection(
  _prev: UpdateConsultationReportState,
  formData: FormData,
): Promise<UpdateConsultationReportState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "enrollment"))) return { error: "등록상담 권한이 없습니다" };

  const analysisId = String(formData.get("analysisId") ?? "").trim();
  const consultationId = String(formData.get("consultationId") ?? "").trim();
  const key = String(formData.get("key") ?? "").trim();
  const content = String(formData.get("content") ?? "");
  if (!analysisId) return { error: "분석 ID가 누락되었습니다" };
  if (!EDITABLE_AUDIO_KEYS.has(key)) return { error: "잘못된 섹션입니다" };

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("consultation_ai_analysis")
    .select("print_payload")
    .eq("id", analysisId)
    .single();
  if (!row) return { error: "AI 분석을 찾을 수 없습니다" };
  const pp =
    row.print_payload && typeof row.print_payload === "object"
      ? (row.print_payload as Record<string, unknown>)
      : {};
  const audioReport =
    pp.audioReport && typeof pp.audioReport === "object"
      ? (pp.audioReport as Record<string, unknown>)
      : {};
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("consultation_ai_analysis")
    .update({
      print_payload: { ...pp, audioReport: { ...audioReport, [key]: content.trim() } },
      report_edited_by: user.displayName,
      report_edited_at: now,
    })
    .eq("id", analysisId);
  if (error) return { error: error.message };

  if (consultationId) revalidatePath(`/enrollment/${consultationId}`);
  revalidatePath("/enrollment");
  return { ok: true, editedBy: user.displayName, editedAt: now };
}
