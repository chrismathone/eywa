"use server";

// 원장 보고서 관리 — ClassNote 발송 큐 관리 액션(재발송·멈춤복구). 쓰기는 owner 메뉴 권한(위임 반영).
// edutrix retrySelectedClassNoteReports/resetStuckClassNoteReports 이식. 과거일 재발송 사고 방지(isClassnoteAllowed).
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { isClassnoteAllowed } from "@/features/onescreen/classnote-guard";
import { STUCK_MINUTES } from "../classnote-queue";

/**
 * 실패/오래됨 보고서 재발송 — queued로 되돌려 워커가 다시 잡게 한다. retry_count·error 초기화.
 * **과거일(전 달 1일 이전)은 재차단**(isClassnoteAllowed) — 옛 보고서 대량 오발송 방지(edutrix 사고 교훈).
 */
export async function retryClassnote(ids: string[]): Promise<{ ok: boolean; requeued?: number; skipped?: number; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "owner"))) return { ok: false, error: "보고서 관리 권한이 없습니다" };
  if (!ids?.length) return { ok: false, error: "대상이 없습니다" };
  const supabase = await createClient();

  // 대상 보고서 날짜 조회(과거일 차단 재확인). RLS 테넌트 스코프.
  const { data: rows } = await supabase.from("lesson_reports").select("id, report_date").in("id", ids.slice(0, 200));
  const allowed = (rows ?? []).filter((r) => isClassnoteAllowed(r.report_date as string)).map((r) => r.id as string);
  const skipped = (rows?.length ?? 0) - allowed.length;
  if (allowed.length === 0) return { ok: true, requeued: 0, skipped };

  const { error } = await supabase
    .from("lesson_reports")
    .update({
      classnote_status: "queued",
      classnote_queued_at: new Date().toISOString(),
      classnote_processing_at: null,
      classnote_retry_count: 0,
      classnote_error: null,
    })
    .in("id", allowed);
  if (error) return { ok: false, error: error.message };
  return { ok: true, requeued: allowed.length, skipped };
}

/**
 * 멈춤복구 — processing인데 STUCK_MINUTES 넘게 안 끝난 것(워커 크래시·PC 꺼짐)을 queued로 되돌려 재처리.
 */
export async function resetStuckClassnote(): Promise<{ ok: boolean; reset?: number; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "owner"))) return { ok: false, error: "보고서 관리 권한이 없습니다" };
  const supabase = await createClient();
  const cutoff = new Date(Date.now() - STUCK_MINUTES * 60_000).toISOString();
  const { data, error } = await supabase
    .from("lesson_reports")
    .update({
      classnote_status: "queued",
      classnote_queued_at: new Date().toISOString(),
      classnote_processing_at: null,
    })
    .eq("classnote_status", "processing")
    .lt("classnote_processing_at", cutoff)
    .select("id");
  if (error) return { ok: false, error: error.message };
  return { ok: true, reset: (data ?? []).length };
}
