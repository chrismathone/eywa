"use server";

import { seatBlockReason } from "@/lib/license/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { submitTranscript } from "@/lib/ai/assemblyai";
import { getAssemblyaiWebhookUrl } from "@/lib/config/app-url";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { kstToday } from "@/lib/date-kst";
import { countAssignedClasses } from "./assigned-classes";
import { licenseBlockReason } from "@/lib/license/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { explainDbError, logDbError } from "@/lib/supabase/db-error";
import { resolveUniqueStudentNameFor } from "@/features/students/server/unique-name";
import { after } from "next/server";
import { ASSIGNED_DRAG_BLOCKED, ENROLLED_REVERT_BLOCKED, stageOfOutcome } from "@/features/enrollment/board-stages";
import { normalizeAssignStartDate } from "@/features/enrollment/assign-start-date";
import { canonicalSchoolName, type SchoolSaveAlias } from "@/features/schools/school-name";
import { completeSchoolKind } from "@/features/schools/server/complete-kind";
import { combineConsultationTranscripts, type SpeakerUtterance } from "@/features/enrollment/transcripts";
import { runConsultationAnalysis } from "@/features/enrollment/server/consultation-analysis";
import { isTenantAudioPath } from "@/lib/storage/audio-path";
import {
  removeObject,
  resolveAudioReadUrl,
  verifyUploadedObject,
} from "@/lib/storage/media-storage";
import { localizeTranscriptionError } from "@/lib/ai/transcription-error";
import { syncMirrorAfterRecordingFailure } from "@/features/enrollment/server/recording-mirror";
import { notifyClassAssignment } from "@/features/notifications/server/notify";
import { logAction } from "@/features/audit/server/log";
import { getTenantSettings } from "@/features/owner/server/queries";
import { createSchema, buildConsultationRow, type FullForm } from "@/features/enrollment/consultation-form-row";
import { counselorAutofill } from "@/features/enrollment/consultation-edit";
import { counselorAccountPatch } from "@/features/enrollment/counselor-account";
import { resolveCounselorAccount } from "@/features/enrollment/server/counselor-account";
import { changedColumns, effectiveFollowUp, mergeSubjectDetails, parseEditBase } from "@/features/enrollment/consultation-changed";
import { parseFollowUpResult, resolveFollowUp, type FollowUpResult } from "@/features/enrollment/follow-up";
import { summarizeConsultationChanges } from "@/features/enrollment/consultation-audit";
import { referrerChanged, referrerColumns, referrerColumnsOf, type ReferrerColumns } from "@/features/enrollment/referrer";
import { readReferrerBefore, referrerLabelOf } from "@/features/enrollment/server/referrer-queries";
import type { SupabaseClient } from "@supabase/supabase-js";

// 🔑 행위자 = '다른 강사 뷰'의 대상 직원(`getCurrentUser({ teacherView: true })`, 강사뷰가 아니면 본인) — 상담자 계정(consultant_id)·
//    녹음한 사람(recorded_by)·빈 상담자 자동 채움·AI 리포트 수정자·배정 알림의 유발자가 대상 명의다(출결 recorded_by와 같은 규약,
//    원장 2026-11-05 강사뷰 전수). 등록상담 표들은 지점 격리 RLS뿐이라 세션 클라이언트로 대상 명의를 쓸 수 있다. '읽기' 강사뷰는
//    canWriteTenant가 막는다. 감사로그 행위자만 로그인 계정이다(logAction이 스스로 읽는다).

/** DB 오류 → 화면용 한글 이유 + 로그(scope로 Vercel 로그 검색, [[#138]]). 모르는 오류면 fallback 그대로 — 영문 원문은 안 내보낸다. */
function dbWhy(error: unknown, scope: string, fallback: string, op?: "write" | "delete"): string {
  return explainDbError(error, { scope, fallback, op }).message;
}

/** 폼 → DB 컬럼(공통). learning_history·tenant_id·consultant_id·outcome는 호출부에서 별도 처리. */
/** 학교명 저장 별칭(학원설정) — 침산 = 일중→대구일중, 새 학원 = 없음. 요청 캐시라 한 요청에 여러 번 불러도 조회 1회. */
async function schoolAliases(): Promise<readonly SchoolSaveAlias[]> {
  return (await getTenantSettings()).operations.schoolSaveAliases;
}

/** 폼 행의 학교에 빠진 학교급을 채운다(`칠성` + `초5` → `칠성초` · 학교알리미에 있는 학교만 — `completeSchoolKind`). */
async function withSchoolKind<T extends { prospect_school: string | null; prospect_grade: string | null }>(
  client: Parameters<typeof completeSchoolKind>[0],
  tenantId: string,
  row: T,
): Promise<T> {
  const aliases = await schoolAliases();
  return { ...row, prospect_school: await completeSchoolKind(client, tenantId, row.prospect_school, row.prospect_grade, aliases) };
}

export type CreateConsultationState = { error?: string; id?: string } | undefined;

export async function createEnrollmentConsultation(
  _prev: CreateConsultationState,
  formData: FormData,
): Promise<CreateConsultationState> {
  const parsed = createSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "입력값을 확인해주세요" };
  }

  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "enrollment"))) return { error: "신규 콜&상담 권한이 없습니다" };

  // 🔴 유입경로는 **신규 생성일 때만** 필수(원장 2026-08-04). 화면 `required`는 게이트가 아니라서
  // (#77) 서버에서도 막는다. 단 `createSchema`는 수정 액션과 공유하므로 스키마에 required를 넣지 않는다 —
  // 넣으면 경로가 비어 있는 옛 상담(2023~2025, 기재율 31%)을 **수정할 때마다** 모르는 값을 고르게 되고,
  // 지어낸 경로는 미기재보다 나쁘다(틀린 값은 아무도 못 알아본다).
  if (!parsed.data.consultationPath) return { error: "상담 경로를 선택해주세요" };
  // 후속 조치(원장 2026-10-22 *"후속 조치를 선택이 아닌 필수로 … 자동적으로 등록, 미등록으로 처리"*) — 직원이 쓰는 상담은 상담을 한 뒤라
  // 반드시 고른다(등록 · 미등록 · 다음 상담). 고른 값이 상태를 정한다(follow-up.ts — 화면도 같은 함수로 미리 막는다, #77).
  const followUpResult = parseFollowUpResult(formData.get("followUpResult"));
  const followUp = resolveFollowUp({
    current: "consulted",
    result: followUpResult,
    followUpDate: parsed.data.followUpDate || null,
    storedDate: null,
    today: kstToday(),
  });
  if ("error" in followUp) return { error: followUp.error };
  // 소개한 사람(0362a) — 폼에 칸이 있을 때만 쓴다. 같은 학원 사람인지는 DB 트리거가 막는다.
  const referrer = referrerColumns(formData);
  if ("error" in referrer) return { error: referrer.error };

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
      referrer.cols,
      { ...followUp, result: followUpResult },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("enrollment_consultations")
    .insert({
      tenant_id: user.tenantId,
      ...(await withSchoolKind(supabase, user.tenantId, buildConsultationRow(parsed.data, await schoolAliases()))),
      ...referrer.cols,
      learning_history: Object.keys(learningHistory).length > 0 ? learningHistory : null,
      // 상담자 계정 = 적은 상담자 이름의 직원(딱 한 명일 때) · 없으면 추가한 사람(counselor-account.ts — 할 일·알림이 이 칸을 본다).
      consultant_id: (await resolveCounselorAccount(supabase, user.tenantId, parsed.data.counselor)) ?? user.id,
      outcome: followUp.outcome,
    })
    .select("id")
    .single();

  if (error || !data) return { error: dbWhy(error, "enrollment.create", "상담을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.") };

  // 등록상담 전수 감사로그(2026-09-10 김근우 건) — 등록상담은 작성·수정·상태·삭제 어느 것도 흔적이 없었다.
  await logAction({
    action: "enrollment_consultation_create",
    targetType: "enrollment_consultations",
    targetLabel: parsed.data.prospectName,
    metadata: {
      consultationId: data.id, subject: parsed.data.subject || null, followUp: followUpResult, outcome: followUp.outcome,
      // 소개한 사람 — 강사평가 원생 소개 점수에 바로 들어가는 값이라 누구로 이었는지 남긴다.
      ...(referrer.cols.referrer_student_id || referrer.cols.referrer_staff_id
        ? { referrer: await referrerLabelOf(supabase as unknown as SupabaseClient, referrer.cols) } : {}),
    },
  });

  revalidatePath("/enrollment");
  return { id: data.id };
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
  referrer: Partial<ReferrerColumns>,
  followUp: { outcome: string; result: FollowUpResult | null },
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
    await removeObject(audioPath, { bucket: "consultation-recordings" }).catch(() => {});
    return { error: e instanceof Error ? e.message : "오디오 검증 실패" };
  }

  const { data: consult, error: insertErr } = await admin
    .from("enrollment_consultations")
    .insert({
      tenant_id: user.tenantId,
      ...(await withSchoolKind(admin, user.tenantId, buildConsultationRow(data, await schoolAliases()))),
      ...referrer,
      learning_history: Object.keys(learningHistory).length > 0 ? learningHistory : null,
      consultant_id: (await resolveCounselorAccount(admin, user.tenantId, data.counselor)) ?? user.id,
      // 후속 조치로 고른 상태(등록·미등록이면 녹음 분석이 끝나도 그대로 — 웹훅은 끝난 상태를 지킨다).
      outcome: followUp.outcome,
      // 단일 오디오 컬럼 = "최신 녹음 미러"(목록 🎙️ 배지·StatusWatcher 레거시 소비처용).
      audio_path: audioPath,
      audio_size_bytes: verifiedSize,
      processing_status: "uploaded",
    })
    .select("id")
    .single();
  if (insertErr || !consult) return { error: dbWhy(insertErr, "enrollment.createWithAudio", "상담을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.") };

  // 전사 제출이 실패해도 상담 행은 이미 생겼다 — 생성 사실은 여기서 남긴다(2026-09-10 김근우 건).
  await logAction({
    action: "enrollment_consultation_create",
    targetType: "enrollment_consultations",
    targetLabel: data.prospectName,
    metadata: {
      consultationId: consult.id, subject: data.subject || null, withAudio: true, followUp: followUp.result, outcome: followUp.outcome,
      ...(referrer.referrer_student_id || referrer.referrer_staff_id ? { referrer: await referrerLabelOf(admin as unknown as SupabaseClient, referrer) } : {}),
    },
  });

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
  return { id: consult.id };
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
  // 녹음·전사 라이선스(슈퍼관리자) — 꺼진 지점은 전사 행을 만들지 않는다(회의 녹음과 같은 스위치, 2026-09-30).
  const licenseErr = await licenseBlockReason(args.tenantId, "meeting_recording");
  if (licenseErr) return licenseErr;
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
  if (recErr || !rec) return dbWhy(recErr, "enrollment.recording.insert", "녹음을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");

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
    await removeObject(audioPath, { bucket: "consultation-recordings" }).catch(() => {});
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
  if (updErr) return dbWhy(updErr, "enrollment.recording.attach", "음성을 첨부하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  if (!mirrored) {
    // 소유권 불일치(타 테넌트 id 변조 등) — 방금 올린 객체 정리 후 거부.
    await removeObject(audioPath, { bucket: "consultation-recordings" }).catch(() => {});
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
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "enrollment"))) return { error: "신규 콜&상담 권한이 없습니다" };

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
  const { data: existing, error: readError } = await supabase
    .from("enrollment_consultations")
    // 뒤의 이름·학교…상담 내용 칸 = 감사로그 "무엇이 바뀌었나"의 저장 전 값
    // (consultation-audit.ts CONSULTATION_AUDIT_FIELDS와 같은 목록 — 가드 테스트가 잠근다).
    .select(
      "student_id, prospect_name, prospect_grade, prospect_school, english_name, gender, blood_type, birth_date, student_phone, home_phone, parent_name, parent_phone, parent_relation, address, zip_code, address_detail, consultation_path, subject, career_goal, siblings, safety_notes, follow_up_date, follow_up_content, non_registration_reason, parent_request, shuttle_bus_request, privacy_agreement, installment_agreement, subject_details, received_date, student_type, siblings_details, consultation_date, learning_history, consultant_id, counselor, from_public_intake, outcome, updated_at",
    )
    .eq("id", id)
    .single();
  if (readError || !existing) return { error: "상담을 불러오지 못했습니다. 다시 시도해 주세요." };
  // 수정 화면을 연 때의 값(editBase) — 있으면 **이 사람이 바꾼 칸만** 쓴다(원장 2026-10-26 · consultation-changed.ts).
  // 없거나 못 읽으면(배포 전에 열린 화면) 종전처럼 전체를 쓴다.
  const baseValues = parseEditBase(formData.get("editBase"));
  const baseParsed = baseValues ? createSchema.safeParse(baseValues) : null;
  const base = baseValues && baseParsed?.success ? { values: baseValues, data: baseParsed.data } : null;
  const lh: Record<string, unknown> = { ...((existing?.learning_history as Record<string, unknown>) ?? {}) };
  for (const key of ["prevAcademy", "lastScore"] as const) {
    const mine = parsed.data[key] || "";
    if (base && (base.data[key] || "") === mine) continue; // 안 바꿨다 — 지금 값 그대로
    if (mine) lh[key] = mine;
    else delete lh[key];
  }

  // 상담 완료 전환은 QR 접수건 + 현재 대기·예약(pending/scheduled)일 때만(클라 조작·낡은 폼 방어).
  const promoteToConsulted =
    markConsulted &&
    !!existing?.from_public_intake &&
    ["pending", "scheduled"].includes(String(existing?.outcome ?? ""));

  // 후속 조치(원장 2026-10-22) — 저장 뒤 '상담 완료' 칸에 남는 상담이면 반드시 고른다(QR 접수를 '상담 완료로 저장'할 때 포함).
  // 고른 값이 칸반 상태를 정한다. 이관 registration_status·결제 기록은 수정하지 않는다.
  // 🔑 배정 검사는 **저장될 과목**으로 한다(2026-10-23) — 과목 칸은 이 저장이 폼 값으로 덮으므로(`buildConsultationRow`), 고치기 전 과목으로
  //    보면 '영어'를 '수학'으로 바로잡으며 고른 후속 조치가 옛 과목의 배정에 막히거나 저장 뒤 칸반 칸과 어긋난다.
  const referrer = referrerColumns(formData);
  if ("error" in referrer) return { error: referrer.error };
  // 바꾼 칸 — 화면을 연 때와 지금을 **같은 변환**으로 견준다(학교 표기 통일 등이 양쪽에 똑같이 걸린다).
  const aliases = await schoolAliases();
  const mineRow = { ...buildConsultationRow(parsed.data, aliases), ...referrer.cols };
  const baseRow = base ? { ...buildConsultationRow(base.data, aliases), ...referrerColumnsOf(base.values) } : null;
  const changed = baseRow ? changedColumns(mineRow, baseRow) : null;
  const storedDate = (existing.follow_up_date as string | null) ?? null;
  const mineResult = parseFollowUpResult(formData.get("followUpResult"));
  const mineDate = parsed.data.followUpDate || null;
  // 안 건드린 후속 조치·날짜는 DB의 지금 값을 따른다(그사이 다른 사람이 정한 상태를 되돌리지 않는다).
  const effective = base
    ? effectiveFollowUp({
        mineResult, baseResult: parseFollowUpResult(base.values.followUpResult ?? null),
        mineDate, baseDate: base.data.followUpDate || null, storedDate, storedStage: stageOfOutcome(String(existing.outcome)),
      })
    : { result: mineResult, followUpDate: mineDate };
  const followUp = resolveFollowUp({
    current: promoteToConsulted ? "consulted" : String(existing.outcome),
    assignedClassCount: await countAssignedClasses(
      supabase, existing.student_id,
      changed && !changed.has("subject") ? ((existing.subject as string | null) ?? null) : parsed.data.subject || null,
    ),
    result: effective.result,
    followUpDate: effective.followUpDate,
    storedDate,
    today: kstToday(),
  });
  if ("error" in followUp) return { error: followUp.error };
  const outcomeTo = followUp.outcome !== existing.outcome ? followUp.outcome : null;

  const fullRow = {
    ...(await withSchoolKind(supabase, user.tenantId, buildConsultationRow(parsed.data, aliases))),
    ...referrer.cols,
  };
  let row: Partial<typeof fullRow> = fullRow;
  if (changed && baseRow) {
    const keep = new Set(changed);
    // 학년만 바꿔도 학교급이 채워지면(칠성 + 초5 → 칠성초) 학교도 쓴다 — 종전 전체 저장과 같은 결과.
    if (keep.has("prospect_grade") && fullRow.prospect_school !== mineRow.prospect_school) keep.add("prospect_school");
    row = Object.fromEntries(Object.entries(fullRow).filter(([key]) => keep.has(key))) as Partial<typeof fullRow>;
    const details = mergeSubjectDetails(existing.subject_details, baseRow.subject_details, mineRow.subject_details);
    if (details.changed) row.subject_details = details.value;
  }
  // 소개한 사람의 저장 전 값 — 따로·실패해도 되게 읽는다(위 선조회에 넣으면 칸이 없는 DB에서 학습 이력 보존 조회까지 함께 실패한다, #95).
  const referrerBefore = "referrer_student_id" in row ? await readReferrerBefore(supabase as unknown as SupabaseClient, id) : null;
  // 후속 조치로 상태가 바뀐 것도 '실제 수정'이다(완료 전환과 같은 결) — 다른 칸을 안 고치고 등록·미등록만 골라도 빈 상담자를 채운다.
  const autofilled = counselorAutofill({ ...existing, ...referrerBefore }, { ...row, learning_history: lh }, user.displayName, promoteToConsulted || !!outcomeTo);
  if (autofilled) row.counselor = autofilled;
  // 상담자 글자와 계정을 함께 맞춘다(counselor-account.ts) — 계정이 비면 후속 조치 할 일·알림이 원장 전원에게 간다.
  const account = counselorAccountPatch({
    beforeAccount: existing.consultant_id, patch: row, autofilled, userId: user.id,
    resolved: "counselor" in row && !autofilled ? await resolveCounselorAccount(supabase as unknown as SupabaseClient, user.tenantId, row.counselor) : null,
  });
  // 폼 칸 목록(buildConsultationRow)엔 계정 칸이 없다 — 이 저장에서만 더한다(감사로그 요약에도 '상담사'로 남는다).
  if (account !== undefined) (row as Record<string, unknown>).consultant_id = account;
  const { data: saved, error } = await supabase
    .from("enrollment_consultations")
    .update({
      ...row,
      learning_history: Object.keys(lh).length > 0 ? lh : null,
      ...(outcomeTo ? { outcome: outcomeTo } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id).eq("updated_at", existing.updated_at).select("id").maybeSingle();

  if (!error && !saved) return { error: "다른 저장이 먼저 반영되었습니다. 화면을 다시 열어 확인해주세요." };
  if (error) return { error: dbWhy(error, "enrollment.update", "상담을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.") };

  // 감사로그(2026-09-10 김근우 건) — 이름·학교·학년·보호자는 자동 연결의 키라 전후 값까지, 연락처·상담 내용은
  // 항목 이름만. 아무것도 안 바뀐 저장(그냥 '저장'을 누름)은 남기지 않는다(감사로그가 소음에 묻힌다).
  const summary = summarizeConsultationChanges(existing, row);
  if (referrerBefore && referrerChanged(referrerBefore, row)) {
    // 점수(원생 소개)에 바로 들어가는 값이라 누구에서 누구로 바꿨는지 남긴다(본인을 고르는 경우까지 되짚을 수 있게).
    const db = supabase as unknown as SupabaseClient;
    const [from, to] = await Promise.all([referrerLabelOf(db, referrerBefore), referrerLabelOf(db, referrer.cols)]);
    summary.changed.push("소개한 사람");
    summary.changes.push({ field: "소개한 사람", from, to });
  }
  if (summary.changed.length > 0 || outcomeTo || autofilled) {
    await logAction({
      action: "enrollment_consultation_update",
      targetType: "enrollment_consultations",
      targetLabel: parsed.data.prospectName,
      metadata: {
        consultationId: id,
        ...summary,
        ...(autofilled ? { counselorAutofill: autofilled } : {}),
        ...(outcomeTo ? { outcomeTo } : {}),
      },
    });
  }

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
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "enrollment"))) return { error: "신규 콜&상담 권한이 없습니다" };

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
    .select("outcome, prospect_name, student_id, subject")
    .eq("id", id)
    .single();
  if (!cur) return { error: "상담을 찾을 수 없습니다" };
  const assignedClassCount = await countAssignedClasses(supabase, cur.student_id, cur.subject);
  if (assignedClassCount > 0 && stageOfOutcome(outcome) !== "enrolled") return { error: ASSIGNED_DRAG_BLOCKED };
  const isConverted = cur.outcome === "enrolled";
  if (isConverted && outcome !== "enrolled" && outcome !== "declined") {
    // ⚠️ 클라 안내문(consultation-manage.tsx)과 **같은 문장**을 유지할 것 — 한쪽만 고치면 갈린다.
    // 칸반 드롭도 같은 상수를 미리 보여 준다(board-stages.dropBlockReason) — 문장은 한 곳에서만 온다.
    return { error: ENROLLED_REVERT_BLOCKED };
  }

  const { error } = await supabase
    .from("enrollment_consultations")
    .update({ outcome, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: dbWhy(error, "enrollment.outcome", "상담 상태를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.") };

  // 감사로그(2026-09-10 김근우 건 — 누가 '재원생 등록'으로 바꿨는지 되짚을 수 없었다). 칸반 드래그도 이 액션이다.
  // 같은 상태로 다시 저장한 건 바뀐 게 없으니 남기지 않는다.
  if (cur.outcome !== outcome) {
    await logAction({
      action: "enrollment_consultation_outcome",
      targetType: "enrollment_consultations",
      targetLabel: cur.prospect_name ?? null,
      metadata: { consultationId: id, from: cur.outcome, to: outcome },
    });
  }

  revalidatePath("/enrollment");
  revalidatePath(`/enrollment/${id}`);
  return { ok: true };
}

/**
 * 목록뷰 인라인(엑셀식 더블클릭) 수정이 고칠 수 있는 칸 — **카드가 보여 주는 칸만**(원장 2026-09-02
 * *"나머지는 더블클릭하면 엑셀처럼 수정하게"*). 여기 없는 필드는 상세 '수정' 폼(updateEnrollmentConsultation)
 * 몫이다. 🔴 `consulted_at`은 없다 — 정렬용 timestamptz라 폼도 절대 건드리지 않는다(buildConsultationRow 주석).
 */
// 🔴 메시지는 전부 한글로 — zod 기본 문구("Too big: …")가 그대로 토스트에 뜨면 raw 노출이다.
const tooLong = (what: string) => `${what}이(가) 너무 깁니다`;
const cellPatchSchema = z
  .object({
    prospectName: z.string().trim().min(1, "학생 이름을 입력해주세요").max(60, tooLong("학생 이름")),
    prospectSchool: z.string().trim().max(60, tooLong("학교")).nullable(),
    prospectGrade: z.string().trim().max(24, tooLong("학년")).nullable(),
    parentPhone: z.string().trim().max(40, tooLong("연락처")).nullable(),
    consultantId: z.string().uuid("상담사 값이 올바르지 않습니다").nullable(),
    subject: z.string().trim().max(40, tooLong("과목")).nullable(),
    // 옛 시트 이관 행은 원문이 길 수 있다 — 상세 폼(text, 상한 없음)과 어긋나 편집이 막히지 않게 넉넉히.
    parentRequest: z.string().max(20000, tooLong("상담 내용")).nullable(),
  })
  .partial()
  .strict();

export type ConsultationCellPatch = z.infer<typeof cellPatchSchema>;
export type PatchCellsState = { ok: true } | { error: string };

/**
 * 등록상담 **칸 단위** 수정 — 시트형 목록뷰의 더블클릭 인라인 편집 저장 경로.
 *
 * 상세 폼과 같은 게이트(등록상담 쓰기)·같은 정규화(학교 표기 `canonicalSchoolName`)를 타되, 준 칸만
 * 바꾼다(보내지 않은 칸은 손대지 않는다 — 폼처럼 전 필드를 다시 쓰면 열려 있던 다른 창의 저장과 서로 덮는다).
 * 🔴 과목은 **학원설정 키만** 받는다(운영 enum 단일 소스) — 옛 시트 자유 텍스트('영어 수학')가 든 행도
 *    고칠 땐 설정 과목 중 하나로만 바꿀 수 있다(그대로 두면 옛 값이 유지된다). 비우기(null)는 허용.
 * 🔴 상담사는 **이 학원의 직원 id만** — RLS 스코프 조회로 확인한다(다른 학원 id·퇴사자 id를 클라가 실어 보내도
 *    거절). 상태(outcome)는 여기가 아니라 `setEnrollmentOutcome`(칸반 드롭·상세와 같은 경로)이다.
 */
export async function patchConsultationCells(id: string, patch: ConsultationCellPatch): Promise<PatchCellsState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "enrollment"))) return { error: "신규 콜&상담 권한이 없습니다" };
  if (!id?.trim()) return { error: "상담 ID가 누락되었습니다" };

  // 객체가 아니거나 모르는 칸이 섞였으면(strict) zod 기본 영문 문구가 아니라 한글로 — 화면에 그대로 뜨는 문장이다.
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return { error: "입력값을 확인해주세요" };
  const parsed = cellPatchSchema.safeParse(patch);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const known = issue && (issue.code === "too_small" || issue.code === "too_big" || issue.code === "invalid_format");
    return { error: known ? issue.message : "입력값을 확인해주세요" };
  }
  const d = parsed.data;
  if (Object.keys(d).length === 0) return { error: "바꿀 칸이 없습니다" };

  const supabase = await createClient();
  // 감사로그용 저장 전 값(2026-09-10 김근우 건) — 아래 과목·상담사 검증과 **독립**이라 먼저 띄워 두고(B4) 저장
  // 직전에 받는다. 조회가 실패해도 저장은 막지 않는다(기록만 비고, 요약 함수는 모르는 걸 추측하지 않는다).
  const beforeRead = supabase
    .from("enrollment_consultations")
    .select(
      "prospect_name, prospect_school, prospect_grade, parent_name, parent_phone, student_phone, subject, consultant_id, parent_request, counselor, from_public_intake, updated_at",
    )
    .eq("id", id)
    .maybeSingle()
    .then(
      (r) => r.data,
      () => null,
    );
  const row: Record<string, unknown> = {};
  if (d.prospectName !== undefined) row.prospect_name = d.prospectName;
  if (d.prospectSchool !== undefined) {
    // 학년 칸을 같이 안 보냈으면 저장된 학년으로 급을 채운다(셀 하나만 고치는 경로).
    const grade = d.prospectGrade !== undefined ? d.prospectGrade : ((await beforeRead)?.prospect_grade ?? null);
    row.prospect_school = await completeSchoolKind(
      supabase,
      user.tenantId,
      canonicalSchoolName(d.prospectSchool, await schoolAliases()),
      grade,
      await schoolAliases(),
    );
  }
  if (d.prospectGrade !== undefined) row.prospect_grade = d.prospectGrade || null;
  if (d.parentPhone !== undefined) row.parent_phone = d.parentPhone || null;
  if (d.parentRequest !== undefined) row.parent_request = d.parentRequest?.trim() ? d.parentRequest : null;
  if (d.subject !== undefined) {
    if (d.subject) {
      const settings = await getTenantSettings();
      if (!settings.operations.subjects.some((s) => s.key === d.subject)) return { error: "학원설정에 없는 과목입니다" };
    }
    row.subject = d.subject || null;
  }
  if (d.consultantId !== undefined) {
    if (d.consultantId) {
      const { data: staff } = await supabase
        .from("users")
        .select("id")
        .eq("id", d.consultantId)
        .eq("status", "active")
        .maybeSingle();
      if (!staff) return { error: "상담사를 찾을 수 없습니다" };
    }
    row.consultant_id = d.consultantId;
  }

  const before = await beforeRead;
  if (!before) return { error: "상담을 불러오지 못했습니다. 다시 시도해 주세요." };
  const autofilled = counselorAutofill(before, row, user.displayName);
  if (autofilled) row.counselor = autofilled;
  const account = counselorAccountPatch({
    beforeAccount: before.consultant_id, patch: row, autofilled, userId: user.id,
    resolved: "counselor" in row && !autofilled ? await resolveCounselorAccount(supabase as unknown as SupabaseClient, user.tenantId, row.counselor) : null,
  });
  if (account !== undefined) row.consultant_id = account;

  // RLS 밖(다른 학원)·삭제된 id면 0행 갱신인데 에러가 없다 — select로 실제로 바뀐 행을 확인한다.
  const { data: updated, error } = await supabase
    .from("enrollment_consultations")
    .update({ ...row, updated_at: new Date().toISOString() })
    .eq("id", id).eq("updated_at", before.updated_at)
    .select("id")
    .maybeSingle();
  if (error) return { error: dbWhy(error, "enrollment.patchCells", "상담 칸을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.") };
  if (!updated) return { error: "상담을 찾을 수 없습니다" };

  const summary = summarizeConsultationChanges(before, row);
  if (summary.changed.length > 0 || autofilled) {
    await logAction({
      action: "enrollment_consultation_update",
      targetType: "enrollment_consultations",
      targetLabel: (typeof row.prospect_name === "string" ? row.prospect_name : null) ?? before?.prospect_name ?? null,
      metadata: { consultationId: id, ...summary, via: "list", ...(autofilled ? { counselorAutofill: autofilled } : {}) },
    });
  }

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
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "enrollment"))) return { error: "신규 콜&상담 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const redirectTo = String(formData.get("redirectTo") ?? "").trim();
  if (!id) return { error: "상담 ID가 누락되었습니다" };

  const supabase = await createClient();
  // RLS 스코프 — 같은 테넌트 상담만 조회/삭제. 음성 경로 정리를 위해 audio_path만 선조회.
  const { data: c } = await supabase
    .from("enrollment_consultations")
    .select("id, audio_path, prospect_name, student_id")
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
    await removeObject(p, { bucket: "consultation-recordings" }).catch(() => {});
  }

  // 2) row 삭제(RLS). consultation_ai_analysis·consultation_recordings는 FK cascade.
  const { error } = await supabase.from("enrollment_consultations").delete().eq("id", id);
  if (error) return { error: dbWhy(error, "enrollment.delete", "상담을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.", "delete") };

  // 감사로그(2026-09-10) — 삭제는 녹음·전사·AI 분석이 통째로 사라지는 일이라 누가 지웠는지가 유일한 근거다.
  await logAction({
    action: "enrollment_consultation_delete",
    targetType: "enrollment_consultations",
    targetLabel: c.prospect_name ?? null,
    // 🔴 `paths`로 세지 말 것 — 그건 **지울 수 있는**(학원 경로·ASCII 파일명) 것만 담아서, 레거시·한글 파일명
    //    녹음이 있던 상담을 지워도 "녹음 포함"이 안 찍힌다(적대 리뷰 2026-09-10). 있었는지는 행으로 본다.
    metadata: {
      consultationId: id,
      studentId: c.student_id ?? null,
      hadRecording: !!(c as { audio_path?: string | null }).audio_path || (recRows?.length ?? 0) > 0,
    },
  });

  revalidatePath("/enrollment");
  if (redirectTo) redirect(redirectTo);
  return undefined;
}

// 🔴 텍스트 기반 'AI 분석 실행'(runAiAnalysis)은 **삭제했다**(원장 2026-09-01: *"버튼 자체를 없애버리자.
// 거의 안사용하는듯. 어차피 녹음 분석을 돌리고 있으니까"*). 상담 분석은 이제 **녹음 경로 하나**다 —
// 전사 웹훅이 runConsultationAnalysis로 13섹션을 만들고, 다시 만들려면 regenerateConsultationAnalysis.
// ⚠️ 서버 액션은 export만 돼 있어도 **호출 가능한 엔드포인트**라, 화면에서 뺀 김에 액션도 같이 지웠다
// (아무도 못 여는 유료 AI 호출구를 남겨 두지 않는다). 되살릴 일이 생기면 git 이력에 있다.

// ────────────────── 상담 → 학생 자동 전환 ──────────────────

export type ConvertToStudentState =
  // notice = 동명이인이라 접미사(A·B·C)를 붙여 등록했다는 안내. 조용히 바꾸면 직원이 나중에
  // "내가 넣은 이름이 아닌데?" 하고 헤맨다 — 바꿨으면 그 자리에서 말한다.
  | {
      error?: string;
      studentId?: string;
      existingStudentId?: string;
      /**
       * existingStudentId가 **퇴원생**을 가리킨다(감사 F13) — 화면이 '재원 복구 후 배정'을 권하고,
       * 다른 아이가 맞으면 '그래도 새 학생으로 등록'(ignoreWithdrawn=1)을 고를 수 있게 한다. 자동 병합은 없다.
       */
      withdrawnMatch?: boolean;
      notice?: string;
      /**
       * 이번에 **실제로 만들어진** 수강의 반 id. 화면이 "수학 반을 배정했나"를 이걸로 판정한다 —
       * 🔴 클라가 고른 체크박스로 세면 안 된다(기존 학생 재사용 시 이미 등록된 반은 서버가 걸러내므로,
       *    아무 수강도 안 생겼는데 "교재 신청하세요"가 뜬다). 만든 쪽이 만든 것을 돌려준다.
       */
      assignedClassIds?: string[];
      /** 확정된 배정일(= 새 수강의 start_date). 화면이 "언제부터"를 사실대로 되짚어 말하기 위해. */
      startDate?: string;
    }
  | undefined;

/**
 * 같은 자연키(정규화 이름 + 학교 + 학년)의 **퇴원생** id — 없거나 조회 실패면 null(감사 F13).
 * 조회 실패를 막음으로 두지 않는다: 알림은 도움이지 게이트가 아니다(종전 동작 = 새 학생 생성).
 */
async function findWithdrawnNaturalKeyMatch(
  supabase: Awaited<ReturnType<typeof createClient>>,
  key: { tenantId: string; name: string; school: string | null; grade: string | null; aliases: Awaited<ReturnType<typeof schoolAliases>> },
): Promise<string | null> {
  const norm = key.name.toLowerCase().replace(/\s+/g, "");
  if (!norm) return null;
  const { data, error } = await supabase
    .from("students")
    .select("id, school, grade")
    .eq("tenant_id", key.tenantId)
    .eq("name_normalized", norm)
    .eq("status", "withdrawn")
    .order("withdrawn_at", { ascending: false, nullsFirst: false })
    .limit(20);
  if (error || !data) return null;
  const hit = data.find(
    (s) =>
      (canonicalSchoolName(s.school as string | null, key.aliases) ?? "") === (key.school ?? "") &&
      ((s.grade as string | null) ?? "") === (key.grade ?? ""),
  );
  return hit ? (hit.id as string) : null;
}

/**
 * 등록상담 → 학생 자동 생성. 선택한 반들에 enrollments도 동시에 INSERT.
 * 호출 후 enrollment_consultations.student_id 채우고 outcome='enrolled' 표시.
 */
export async function convertConsultationToStudent(
  _prev: ConvertToStudentState,
  formData: FormData,
): Promise<ConvertToStudentState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "enrollment"))) return { error: "신규 콜&상담 권한이 없습니다" };

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

  if (cErr || !c) {
    logDbError(cErr, "enrollment.convertConsultationToStudent");
    return { error: "상담 정보를 불러오지 못했습니다" };
  }

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
  // 배정일(원장 2026-09-09 "배정날짜 지정할 수 있게") — 규칙은 클라 다이얼로그와 **같은 함수**이고
  // 진짜 게이트는 여기다([[#77]]). 학생을 만들기 **전에** 거른다: 날짜가 잘못됐다고 학생만 남기면
  // 다음 시도가 자연키 충돌 경로로 떨어져 사람이 이유를 못 찾는다.
  // ⚠️ `as string`으로 캐스팅하지 않는다 — FormData 값은 File일 수 있고 그때 `.trim()`이 던진다.
  //    이 파일의 다른 칸과 같은 관용구(String(...) ?? "")로 받는다.
  const startAt = normalizeAssignStartDate(String(formData.get("startDate") ?? ""), today);
  if ("error" in startAt) return { error: startAt.error };
  const startDate = startAt.date;

  // 자연키(같은 이름·학교·학년의 재원 학생) 값 — 중복 안내에도 재사용.
  const studentName = overrideName || c.prospect_name;
  // 동명이인 접미사(A·B·C…) — 수동 등록과 **같은 규칙**. 이 경로에 없어서 상담에서 전환한 학생이
  // 같은 이름으로 들어왔고, 그 결과 동명이인 가드가 정상 보고서를 조용히 막았다(2026-07-29 김수아 건).
  const uniqueName = await resolveUniqueStudentNameFor(supabase, c.tenant_id, studentName ?? "");
  // 상담 → 학생 전환도 같은 규칙(옛 상담 행이 긴 표기여도 학생엔 짧은 표기로 들어간다).
  const studentSchool = overrideSchool ?? c.prospect_school;
  const studentGrade = overrideGrade ?? c.prospect_grade;
  const aliases = await schoolAliases();
  // 저장할 학교 표기 — 상담에 급 없이 적힌 학교(`칠성`)도 학년으로 급을 채운다(2026-10-20 김지유 건).
  const savedSchool = await completeSchoolKind(supabase, c.tenant_id, canonicalSchoolName(studentSchool, aliases), studentGrade, aliases);

  // 퇴원했다 돌아온 학생(감사 F13, 원장 2026-09-23) — 같은 이름·학교·학년의 **퇴원생**이 있으면 새 학생
  // '이름A'를 조용히 만들지 않고 멈춰서 알린다(만들면 출결·수납·상담 이력이 두 학생으로 갈라진다).
  // 🔴 자동 병합·자동 재원 복구는 하지 않는다 — 사람이 그 학생을 열어 재원 복구한 뒤 배정한다.
  //    다른 아이가 맞으면 화면의 '그래도 새 학생으로 등록'이 ignoreWithdrawn=1로 다시 보낸다.
  if (String(formData.get("ignoreWithdrawn") ?? "") !== "1") {
    const withdrawn = await findWithdrawnNaturalKeyMatch(supabase, {
      tenantId: c.tenant_id,
      name: studentName ?? "",
      school: savedSchool,
      grade: studentGrade,
      aliases,
    });
    if (withdrawn) {
      const who = [studentName, studentSchool, studentGrade].filter(Boolean).join(" · ");
      return {
        error: `같은 이름·학교·학년의 퇴원 학생이 있습니다 (${who}). 돌아온 학생이면 그 학생을 열어 '재원 복구'한 뒤 반을 배정해 주세요.`,
        existingStudentId: withdrawn,
        withdrawnMatch: true,
      };
    }
  }

  // 재원생 좌석 한도 — 이 전환은 새 재원생을 만든다(상담 행의 지점 기준).
  {
    const seat = await seatBlockReason(c.tenant_id, 1);
    if (seat) return { error: seat };
  }

  // students INSERT
  const { data: stu, error: stuErr } = await supabase
    .from("students")
    .insert({
      tenant_id: c.tenant_id,
      name: uniqueName.name,
      grade: studentGrade,
      school: savedSchool,
      parent_name: overrideParentName ?? c.parent_name,
      parent_phone: overrideParentPhone ?? c.parent_phone,
      status: "enrolled",
      // 🔴 등록일은 **오늘**이지 배정일이 아니다 — 이 칸은 대시보드 '이번 달 신입생'·학원생 증감의 축이라,
      //    배정일을 따라 미래로 밀면 오늘 등록한 학생이 신규 집계에서 조용히 사라진다(원장이 시킨 건
      //    "수업이 언제부터인가"이지 "언제 등록했나"가 아니다).
      enrolled_at: today,
    })
    .select("id")
    .single();

  // 학생 확정: 생성 성공이면 그 id, 자연키 충돌(이미 재원 학생 — 대개 makeedu 왕복)이면 기존 학생 재사용(B).
  let studentId: string;
  let reusedExisting = false;
  if (stu && !stuErr) {
    studentId = stu.id;
    // 상담 전환도 학생 등록 경로 — "학생 레코드를 바꾸는 모든 경로는 감사로그"(원장 2026-08-18, 적대 리뷰 F5).
    // INSERT 성공 직후 기록 — 뒤의 반 배정이 실패해도 학생은 이미 생겼다(F6과 같은 원칙).
    await logAction({
      action: "student_create",
      targetType: "student",
      targetLabel: uniqueName.name,
      metadata: { studentId, source: "enrollment_consultation", consultationId },
    });
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
      start_date: startDate,
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
    // 수강을 바꾸는 모든 경로는 감사로그(원장 2026-08-18) — createEnrollment와 같은 키·모양(반마다 1행).
    for (const classId of assignClassIds) {
      await logAction({
        action: "enrollment_assign",
        targetType: "student",
        metadata: { studentId, classId, startDate, source: "enrollment_consultation" },
      });
    }
  }

  // 상담에 학생 ID + outcome=enrolled 연결(재사용/신규 모두 — orphan 상담 해소).
  // 🔴 새 학생에 동명이인 알파벳이 붙었으면 상담 이름도 그 이름으로(원장 2026-10-20 *"같은 학생인데 알파벳이 다른것도 이해안됨"*).
  //    상담이 `권민서`로 남으면 ① 콜&상담과 원생 목록의 이름이 갈리고 ② 메이크에듀로 보내는 이름(역동기화는 상담 이름을 보낸다)이
  //    알파벳 없이 나가 메이크에듀가 **제 알파벳을 따로** 붙인다 → 동기화가 같은 학생을 못 알아보고 `권민서B`를 새로 만들었다.
  const renameConsult = !reusedExisting && uniqueName.name !== (c.prospect_name ?? "") ? uniqueName.name : null;
  await supabase
    .from("enrollment_consultations")
    .update({ student_id: studentId, outcome: "enrolled", ...(renameConsult ? { prospect_name: renameConsult } : {}) })
    .eq("id", consultationId);
  if (renameConsult) {
    await logAction({
      action: "enrollment_consultation_update",
      targetType: "enrollment_consultations",
      targetLabel: renameConsult,
      metadata: { consultationId, changes: [{ field: "이름", from: c.prospect_name ?? null, to: renameConsult }], via: "convert" },
    });
  }
  // 상태가 '등록 완료'로 바뀐 것도 칸반 드래그와 **같은 로그**로 남긴다 — 운영실 '금일 등록'(원장 2026-09-23)이 이 로그의
  // 시각으로 "오늘 등록 완료로 옮긴 상담"을 센다(여기가 빠지면 '수업 배정'으로 등록한 학생이 카드에서 사라진다).
  if (c.outcome !== "enrolled") {
    await logAction({
      action: "enrollment_consultation_outcome",
      targetType: "enrollment_consultations",
      targetLabel: c.prospect_name ?? null,
      metadata: { consultationId, from: c.outcome, to: "enrolled", via: "convert" },
    });
  }

  // 기존 학생 재사용(자연키 충돌 경로)은 **새 학생을 안 만들고 이미 있는 기록에 붙이는** 일이라 따로 남긴다
  // (2026-09-10 김근우 건 — 동명이인이 조용히 합쳐지는 것과 같은 모양이라 되짚을 흔적이 있어야 한다).
  if (reusedExisting) {
    await logAction({
      action: "consultation_link_existing",
      targetType: "enrollment_consultations",
      targetLabel: c.prospect_name ?? null,
      metadata: { consultationId, studentId },
    });
  }

  revalidatePath("/enrollment");
  revalidatePath(`/enrollment/${consultationId}`);
  revalidatePath("/students");
  return {
    studentId,
    assignedClassIds: assignClassIds,
    startDate,
    notice: uniqueName.suffixed
      ? `이미 '${studentName}' 학생이 있어 '${uniqueName.name}'(으)로 등록했습니다. 다른 학생이면 그대로 두고, 같은 학생이면 학생 목록에서 정리하세요.`
      : undefined,
  };
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
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "enrollment"))) return { error: "신규 콜&상담 권한이 없습니다" };

  const analysisId = String(formData.get("analysisId") ?? "").trim();
  const consultationId = String(formData.get("consultationId") ?? "").trim();
  const key = String(formData.get("key") ?? "").trim();
  const content = String(formData.get("content") ?? "");
  if (!analysisId) return { error: "분석 ID가 누락되었습니다" };
  if (!EDITABLE_AUDIO_KEYS.has(key)) return { error: "잘못된 섹션입니다" };

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("consultation_ai_analysis")
    .select("print_payload, consultation_id")
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
  if (error) return { error: dbWhy(error, "enrollment.reportSection", "분석 내용을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.") };

  // 감사로그 — 회의 AI 리포트 수정(meeting_report_edit)과 같은 결: 섹션 키 + 수정 후 글자 수만(본문은 남기지 않는다).
  // 상담 id는 폼 값이 아니라 **분석 행이 가리키는 상담**으로(폼 값은 검증되지 않은 입력이다).
  const reportConsultationId = (row.consultation_id as string | null) ?? (consultationId || null);
  const { data: reportConsult } = reportConsultationId
    ? await supabase.from("enrollment_consultations").select("prospect_name").eq("id", reportConsultationId).maybeSingle()
    : { data: null };
  await logAction({
    action: "enrollment_consultation_report_edit",
    targetType: "enrollment_consultations",
    targetLabel: (reportConsult?.prospect_name as string | null | undefined) ?? null,
    metadata: { consultationId: reportConsultationId, analysisId, section: key, chars: content.trim().length },
  });

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
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "enrollment"))) return { error: "신규 콜&상담 권한이 없습니다" };
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

  // 감사로그 — 재분석은 유료 AI 호출이고 사람이 고친 섹션을 덮어쓴다(회의 재분석 meeting_regenerate_analysis와 같은 결).
  // 선점(claim)에 성공한 사람만 남긴다. 모델명은 아직 모른다(after 백그라운드가 정한다) — 입력 분량만.
  await logAction({
    action: "enrollment_consultation_regenerate_analysis",
    targetType: "enrollment_consultations",
    targetLabel: consult.prospect_name ?? null,
    metadata: {
      consultationId,
      analysisId: existing.id,
      recordings: nonEmpty.length,
      transcriptChars: formatted.length,
    },
  });

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
      const { data: report, model } = await runConsultationAnalysis(ctx, formatted, multi, undefined, {
        tenantId: user.tenantId,
      });
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
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "enrollment"))) return { error: "신규 콜&상담 권한이 없습니다" };
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

  // `.select`로 실제로 바뀐 행을 받는다 — 감사로그를 실제 갱신에만 남기고 '대상' 이름을 같은 왕복으로 얻는다.
  const { data: appended, error } = await supabase
    .from("enrollment_consultations")
    .update({ parent_request: next, updated_at: new Date().toISOString() })
    .eq("id", consultationId)
    .select("prospect_name")
    .maybeSingle();
  if (error) return { error: dbWhy(error, "enrollment.appendAiSummary", "상담 내용에 요약을 붙이지 못했습니다. 잠시 후 다시 시도해 주세요.") };

  // 감사로그 — 상담 내용(parent_request) 수정이라 콜&상담 수정 키·요약 규칙(consultation-audit.ts)을 그대로 쓴다.
  // 🔴 상담 내용 값은 남기지 않는다(항목 이름만 — withValues:false).
  if (appended) {
    await logAction({
      action: "enrollment_consultation_update",
      targetType: "enrollment_consultations",
      targetLabel: (appended.prospect_name as string | null) ?? null,
      metadata: {
        consultationId,
        ...summarizeConsultationChanges({ parent_request: consult.parent_request }, { parent_request: next }),
        via: "ai_summary",
      },
    });
  }

  revalidatePath(`/enrollment/${consultationId}`);
  revalidatePath("/enrollment");
  return { ok: true };
}
