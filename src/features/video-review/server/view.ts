import "server-only";
import { canViewLinkedHomeworkVideo, loadViewableVideo } from "@/features/students/server/homework-video-stream";
import { modelDisplayLabel } from "@/lib/ai/model-label";
import { canRerunReview, stageView, toResultView, type ReviewView } from "../view";
import type { ReviewResult, ReviewStage } from "../types";
import { aiAnalysisEnabled, db, videoReviewEnabled } from "./rows";

export type ViewAccess = { ok: true; tenantId: string; userId: string } | { ok: false; status: number };

/**
 * 이 영상의 AI 참고 메모를 볼 수 있는가 — **재생과 같은 판정**(loadViewableVideo + canViewLinkedHomeworkVideo) + 지점 스위치.
 * 스위치가 꺼졌으면 404(기능이 있는지조차 모르게 — 결정 tenant.md '기능 스위치').
 */
export async function reviewAccess(videoId: string): Promise<ViewAccess> {
  const loaded = await loadViewableVideo(videoId);
  if (!loaded.ok) return loaded;
  const { user, db: admin, video } = loaded;
  if (!video.student_id) return { ok: false, status: 404 };
  if (!(await videoReviewEnabled(user.tenantId))) return { ok: false, status: 404 };
  if (!(await canViewLinkedHomeworkVideo(user, admin, { id: videoId, student_id: video.student_id, route: video.route }))) {
    return { ok: false, status: 403 };
  }
  return { ok: true, tenantId: user.tenantId, userId: user.id };
}

/** 화면 모양 — 행이 없으면 null(아직 대기열에 없는 영상 · 과목이 수학이 아닌 영상). */
export async function reviewViewFor(tenantId: string, videoId: string): Promise<ReviewView | null> {
  const { data, error } = await db().from("homework_video_reviews")
    .select("stage,result,models,transcript_id,assets")
    .eq("tenant_id", tenantId).eq("video_id", videoId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const stage = data.stage as ReviewStage;
  const result = (data.result as ReviewResult | null) ?? null;
  const { state, message } = stageView(stage, !!result);
  const aiEnabled = await aiAnalysisEnabled(tenantId);
  return {
    state,
    message,
    result: result ? toResultView(result) : null,
    judgeModelLabel: modelDisplayLabel(result?.judgeModel ?? null),
    canRerun: canRerunReview(stage, !!data.transcript_id, !!data.assets, aiEnabled),
  };
}
