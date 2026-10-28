import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchInChunks } from "@/lib/supabase/batch";
import { reportWarning } from "@/lib/observability/report-error";
import { isMentDraftTableMissingError } from "./ment-draft-db";
import { learnTeacherHabits, NO_HABITS, type TeacherHabits } from "../teacher-habits";

/** 판정에 보는 최근 기록 수 — 자동작성 원문이 남은(0370a) 그 선생님 보고서. */
export const HABIT_RECENT_DRAFTS = 120;

/**
 * 그 선생님이 **늘 지우는 문장**(teacher-habits.ts) — 자동작성할 때마다 최근 기록으로 다시 판정한다(cron 없음 · 배포 즉시 적용).
 * 🔴 admin 클라이언트 → 모든 조회에 tenant_id. 🔴 던지지 않는다 — 조회 실패·표 없음([[#95]])이면 종전 어투(NO_HABITS).
 */
export async function loadTeacherHabits(admin: SupabaseClient, tenantId: string, teacherId: string): Promise<TeacherHabits> {
  try {
    const { data, error } = await admin
      .from("ment_ai_drafts")
      .select("report_id, ai_draft")
      .eq("tenant_id", tenantId)
      .eq("teacher_id", teacherId)
      .order("updated_at", { ascending: false })
      .limit(HABIT_RECENT_DRAFTS);
    if (error) {
      if (!isMentDraftTableMissingError(error))
        reportWarning("선생님 습관 판정 — 원문 조회 실패", { scope: "loadTeacherHabits", teacherId, message: error.message });
      return NO_HABITS;
    }
    const drafts = (data ?? []) as { report_id: string; ai_draft: string }[];
    if (!drafts.length) return NO_HABITS;
    const reports = await fetchInChunks<{ id: string; notes: string | null }>(
      drafts.map((d) => d.report_id),
      (chunk) => admin.from("lesson_reports").select("id, notes").eq("tenant_id", tenantId).in("id", chunk),
    );
    const notesOf = new Map(reports.map((r) => [r.id, r.notes ?? ""]));
    return learnTeacherHabits(drafts.map((d) => ({ ai: d.ai_draft, final: notesOf.get(d.report_id) ?? "" })));
  } catch (e) {
    reportWarning("선생님 습관 판정 실패", { scope: "loadTeacherHabits", teacherId, message: e instanceof Error ? e.message : String(e) });
    return NO_HABITS;
  }
}
