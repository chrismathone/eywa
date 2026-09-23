"use server";

import { revalidatePath } from "next/cache";
import { kstToday } from "@/lib/date-kst";
import { redirect } from "next/navigation";
import { submitTranscript } from "@/lib/ai/assemblyai";
import { getAssemblyaiWebhookUrl } from "@/lib/config/app-url";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isTenantAudioPath } from "@/lib/storage/audio-path";
import {
  removeObject,
  resolveAudioReadUrl,
  verifyUploadedObject,
} from "@/lib/storage/media-storage";
import { localizeTranscriptionError } from "@/lib/ai/transcription-error";
import { analyzeStudentConsultation } from "./ai";
import { getTenantSettings } from "@/features/owner/server/queries";
import { subjectLabelRecord } from "@/features/owner/subjects";
import { consultationSubject } from "../subject";
import {
  canConsultStudent,
  OUT_OF_SCOPE_CONSULTATION,
  OUT_OF_SCOPE_STUDENT,
  scopedConsultationUserId,
} from "./write-scope";

async function requireConsultationWrite() {
  const user = await getCurrentUser();
  if (!user) return { user: null, error: "로그인이 필요합니다" };
  const lvl = await accessLevelTenant(user.systemRole, "consultations");
  if (lvl !== "full" && lvl !== "scoped") return { user: null, error: "상담 관리 권한이 없습니다" };
  return { user, error: undefined as string | undefined };
}

export type StartStudentConsultationAudioState = { error?: string } | undefined;

/**
 * 녹음/업로드된 음성으로 재원생 학생상담을 생성하고 AssemblyAI 전사를 시작.
 * enrollment startConsultationFromAudio 클론 — consultation-recordings 버킷·공용 웹훅 재사용.
 * 전사 완료는 웹훅(handleStudentConsultation)이 처리. ⚠️ AssemblyAI는 localhost 웹훅 미도달(로컬 E2E 한계).
 */
export async function startStudentConsultationFromAudio(
  _prev: StartStudentConsultationAudioState,
  formData: FormData,
): Promise<StartStudentConsultationAudioState> {
  const { user, error } = await requireConsultationWrite();
  if (error || !user) return { error };

  const studentId = String(formData.get("studentId") ?? "").trim();
  const audioPath = String(formData.get("audioPath") ?? "").trim();
  const audioSizeBytes = Number(formData.get("audioSizeBytes") ?? 0);
  const consultedAtRaw = String(formData.get("consultedAt") ?? "").trim();
  const audience = String(formData.get("audience") ?? "").trim() || null;
  const category = String(formData.get("category") ?? "").trim() || null;

  if (!studentId) return { error: "학생을 선택해주세요" };
  if (!audioPath) return { error: "음성 파일이 누락되었습니다" };
  if (!isTenantAudioPath(audioPath, user.tenantId)) return { error: "파일 경로가 잘못되었습니다" };
  // 담당 범위(감사 S3) — 강사는 담당 학생에게만 녹음 상담을 만든다(텍스트 등록과 같은 판정).
  if ((await scopedConsultationUserId(user)) && !(await canConsultStudent(studentId))) {
    // ⚠️ 여기서 음성을 지우지 않는다 — 경로는 요청이 준 값이라, 지우면 남의 상담 녹음을 지우는 문이 된다.
    return { error: OUT_OF_SCOPE_STUDENT };
  }

  const admin = createAdminClient();
  const [{ data: counselor }, settings] = await Promise.all([
    admin.from("users").select("subjects").eq("id", user.id).eq("tenant_id", user.tenantId).maybeSingle(),
    getTenantSettings(),
  ]);
  const subject = consultationSubject(null, counselor?.subjects, subjectLabelRecord(settings.operations.subjects));

  let audioUrl: string;
  let verifiedSize = audioSizeBytes;
  try {
    const meta = await verifyUploadedObject("consultation", audioPath);
    if (meta.size > 0) verifiedSize = meta.size;
    audioUrl = await resolveAudioReadUrl(audioPath, "consultation", user.tenantId);
  } catch (e) {
    await removeObject(audioPath, { bucket: "consultation-recordings" }).catch(() => {});
    return { error: e instanceof Error ? e.message : "오디오 검증 실패" };
  }

  const { data: row, error: insertErr } = await admin
    .from("student_consultations")
    .insert({
      tenant_id: user.tenantId,
      student_id: studentId,
      counselor_id: user.id,
      subject,
      consulted_at: consultedAtRaw ? new Date(consultedAtRaw).toISOString() : new Date().toISOString(),
      audience,
      category,
      summary: "(녹음 분석 중)",
      audio_path: audioPath,
      audio_size_bytes: verifiedSize,
      processing_status: "uploaded",
    })
    .select("id")
    .single();
  if (insertErr || !row) return { error: `상담 생성 실패: ${insertErr?.message ?? "unknown"}` };

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
      .from("student_consultations")
      .update({ assemblyai_transcript_id: result.id, processing_status: "transcribing" })
      .eq("id", row.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const ko = localizeTranscriptionError(msg);
    await admin
      .from("student_consultations")
      .update({ processing_status: "failed", processing_error: ko })
      .eq("id", row.id);
    return { error: ko };
  }

  revalidatePath("/consultations");
  redirect(`/consultations/${row.id}/edit`);
}

export type RunConsultationAnalysisState = { error?: string; ok?: boolean } | undefined;

/**
 * 텍스트 경로 AI 분석 — 행의 transcription(없으면 summary) + 학생 컨텍스트로 7섹션 생성.
 * 오디오 완료건 재분석에도 사용. 명시 버튼만 호출(페이지 로드 무호출). RLS createClient(테넌트 격리).
 */
export async function runStudentConsultationAnalysis(
  _prev: RunConsultationAnalysisState,
  formData: FormData,
): Promise<RunConsultationAnalysisState> {
  const { user, error } = await requireConsultationWrite();
  if (error || !user) return { error };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "상담 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("student_consultations")
    .select(
      "id, counselor_id, summary, transcription, consulted_at, audience, category, student:student_id ( name, grade, school )",
    )
    .eq("id", id)
    .single();
  if (!row) return { error: "상담을 찾을 수 없습니다" };
  // 담당 범위(감사 S3) — 강사는 본인이 쓴 상담만 분석한다(유료 AI 호출).
  const scopedId = await scopedConsultationUserId(user);
  if (scopedId && row.counselor_id !== scopedId) return { error: OUT_OF_SCOPE_CONSULTATION };

  // 🔴 **AI 분석은 녹음(전사)에만**(원장 2026-09-09 *"AI 분석은 '녹음'에만 분석되도록 해줘"*) —
  //    상담 요약은 사람이 직접 쓴 글이라 그걸 다시 AI로 요약하면 같은 말을 두 번 하는 셈이고,
  //    붙여 넣은 잡음(웹 화면 조각 등)까지 분석 입력이 된다. `summary` 폴백을 되살리지 말 것.
  const text = String(row.transcription ?? "").trim();
  if (!text) {
    return { error: "녹음 전사가 있어야 AI 분석을 할 수 있습니다 — 상담 요약만으로는 분석하지 않습니다" };
  }
  if (text.length < 10) return { error: "분석할 녹음 전사가 너무 짧습니다" };

  const student = (Array.isArray(row.student) ? row.student[0] : row.student) as
    | { name?: string; grade?: string | null; school?: string | null }
    | undefined;

  try {
    const { report, model } = await analyzeStudentConsultation(text, {
      studentName: student?.name ?? "학생",
      grade: student?.grade ?? null,
      school: student?.school ?? null,
      consultedAt: row.consulted_at as string | null,
      audience: row.audience as string | null,
      category: row.category as string | null,
      tenantId: user.tenantId,
    });
    const { error: updErr } = await supabase
      .from("student_consultations")
      .update({
        ai_report: report,
        ai_summary: report.summary,
        ai_model_version: `${model}-${kstToday()}`,
        ai_generated_at: new Date().toISOString(),
        // 텍스트 분석도 완료 상태로(오디오 없이 분석한 경우 idle→completed).
        processing_status: "completed",
      })
      .eq("id", id);
    if (updErr) return { error: updErr.message };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `AI 분석 실패: ${msg}` };
  }

  revalidatePath(`/consultations/${id}/edit`);
  revalidatePath("/consultations");
  return { ok: true };
}
