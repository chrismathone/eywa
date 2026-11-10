import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { logDbError } from "@/lib/supabase/db-error";
import { CONSULT_RUBRIC_ID } from "../harness/rubric";
import { parseConsultationRating, type ConsultationRating, type ConsultationRatingDbRow } from "../rating";

/**
 * 원생상담 평점(참고용) 읽기 — 목록 한 쪽의 상담 id만.
 *
 * 🔴 호출부가 **지점 스위치(consult_rating)와 상담 쓰기 권한**(canWriteTenant 'consultations')을 먼저 확인한다 — 상담자의 기록을 평가한 값이라
 *    열람 권한만으로는 내려보내지 않는다(#77, 화면 조건은 게이트가 아니다).
 * 🔴 표는 RLS 정책이 0개(의도적)라 세션 클라이언트로는 에러 없이 0행이다(#104) → admin + **tenant_id 필터**.
 * ⚠️ 평점은 참고용이라 목록을 막지 않는다: 표가 없으면(s2_0044 적용 전, #95) 조용히 빈 값, 그 밖의 오류는 로그만 남기고 빈 값(#138) — 어느 쪽이든
 *    목록은 평점 '—'로 그대로 뜬다.
 * 🔴 **지금 기준(CONSULT_RUBRIC_ID)으로 매긴 줄만** 읽는다 — 옛 기준 값은 표에 남아도 화면에 내보내지 않는다.
 */
const COLS = "consultation_id, points, reason, evidence, kinds, checks, rule, basis, rated_on";

export function isMissingConsultationRatings(e: unknown): boolean {
  const o = e && typeof e === "object" ? (e as { code?: unknown; message?: unknown }) : {};
  if (o.code === "42P01" || o.code === "PGRST205") return true;
  return typeof o.message === "string" && /student_consultation_ratings/.test(o.message) && /schema cache|does not exist/.test(o.message);
}

export async function loadConsultationRatings(tenantId: string, consultationIds: readonly string[]): Promise<Map<string, ConsultationRating>> {
  const ids = [...new Set(consultationIds.filter((id) => typeof id === "string" && id !== ""))];
  const out = new Map<string, ConsultationRating>();
  if (!tenantId || ids.length === 0) return out;
  try {
    const admin = createAdminClient();
    const rows = await fetchInChunks<ConsultationRatingDbRow>(ids, (chunk) =>
      admin.from("student_consultation_ratings").select(COLS).eq("tenant_id", tenantId).eq("rubric", CONSULT_RUBRIC_ID).in("consultation_id", chunk),
    );
    for (const row of rows) {
      const rating = parseConsultationRating(row);
      if (rating) out.set(row.consultation_id, rating);
    }
    return out;
  } catch (e) {
    if (!isMissingConsultationRatings(e)) logDbError(e, "consultation-rating.read", { consultations: ids.length });
    return new Map();
  }
}
