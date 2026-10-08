import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";

/** Missing migration alone permits legacy fallback. A transient failure must not undo a manual assignment. */
export async function homeworkVideoSource(db: ReturnType<typeof createAdminClient>): Promise<string> {
  const { error } = await db.from("homework_video_ledger_videos").select("id").limit(0);
  if (!error) return "homework_video_ledger_videos";
  if (["42P01", "PGRST205"].includes(error.code)) return "student_homework_videos";
  throw new Error("영상 배정 정보를 읽지 못했습니다.");
}
