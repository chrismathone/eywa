import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { videoHomeworkDueColumnReady } from "@/features/video-homework/server/report-due";

const NONE = { assigned: false, due: null };

/**
 * 이미 열람 권한을 확인한 보고서의 선택 항목 — 영상 과제 있음 + 마감(원장 2026-10-15, video-homework/due.ts).
 * 옛 스키마에서도 보고서 본문은 열린다(실패 = 영상 숙제 칸 없음). 마감 칸이 아직 없으면 마감 없이 읽는다(= 수업일 + 7일, #95).
 */
export async function reportVideoHomework(db: ReturnType<typeof createAdminClient>, tenantId: string, reportId: string): Promise<{ assigned: boolean; due: string | null }> {
  try {
    const dueReady = await videoHomeworkDueColumnReady(db);
    const { data, error } = await db.from("lesson_reports").select(dueReady ? "video_homework,video_homework_due" : "video_homework")
      .eq("tenant_id", tenantId).eq("id", reportId).maybeSingle();
    if (error || !data) return NONE;
    const row = data as unknown as { video_homework: boolean | null; video_homework_due?: string | null };
    return { assigned: row.video_homework === true, due: row.video_homework_due ?? null };
  } catch { return NONE; }
}
