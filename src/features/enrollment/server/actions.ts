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
import { after } from "next/server";
import { combineConsultationTranscripts, type SpeakerUtterance } from "@/features/enrollment/transcripts";
import { runConsultationAnalysis } from "@/features/enrollment/server/consultation-analysis";
import { isTenantAudioPath } from "@/lib/storage/audio-path";
import {
  getMediaBackend,
  removeObject,
  resolveAudioReadUrl,
  verifyUploadedObject,
} from "@/lib/storage/media-storage";
import { localizeTranscriptionError } from "@/lib/ai/transcription-error";
import { syncMirrorAfterRecordingFailure } from "@/features/enrollment/server/recording-mirror";
import { notifyClassAssignment } from "@/features/notifications/server/notify";

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
  // 완전 이식(0064a) — ijw ConsultationForm 잔여 필드.
  counselor: opt,
  receivedDate: opt,
  studentType: opt,
  siblingsDetails: opt,
  consultationDate: opt, // 상담일 → consultation_date(전용 date 컬럼)
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
    counselor: d.counselor || null,
    received_date: d.receivedDate || null,
    student_type: d.studentType || null,
    siblings_details: d.siblingsDetails || null,
    // 상담일 = 전용 date 컬럼. consulted_at(timestamptz, 정렬용)은 폼에서 절대 건드리지 않는다
    // — timestamptz에 date 문자열을 쓰면 KST↔UTC 하루밀림·시각 소실이 생김(적대리뷰 확정).
    consultation_date: d.consultationDate || null,
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
 * 녹음 동반 등록상담 생성 — 구조화 필드(buildConsultationRow)로 행을 만들고 녹음 행을 추가한 뒤
 * AssemblyAI 전사를 시작한다. (옛 오디오 전용 액션 startConsultationFromAudio는 통합 폼 전환으로
 * 호출처 0이 되어 삭제 — 2026-07-02, 녹음=여러 행 전환과 함께.)
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
      // 단일 오디오 컬럼 = "최신 녹음 미러"(목록 🎙️ 배지·StatusWatcher 레거시 소비처용).
      audio_path: audioPath,
      audio_size_bytes: verifiedSize,
      processing_status: "uploaded",
    })
    .select("id")
    .single();
  if (insertErr || !consult) return { error: `상담 생성 실패: ${insertErr?.message ?? "unknown"}` };

  const err = await insertRecordingAndTranscribe(admin, {
    tenantId: user.tenantId,
    consultationId: consult.id,
    audioPath,
    audioSizeBytes: verifiedSize,
    recordedBy: user.id,
    audioUrl,
  });
  if (err) return { error: err };

  revalidatePath("/enrollment");
  redirect(`/enrollment/${consult.id}`);
}

/**
 * 녹음 행(consultation_recordings) 생성 + AssemblyAI 전사 제출 — 생성/수정 오디오 첨부가 공유하는 tail.
 * 녹음은 **행으로 누적**된다(여러 상담사가 각자 추가, 사용자 결정 2026-07-02). 성공 시
 * 녹음 행에 assemblyai_transcript_id + 'transcribing', 상담 행 미러도 'transcribing'.
 * 실패 시 녹음 행·상담 미러 둘 다 'failed'+한글 오류. 반환: null(성공) | 한글 오류 문자열.
 * 웹훅(handleConsultationRecording)이 전사 완료 후 "완료된 전체 녹음 합본"으로 13섹션 분석을 이어받는다.
 */
async function insertRecordingAndTranscribe(
  admin: ReturnType<typeof createAdminClient>,
  args: {
    tenantId: string;
    consultationId: string;
    audioPath: string;
    audioSizeBytes: number;
    recordedBy: string;
    audioUrl: string;
  },
): Promise<string | null> {
  const { data: rec, error: recErr } = await admin
    .from("consultation_recordings")
    .insert({
      tenant_id: args.tenantId,
      consultation_id: args.consultationId,
      audio_path: args.audioPath,
      audio_size_bytes: args.audioSizeBytes,
      recorded_by: args.recordedBy,
      processing_status: "uploaded",
    })
    .select("id")
    .single();
  if (recErr || !rec) return `녹음 행 생성 실패: ${recErr?.message ?? "unknown"}`;

  const webhookUrl = getAssemblyaiWebhookUrl();
  try {
    const result = await submitTranscript({
      audioUrl: args.audioUrl,
      webhookUrl,
      webhookAuthHeader: process.env.ASSEMBLYAI_WEBHOOK_SECRET
        ? { name: "x-eywa-webhook-secret", value: process.env.ASSEMBLYAI_WEBHOOK_SECRET }
        : undefined,
    });
    // ⚠️ transcript id는 녹음 행에만 — 상담 행에 미러하면 웹훅이 레거시 경로로 이중 매칭된다.
    await admin
      .from("consultation_recordings")
      .update({
        assemblyai_transcript_id: result.id,
        processing_status: "transcribing",
        updated_at: new Date().toISOString(),
      })
      .eq("id", rec.id);
    await admin
      .from("enrollment_consultations")
      .update({ processing_status: "transcribing", updated_at: new Date().toISOString() })
      .eq("id", args.consultationId);
    return null;
  } catch (e) {
    const ko = localizeTranscriptionError(e instanceof Error ? e.message : String(e));
    // 행은 failed로 남긴다(오디오 객체는 이미 업로드됨 — 실녹음 유실 방지 위해 삭제 안 함).
    await admin
      .from("consultation_recordings")
      .update({ processing_status: "failed", processing_error: ko, updated_at: new Date().toISOString() })
      .eq("id", rec.id);
    // 상담 미러 — 완료 녹음이 있으면 completed 복원(상담 전체 실패 오표시 방지, 적대리뷰 #7/#9).
    await syncMirrorAfterRecordingFailure(admin, args.consultationId, ko);
    return ko;
  }
}

/**
 * 기존 등록상담에 새 녹음을 **추가**하고 전사·분석을 재실행 — 수정 폼 녹음
 * (QR 접수건·기존 상담을 상담사가 수정하며 녹음)용. 기존 녹음 행은 그대로 보존되고 새 행이 쌓인다.
 * 전사 완료 시 웹훅이 완료된 전체 녹음 합본으로 13섹션을 재생성(buildFormPatch는 빈 필드만 보강 → 수기 입력 보존).
 * 반환: null(성공) | 한글 오류 문자열(검증/전사 실패). ⚠️ verifyUploadedObject 실패 시 방금 올린 객체를 정리한다.
 */
async function attachAudioAndTranscribe(
  user: { id: string; tenantId: string },
  consultId: string,
  audioPath: string,
  audioSizeBytes: number,
): Promise<string | null> {
  if (!isTenantAudioPath(audioPath, user.tenantId)) return "파일 경로가 잘못되었습니다";
  const admin = createAdminClient();

  let audioUrl: string;
  let verifiedSize = audioSizeBytes;
  try {
    const meta = await verifyUploadedObject("registration", audioPath);
    if (meta.size > 0) verifiedSize = meta.size;
    audioUrl = await resolveAudioReadUrl(audioPath, "registration", user.tenantId);
  } catch (e) {
    await removeObject(audioPath, { backend: getMediaBackend(), bucket: "consultation-recordings" }).catch(() => {});
    return e instanceof Error ? e.message : "오디오 검증 실패";
  }

  // 상담 행 미러(최신 녹음) — 목록 🎙️ 배지·상세 진행 배너가 이 컬럼을 본다. 기존 녹음 행은 불변.
  // ⚠️ .select()로 실제 갱신된 행을 확인 — admin client(RLS 우회)라 0행 no-op이 조용히 통과하면
  // 타 테넌트 상담 id에 녹음을 붙이고 웹훅이 그 상담에 분석을 쓰는 크로스 테넌트 홀이 된다.
  const { data: mirrored, error: updErr } = await admin
    .from("enrollment_consultations")
    .update({
      audio_path: audioPath,
      audio_size_bytes: verifiedSize,
      processing_status: "uploaded",
      processing_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", consultId)
    .eq("tenant_id", user.tenantId)
    .select("id")
    .maybeSingle();
  if (updErr) return `음성 첨부 실패: ${updErr.message}`;
  if (!mirrored) {
    // 소유권 불일치(타 테넌트 id 변조 등) — 방금 올린 객체 정리 후 거부.
    await removeObject(audioPath, { backend: getMediaBackend(), bucket: "consultation-recordings" }).catch(() => {});
    return "상담을 찾을 수 없습니다";
  }

  return insertRecordingAndTranscribe(admin, {
    tenantId: user.tenantId,
    consultationId: consultId,
    audioPath,
    audioSizeBytes: verifiedSize,
    recordedBy: user.id,
    audioUrl,
  });
}

// saved=true인 error는 "필드는 저장됐고 녹음 첨부만 실패"(부분 성공) — 클라가 미저장 가드를 해제(markSaved)하되 재시도 안내는 유지.
export type UpdateConsultationState = { error?: string; ok?: boolean; saved?: boolean } | undefined;

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

  // QR 접수(대기·예약) 재저장 확인 팝업의 "상담 완료로 저장" 선택 — 아래에서 서버 조건 재검증 후 전환.
  const markConsulted = String(formData.get("markConsulted") ?? "") === "1";

  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "입력값을 확인해주세요" };
  }

  const supabase = await createClient();
  // 기존 learning_history를 읽어 prevAcademy/lastScore만 갱신(AI 파생 weakSubjects 등 보존).
  const { data: existing } = await supabase
    .from("enrollment_consultations")
    .select("learning_history, outcome, from_public_intake")
    .eq("id", id)
    .single();
  const lh: Record<string, unknown> = { ...((existing?.learning_history as Record<string, unknown>) ?? {}) };
  if (parsed.data.prevAcademy) lh.prevAcademy = parsed.data.prevAcademy;
  else delete lh.prevAcademy;
  if (parsed.data.lastScore) lh.lastScore = parsed.data.lastScore;
  else delete lh.lastScore;

  // 상담 완료 전환은 QR 접수건 + 현재 대기·예약(pending/scheduled)일 때만(클라 조작·낡은 폼 방어).
  const promoteToConsulted =
    markConsulted &&
    !!existing?.from_public_intake &&
    ["pending", "scheduled"].includes(String(existing?.outcome ?? ""));

  const { error } = await supabase
    .from("enrollment_consultations")
    .update({
      ...buildConsultationRow(parsed.data),
      learning_history: Object.keys(lh).length > 0 ? lh : null,
      ...(promoteToConsulted ? { outcome: "consulted" } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return { error: error.message };

  // 수정 중 새 녹음 첨부(QR 접수건을 상담사가 수정하며 상담 녹음) — 전사·13섹션 분석 재실행.
  const audioPath = String(formData.get("audioPath") ?? "").trim();
  if (audioPath) {
    const audioErr = await attachAudioAndTranscribe(
      user,
      id,
      audioPath,
      Number(formData.get("audioSizeBytes") ?? 0),
    );
    if (audioErr) {
      // 필드 UPDATE는 이미 커밋됐다 — "전체 실패"로 오독되지 않게 명시(적대리뷰 #7). 재저장해도
      // 필드는 멱등이고 녹음만 다시 첨부되므로 그대로 다시 저장하면 된다.
      revalidatePath("/enrollment");
      revalidatePath(`/enrollment/${id}`);
      return { error: `입력 내용은 저장되었습니다. 녹음 첨부만 실패: ${audioErr}`, saved: true };
    }
  }

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

  // 실제 등록(전환) 완료된 상담만 이전 단계로 되돌릴 수 없다 — 취소는 '거절'로만.
  // ⚠️ 단순 student_id 연결(연결됨)은 '전환됨'이 아니다(0113a): 기존 재원생이 QR로 새 상담을 내면
  // 자동연결로 student_id는 붙지만 outcome은 'pending'이라 상담사가 파이프라인을 정상 진행해야 한다.
  // 따라서 전환 판정은 outcome==='enrolled'만(연결 여부로 상태 이동을 막지 않음).
  const { data: cur } = await supabase
    .from("enrollment_consultations")
    .select("outcome")
    .eq("id", id)
    .single();
  if (!cur) return { error: "상담을 찾을 수 없습니다" };
  const isConverted = cur.outcome === "enrolled";
  if (isConverted && outcome !== "enrolled" && outcome !== "declined") {
    return {
      error:
        "이미 배정 완료(등록)된 상담은 대기·예약 등 이전 단계로 되돌릴 수 없습니다. 취소하려면 '거절'로 처리하거나 학생을 퇴원 처리하세요.",
    };
  }

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

  // 1) 첨부 음성(테넌트 경로) Storage 제거 — 녹음 행 전체 + 레거시 단일 컬럼(미러) 합쳐 dedupe.
  //    레거시/공유 경로는 isTenantAudioPath로 걸러 미삭제. 행 자체는 FK cascade로 함께 삭제된다.
  const { data: recRows } = await supabase
    .from("consultation_recordings")
    .select("audio_path")
    .eq("consultation_id", id);
  const paths = new Set<string>(
    [(c as { audio_path?: string | null }).audio_path, ...(recRows ?? []).map((r) => r.audio_path)]
      .filter((p): p is string => !!p && isTenantAudioPath(p, user.tenantId)),
  );
  for (const p of paths) {
    await removeObject(p, { backend: getMediaBackend(), bucket: "consultation-recordings" }).catch(() => {});
  }

  // 2) row 삭제(RLS). consultation_ai_analysis·consultation_recordings는 FK cascade.
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

// ⚠️ 여기 있던 stubAnalysis()는 2026-07-22 전수검사로 제거했다(재도입 금지).
// AI 호출이 실패하면 "기초 학력 양호·성실한 학습 태도" 같은 **아무 학생에게나 통하는 가짜 진단**을
// 만들어 DB에 커밋하고 outcome까지 'ai_done'으로 바꿨다. 그 값은 담임 인수인계 인쇄물에 그대로 실린다
// (analyzeMeeting·analyzeStudentConsultation·재분석 등 형제 액션은 전부 실패를 실패로 표면화한다).
// 실데이터 확인 결과 model_version='stub*' 행은 0건 — 한 번도 안 터졌을 뿐 배선은 살아 있었다.

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
      "id, prospect_name, prospect_grade, prospect_school, parent_name, parent_phone, parent_request, learning_history, consultation_date, consulted_at, consultant_id",
    )
    .eq("id", consultationId)
    .single();

  if (!c) return { error: "상담을 찾을 수 없습니다" };

  // 상담사 이름 — print_payload.consultantName의 소스. consultant_id는 예전부터 select만 하고
  // 한 번도 안 썼다(인쇄물 '상담사' 칸이 항상 "—"였던 원인, 2026-07-22 전수검사).
  const [{ data: classes }, { data: consultant }] = await Promise.all([
    supabase.from("classes").select("id, class_name, subject").eq("is_active", true),
    c.consultant_id
      ? supabase.from("users").select("display_name").eq("id", c.consultant_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const gradePrefix = (c.prospect_grade ?? "").slice(0, 2);
  const matchingClasses = (classes ?? []).filter((cl) =>
    gradePrefix ? cl.class_name.includes(gradePrefix) : false,
  );

  let analysis: AnalysisShape;
  let modelId: string;
  try {
    const { data, model } = await generateJSON<AnalysisShape>({
      maxTokens: 2048,
      meta: { feature: "enrollment_text_analysis" },
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
  } catch (e) {
    // 실패는 실패로 — 가짜 분석을 만들어 저장하지 않는다(위 stubAnalysis 주석 참조).
    // 원문은 서버 로그로만(UI에 기술 원문 노출 금지), 화면엔 한글 안내 + 재시도 유도.
    console.error("[runAiAnalysis] AI 분석 실패", e);
    return { error: "AI 분석에 실패했습니다 — 잠시 후 다시 시도해 주세요" };
  }

  const printPayload = {
    prospect: {
      name: c.prospect_name,
      grade: c.prospect_grade,
      school: c.prospect_school,
      // ⚠️ 예전엔 셋 다 null 리터럴이라 인수인계 인쇄물의 '학부모 (연락처)'·'상담사' 칸이 항상 "—"였다
      // (녹음 웹훅 경로는 채우고 있어 "어떤 상담은 되고 어떤 상담은 안 되는" 형태였음).
      parentName: c.parent_name,
      parentPhone: c.parent_phone,
    },
    // ⚠️ 상담일 = 사람이 편집하는 consultation_date(date). consulted_at은 정렬용 레코드 타임스탬프라
    // 3월 상담을 7월에 입력하거나 makeedu에서 넘어온 건이면 화면 '상담일'과 인쇄물이 어긋난다
    // (화면: f.consultationDate ?? consulted_at 폴백과 같은 순서로 맞춘 것).
    consultedAt: c.consultation_date ?? c.consulted_at,
    consultantName: consultant?.display_name ?? null,
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

export type ConvertToStudentState =
  | { error?: string; studentId?: string; existingStudentId?: string }
  | undefined;

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

  // form에서 다중 class id 받음 (최소 1개 — 아래 검증)
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

  if (cErr || !c) return { error: "상담 정보를 불러오지 못했습니다" };

  if (c.student_id) {
    // 이미 연결된 학생이 있으면 그 학생으로 이동
    return { studentId: c.student_id };
  }

  // 수업 배정 = 반 최소 1개 필수(클라 disabled와 이중 방어). 반 없이 학생만 만들면 "배정 완료"에 안 잡혀 애매.
  if (classIds.length === 0) return { error: "배정할 반을 1개 이상 선택하세요" };

  // 반이 전부 본 테넌트 것인지 검증(RLS 스코프) — enrollments RLS가 class_id 테넌트를 안 봐서
  // 조작된 foreign class id로 유령 수강·타 테넌트 알림이 생기는 것 방어(적대리뷰).
  const { data: validClasses } = await supabase.from("classes").select("id").in("id", classIds);
  const validClassIds = new Set((validClasses ?? []).map((c) => c.id));
  if (classIds.some((id) => !validClassIds.has(id))) {
    return { error: "배정할 반을 찾을 수 없습니다" };
  }

  const today = kstToday();

  // 자연키(같은 이름·학교·학년의 재원 학생) 값 — 중복 안내에도 재사용.
  const studentName = overrideName || c.prospect_name;
  const studentSchool = overrideSchool ?? c.prospect_school;
  const studentGrade = overrideGrade ?? c.prospect_grade;

  // students INSERT
  const { data: stu, error: stuErr } = await supabase
    .from("students")
    .insert({
      tenant_id: c.tenant_id,
      name: studentName,
      grade: studentGrade,
      school: studentSchool,
      parent_name: overrideParentName ?? c.parent_name,
      parent_phone: overrideParentPhone ?? c.parent_phone,
      status: "enrolled",
      enrolled_at: today,
    })
    .select("id")
    .single();

  // 학생 확정: 생성 성공이면 그 id, 자연키 충돌(이미 재원 학생 — 대개 makeedu 왕복)이면 기존 학생 재사용(B).
  let studentId: string;
  let reusedExisting = false;
  if (stu && !stuErr) {
    studentId = stu.id;
  } else {
    const isDuplicate =
      stuErr?.code === "23505" || /duplicate key|natural_key/i.test(stuErr?.message ?? "");
    if (!isDuplicate) {
      console.error("[convertConsultationToStudent] 학생 생성 실패", stuErr);
      return { error: "학생을 생성하지 못했습니다. 잠시 후 다시 시도하거나 관리자에게 문의하세요." };
    }
    // 같은 자연키(정규화 이름 + 학교·학년)의 기존 재원 학생을 찾아 재사용 — 원본 에러 노출 없이 매끄럽게 해소.
    const norm = studentName.toLowerCase().replace(/\s+/g, "");
    const { data: candidates } = await supabase
      .from("students")
      .select("id, school, grade")
      .eq("tenant_id", c.tenant_id)
      .eq("name_normalized", norm)
      .neq("status", "withdrawn");
    const existing = (candidates ?? []).find(
      (s) => (s.school ?? "") === (studentSchool ?? "") && (s.grade ?? "") === (studentGrade ?? ""),
    );
    if (!existing) {
      // 폴백(A): 충돌은 났으나 정확 매칭 실패(정규화 차이 등) → 친절 안내 + (있으면) 기존 학생 링크.
      const who = [studentName, studentSchool, studentGrade].filter(Boolean).join(" · ");
      return {
        error: `이미 같은 이름·학교·학년의 재원 학생이 있습니다 (${who}). 학생 목록에서 그 학생에 반을 배정해 주세요.`,
        existingStudentId: candidates?.[0]?.id,
      };
    }
    studentId = existing.id;
    reusedExisting = true;
  }

  // enrollments 배정 — 기존 학생 재사용 시 이미 등록된 반은 제외(중복 배정·제약 위반 방지).
  let assignClassIds = classIds;
  if (reusedExisting) {
    const { data: already } = await supabase
      .from("enrollments")
      .select("class_id")
      .eq("student_id", studentId)
      .in("class_id", classIds);
    const inSet = new Set((already ?? []).map((e) => e.class_id as string));
    assignClassIds = classIds.filter((id) => !inSet.has(id));
  }
  if (assignClassIds.length > 0) {
    const rows = assignClassIds.map((classId) => ({
      tenant_id: c.tenant_id,
      student_id: studentId,
      class_id: classId,
      start_date: today,
    }));
    const { error: enrErr } = await supabase.from("enrollments").insert(rows);
    if (enrErr) {
      // 원본 메시지 대신 친절 안내(학생 ID는 반환해 이동 유도).
      console.error("[convertConsultationToStudent] 반 배정 실패", enrErr);
      return {
        error: "학생은 준비됐으나 반 배정에 실패했습니다. 학생 상세에서 반을 배정해 주세요.",
        studentId,
      };
    }
    // 배정된 반들의 담임에게 인앱 알림 — best-effort.
    await notifyClassAssignment({
      tenantId: c.tenant_id,
      actorId: user.id,
      assignments: assignClassIds.map((classId) => ({ classId, studentId })),
      type: "enrollment_assigned",
    });
  }

  // 상담에 학생 ID + outcome=enrolled 연결(재사용/신규 모두 — orphan 상담 해소).
  await supabase
    .from("enrollment_consultations")
    .update({ student_id: studentId, outcome: "enrolled" })
    .eq("id", consultationId);

  revalidatePath("/enrollment");
  revalidatePath(`/enrollment/${consultationId}`);
  revalidatePath("/students");
  return { studentId };
}


export type UpdateConsultationReportState =
  | { error?: string; ok?: true; editedBy?: string; editedAt?: string }
  | undefined;

// 인라인 수정 가능한 11개 audioReport 섹션(extracted는 구조화 데이터라 제외).
const EDITABLE_AUDIO_KEYS = new Set([
  "consultationType",
  "summary",
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

/**
 * 등록상담 AI 분석 재실행(재분석) — 저장된 전사(완료 녹음 합본 또는 레거시 단일 전사)로 심층분석을
 * 다시 돌려 print_payload.audioReport(섹션) + speakerRoles만 새로 덮는다. diagnosis/learning_plan/
 * prospect/formSuggestions·폼 자동입력은 건드리지 않는다(상담사 수기 입력 보호). 무거운 분석은 after()
 * 백그라운드 — 즉시 '분석 중' 표시(회의 재분석과 동일 UX). ⚠️ 프롬프트는 웹훅과 동일 단일 소스(consultation-analysis.ts).
 */
export async function regenerateConsultationAnalysis(
  consultationId: string,
): Promise<{ ok?: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "enrollment"))) return { error: "등록상담 권한이 없습니다" };
  if (!consultationId) return { error: "상담 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { data: consult } = await supabase
    .from("enrollment_consultations")
    .select(
      "id, prospect_name, prospect_grade, prospect_school, parent_name, parent_phone, transcription, processing_status, updated_at",
    )
    .eq("id", consultationId)
    .single();
  if (!consult) return { error: "상담을 찾을 수 없습니다" };

  // 완료 녹음 합본 우선, 없으면 레거시 단일 전사.
  const { data: recs } = await supabase
    .from("consultation_recordings")
    .select("transcription, speaker_labels, created_at")
    .eq("consultation_id", consultationId)
    .eq("processing_status", "completed")
    .order("created_at", { ascending: true });
  const inputs = (recs ?? []).map((r) => ({
    utterances: Array.isArray(r.speaker_labels) ? (r.speaker_labels as SpeakerUtterance[]) : null,
    plainText: r.transcription as string | null,
    recordedAt: r.created_at as string,
  }));
  const nonEmpty = inputs.filter(
    (i) => (i.utterances?.length ?? 0) > 0 || (i.plainText ?? "").trim().length > 0,
  );
  const formatted =
    nonEmpty.length > 0
      ? combineConsultationTranscripts(nonEmpty)
      : (consult.transcription ?? "").trim();
  const multi = nonEmpty.length > 1;
  if (!formatted.trim())
    return { error: "재분석할 전사가 없습니다. 녹음/전사가 남아 있어야 재분석할 수 있어요." };

  // 기존 분석 행 — 재분석은 이 행의 섹션만 갱신(diagnosis/learning_plan 등 보존).
  const { data: existing } = await supabase
    .from("consultation_ai_analysis")
    .select("id, print_payload")
    .eq("consultation_id", consultationId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!existing) return { error: "기존 AI 분석이 없어 재분석할 수 없습니다. 먼저 분석을 실행하세요." };

  // 원자적 claim(동시 재분석 방어) — '분석 중'이 아닐 때만 상태를 선점한다. 여러 명이 동시에 눌러도
  // DB update가 원자적이라 한 명만 1행을 claim하고(select로 확인) 나머지는 0행 → "이미 진행 중" 안내.
  // 단, 5분 넘게 '분석 중'에 멈춘 stuck(after() 크래시/타임아웃)은 재실행 허용(neq 가드 우회).
  const now = new Date();
  const analyzingStuck =
    consult.processing_status === "analyzing" &&
    now.getTime() - new Date(consult.updated_at).getTime() > 5 * 60 * 1000;
  const admin = createAdminClient();
  let claim = admin
    .from("enrollment_consultations")
    .update({ processing_status: "analyzing", processing_error: null, updated_at: now.toISOString() })
    .eq("id", consultationId);
  if (!analyzingStuck) claim = claim.neq("processing_status", "analyzing");
  const { data: claimed } = await claim.select("id");
  if (!claimed || claimed.length === 0) {
    return { error: "이미 재분석이 진행 중입니다. 완료되면 화면이 자동으로 갱신됩니다." };
  }
  revalidatePath(`/enrollment/${consultationId}`);
  revalidatePath("/enrollment");

  const ctx = {
    prospect_name: consult.prospect_name,
    prospect_grade: consult.prospect_grade,
    prospect_school: consult.prospect_school,
    parent_name: consult.parent_name,
    parent_phone: consult.parent_phone,
  };
  const analysisId = existing.id;
  const priorPayload =
    existing.print_payload && typeof existing.print_payload === "object"
      ? (existing.print_payload as Record<string, unknown>)
      : {};

  // 무거운 분석은 응답 후 백그라운드(after). 완료 시 StatusWatcher가 새 결과로 갱신.
  after(async () => {
    const bg = createAdminClient();
    try {
      const { data: report, model } = await runConsultationAnalysis(ctx, formatted, multi);
      const { speakerRoles, ...sections } = report;
      const now = new Date().toISOString();
      await bg
        .from("consultation_ai_analysis")
        .update({
          print_payload: {
            ...priorPayload,
            audioReport: sections,
            speakerRoles: speakerRoles ?? priorPayload.speakerRoles ?? {},
          },
          model_version: `${model}-${now.slice(0, 10)}`,
          generated_at: now,
          // 재분석 = 새 AI 결과 → 이전 사람 수정 이력 초기화(덮어쓰기 의미 명확).
          report_edited_by: null,
          report_edited_at: null,
        })
        .eq("id", analysisId);
      await bg
        .from("enrollment_consultations")
        .update({ processing_status: "completed", processing_error: null, updated_at: now })
        .eq("id", consultationId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await bg
        .from("enrollment_consultations")
        .update({ processing_status: "failed", processing_error: `AI 재분석 실패: ${msg}` })
        .eq("id", consultationId);
    }
  });

  return { ok: true };
}

/**
 * AI 분석의 '상담 요약'을 상담 내용(parent_request)에 채운다/덧붙인다 — 원장 요청("AI 분석을 상담 내용에 추가").
 * 비어 있으면 요약으로 채우고, 이미 값이 있으면 구분선 아래로 덧붙인다(기존 상담 내용 보존).
 */
export async function appendAiSummaryToConsultationContent(
  consultationId: string,
): Promise<{ ok?: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "enrollment"))) return { error: "등록상담 권한이 없습니다" };
  if (!consultationId) return { error: "상담 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { data: consult } = await supabase
    .from("enrollment_consultations")
    .select("id, parent_request")
    .eq("id", consultationId)
    .single();
  if (!consult) return { error: "상담을 찾을 수 없습니다" };

  const { data: ai } = await supabase
    .from("consultation_ai_analysis")
    .select("print_payload")
    .eq("consultation_id", consultationId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const pp =
    ai?.print_payload && typeof ai.print_payload === "object"
      ? (ai.print_payload as Record<string, unknown>)
      : null;
  const audioReport =
    pp?.audioReport && typeof pp.audioReport === "object"
      ? (pp.audioReport as Record<string, unknown>)
      : null;
  const summary = typeof audioReport?.summary === "string" ? audioReport.summary.trim() : "";
  if (!summary) return { error: "추가할 AI 요약이 없습니다. 먼저 분석/재분석을 실행하세요." };

  const existing = (consult.parent_request ?? "").trim();
  // 멱등성 — 같은 요약을 반복해서 덧붙이지 않는다(버튼 여러 번 눌러도 중복 누적 방지).
  if (existing.includes(summary)) {
    return { error: "이미 이 AI 요약이 상담 내용에 들어 있습니다." };
  }
  const next = existing ? `${existing}\n\n— AI 상담 요약 —\n${summary}` : summary;

  const { error } = await supabase
    .from("enrollment_consultations")
    .update({ parent_request: next, updated_at: new Date().toISOString() })
    .eq("id", consultationId);
  if (error) return { error: error.message };

  revalidatePath(`/enrollment/${consultationId}`);
  revalidatePath("/enrollment");
  return { ok: true };
}
