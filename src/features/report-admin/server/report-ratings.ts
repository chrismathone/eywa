import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { logDbError } from "@/lib/supabase/db-error";
import { parseRating, type RatingDbRow, type ReportRating } from "../report-rating";

/**
 * 수업보고서 평점(참고용, 0450a) 읽기 — 목록 한 페이지의 보고서 id만.
 *
 * 🔴 호출부가 **수업보고서 쓰기 권한**(canWriteTenant 'lesson_reports')을 먼저 확인한다 — 선생님 보고서를 평가한
 *    값이라 열람 권한만으로는 내려보내지 않는다(#77, 화면 조건은 게이트가 아니다).
 * 🔴 표는 RLS 정책이 0개(의도적)라 세션 클라이언트로는 에러 없이 0행이다(#104) → admin + **tenant_id 필터**.
 * ⚠️ 평점은 참고용이라 목록을 막지 않는다: 표가 없으면(0450a 적용 전, #95) 조용히 빈 값, 그 밖의 오류는
 *    로그만 남기고 빈 값(#138) — 어느 쪽이든 목록은 평점 '—'로 그대로 뜬다.
 */
const COLS = "report_id, points, items, parent_feeling, suggestion, claim, claim_reason, rated_on";

/**
 * 표가 없다 — PostgREST PGRST205 / Postgres 42P01. `fetchInChunks`는 오류를 **메시지로만** 다시 던지므로
 * 코드가 없으면 메시지(표 이름 + schema cache/does not exist)로 가린다.
 */
export function isMissingRatingsTable(e: unknown): boolean {
  const o = e && typeof e === "object" ? (e as { code?: unknown; message?: unknown }) : {};
  if (o.code === "42P01" || o.code === "PGRST205") return true;
  return typeof o.message === "string" && /lesson_report_ratings/.test(o.message) && /schema cache|does not exist/.test(o.message);
}

export async function loadReportRatings(tenantId: string, reportIds: readonly string[]): Promise<Map<string, ReportRating>> {
  const ids = [...new Set(reportIds.filter((id) => typeof id === "string" && id !== ""))];
  const out = new Map<string, ReportRating>();
  if (!tenantId || ids.length === 0) return out;
  try {
    const admin = createAdminClient();
    const rows = await fetchInChunks<RatingDbRow>(ids, (chunk) =>
      admin.from("lesson_report_ratings").select(COLS).eq("tenant_id", tenantId).in("report_id", chunk),
    );
    for (const row of rows) {
      const rating = parseRating(row);
      if (rating) out.set(row.report_id, rating);
    }
    return out;
  } catch (e) {
    if (!isMissingRatingsTable(e)) logDbError(e, "report-admin.ratings", { reports: ids.length });
    return new Map();
  }
}
