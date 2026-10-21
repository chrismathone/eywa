import "server-only";
import { fetchInChunks } from "@/lib/supabase/batch";
import { reviewPoints } from "../score";
import type { ReviewResult } from "../types";
import { db, videoReviewEnabled } from "./rows";

/**
 * 분석이 끝난 영상의 AI 참고 평점(영상 id → 5점 만점, `reviewPoints`) — 영상 제출 현황 칸 아래에 적는다(원장 2026-10-21).
 * 🔴 지점 스위치(`video_review`)가 꺼졌으면 읽지 않는다(기능이 있는지조차 모르게). 저장된 결과만 읽는다 — AI를 부르지 않는다.
 * 표를 못 읽으면(0390a 전 · 순간 오류) 빈 결과 — 평점만 안 보이고 장부는 그대로 선다([[#95]]).
 */
export async function loadReviewPoints(tenantId: string, videoIds: readonly string[], options: { enabled?: boolean } = {}): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = [...new Set(videoIds)];
  if (!ids.length) return out;
  try {
    // 스위치를 이미 본 호출부(장부)는 `enabled`로 넘긴다 — 같은 판정을 두 번 묻지 않게.
    if (!(options.enabled ?? (await videoReviewEnabled(tenantId)))) return out;
    // 점수 칸만 — 메모 본문 전체(jsonb)를 자주 여는 장부마다 읽지 않는다(적대적 재리뷰 2026-10-21). video_id는 유니크라 묶음마다 100줄 이하.
    const rows = await fetchInChunks<{ video_id: string; scores: unknown }>(ids, (chunk) => db().from("homework_video_reviews")
      .select("video_id,scores:result->scores").eq("tenant_id", tenantId).eq("stage", "done").in("video_id", chunk));
    for (const row of rows) {
      const points = reviewPoints(row.scores as ReviewResult["scores"] | null);
      if (points !== null) out.set(row.video_id, points);
    }
  } catch (e) {
    console.warn(JSON.stringify({ level: "warn", scope: "videoReview.points", message: e instanceof Error ? e.message : String(e) }));
  }
  return out;
}
