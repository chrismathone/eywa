import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { logDbError } from "@/lib/supabase/db-error";
import { OWNER_RUBRIC_ID } from "@/features/report-rating/harness/owner";
import type { RatingRow } from "../view-admin";

/**
 * 선생님별 수업보고서 평점 평균(s2_0089) — 업무 완성도 선생님 표의 참고 열(원장 2026-11-11). 준수율 · 등급에는 들지 않는다.
 *
 * 🔴 평점은 선생님 보고서를 평가한 값이다 — 호출부가 **수업보고서 쓰기 권한**을 확인한 사람에게만 부른다(평점 열람과 같은 문 · `report-ratings.ts`).
 * 🔴 지금 기준(`OWNER_RUBRIC_ID`)으로 매긴 줄만 · 합계는 DB에서(B2).
 * ⚠️ 참고 값이라 화면을 막지 않는다 — 함수가 없거나(#95) 읽지 못하면 로그만 남기고 빈 값(열이 안 선다).
 */
export async function loadReportRatingRows(tenantId: string, from: string, to: string, subjects: string[] | null): Promise<RatingRow[]> {
  try {
    const rows = await fetchAllPaged<{ owner_id: string; subject: string | null; rated: number | string; avg_points: number | string }>((a, b) =>
      createAdminClient().rpc("duty_report_rating_by_owner", { p_tenant: tenantId, p_from: from, p_to: to, p_rubric: OWNER_RUBRIC_ID, p_subjects: subjects }).order("owner_id").order("subject").range(a, b));
    return rows.map((r) => ({ ownerId: r.owner_id, subject: r.subject, rated: Number(r.rated), avg: Number(r.avg_points) })).filter((r) => r.rated > 0 && Number.isFinite(r.avg));
  } catch (e) {
    logDbError(e, "duties.ratings", { from, to });
    return [];
  }
}
