import "server-only";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { db } from "./rows";

/** 대기열에 넣는 범위 — 최근 7일에 올라온 수학 영상(오래된 영상을 한꺼번에 소급 판정하지 않는다). */
const LOOKBACK_DAYS = 7;

type Candidate = { id: string; route: unknown };

/**
 * 새로 올라온 수학 영상마다 분석 줄(stage extract)을 만든다 — 이미 있으면 건너뛴다(video_id 유일).
 * 과목은 장부 보기(`homework_video_ledger_videos`)의 과목(배정한 반의 과목)을 따른다. 숙제에서 제외한 영상은 넣지 않는다.
 * 🔴 7일 창 전건을 페이지로 읽는다(B2) — 앞쪽 상한으로 자르면 이미 넣은 영상이 상한을 채워 뒤 영상이 영영 안 들어간다(적대 리뷰 2026-10-20).
 */
export async function enqueueNewVideos(tenantId: string, now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const all = await fetchAllPaged<Candidate>((from, to) => db().from("homework_video_ledger_videos")
    .select("id,route")
    .eq("tenant_id", tenantId).eq("status", "uploaded").eq("subject", "math")
    .not("drive_file_id", "is", null).not("student_id", "is", null)
    .gte("created_at", since).order("id").range(from, to));
  const candidates = all.filter((v) => (v.route as { excluded?: unknown } | null)?.excluded !== true).map((v) => v.id);
  if (!candidates.length) return 0;
  const existing = await fetchInChunks<{ video_id: string }>(candidates, (chunk) =>
    db().from("homework_video_reviews").select("video_id").eq("tenant_id", tenantId).in("video_id", chunk));
  const have = new Set(existing.map((r) => r.video_id));
  const rows = candidates.filter((id) => !have.has(id)).map((video_id) => ({ tenant_id: tenantId, video_id, stage: "extract" }));
  if (!rows.length) return 0;
  const { error } = await db().from("homework_video_reviews").upsert(rows, { onConflict: "video_id", ignoreDuplicates: true });
  if (error) throw error;
  return rows.length;
}
