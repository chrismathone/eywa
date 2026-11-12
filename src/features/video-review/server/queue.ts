import "server-only";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { aiAnalysisEnabled, db } from "./rows";

type Candidate = { id: string; route: unknown };

/**
 * 아직 분석 줄이 없는 수학 영상마다 분석 줄(stage extract)을 만든다 — 이미 있으면 건너뛴다(video_id 유일).
 * 과목은 장부 보기(`homework_video_ledger_videos`)의 과목(배정한 반의 과목)을 따른다 — 반에 배정되지 않아 과목을 모르는 영상과 영어 영상은
 * 넣지 않는다(원장 2026-10-21 "수학만해"). 숙제에서 제외한 영상도 넣지 않는다.
 * 올린 날짜 창은 없다(처음엔 최근 7일이었다 — 2026-10-21 밀린 390건을 소급한 뒤 없앴다): 옛 영상을 늦게 수학 반에 배정해도 배정되는 날 들어간다.
 * 🔴 후보 전건을 페이지로 읽는다(B2) — 앞쪽 상한으로 자르면 이미 넣은 영상이 상한을 채워 뒤 영상이 영영 안 들어간다(적대 리뷰 2026-10-20).
 */
export async function enqueueNewVideos(tenantId: string): Promise<number> {
  if (!(await aiAnalysisEnabled(tenantId))) return 0;
  const all = await fetchAllPaged<Candidate>((from, to) => db().from("homework_video_ledger_videos")
    .select("id,route")
    .eq("tenant_id", tenantId).eq("status", "uploaded").eq("subject", "math")
    .not("drive_file_id", "is", null).not("student_id", "is", null)
    .order("id").range(from, to));
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
