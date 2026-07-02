import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 녹음 1개가 실패했을 때 상담 행 미러(enrollment_consultations)를 정직하게 동기화 — 웹훅
 * failRecording·액션 전사제출 실패가 공유(적대리뷰 #9·#7).
 *
 * 완료된 녹음이 하나라도 있으면: 상담 전체가 '처리 실패'로 보이면 안 된다(유효한 분석·전사가
 * 화면에 그대로 있는데 빨간 실패 배너 + 배지 모순). → 미러를 **최신 완료 녹음 기준 completed로 복원**
 * (실패는 해당 녹음 행의 상태칩·에러로만 표시). 완료 녹음이 없으면 레거시처럼 failed + 에러.
 */
export async function syncMirrorAfterRecordingFailure(
  admin: SupabaseClient,
  consultationId: string,
  errorMsg: string,
): Promise<void> {
  const { data: latest } = await admin
    .from("consultation_recordings")
    .select("audio_path, audio_size_bytes")
    .eq("consultation_id", consultationId)
    .eq("processing_status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest) {
    await admin
      .from("enrollment_consultations")
      .update({
        audio_path: latest.audio_path,
        audio_size_bytes: latest.audio_size_bytes,
        processing_status: "completed",
        processing_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", consultationId);
  } else {
    await admin
      .from("enrollment_consultations")
      .update({
        processing_status: "failed",
        processing_error: errorMsg,
        updated_at: new Date().toISOString(),
      })
      .eq("id", consultationId);
  }
}
