import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";

/** 이미 열람 권한을 확인한 보고서의 선택 항목. 옛 스키마에서도 보고서 본문은 열린다. */
export async function reportVideoHomework(db: ReturnType<typeof createAdminClient>, tenantId: string, reportId: string): Promise<boolean> {
  try {
    const { data, error } = await db.from("lesson_reports").select("video_homework")
      .eq("tenant_id", tenantId).eq("id", reportId).maybeSingle();
    return !error && data?.video_homework === true;
  } catch { return false; }
}
