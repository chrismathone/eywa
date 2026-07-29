"use server";

import { revalidatePath } from "next/cache";
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

  const admin = createAdminClient();

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
      "id, summary, transcription, consulted_at, audience, category, student:student_id ( name, grade, school )",
    )
    .eq("id", id)
    .single();
  if (!row) return { error: "상담을 찾을 수 없습니다" };

  const text = (row.transcription || row.summary || "").trim();
  if (text.length < 10) return { error: "분석할 상담 내용(전사 또는 요약)이 너무 짧습니다" };

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
    });
    const { error: updErr } = await supabase
      .from("student_consultations")
      .update({
        ai_report: report,
        ai_summary: report.summary,
        ai_model_version: `${model}-${new Date().toISOString().slice(0, 10)}`,
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
