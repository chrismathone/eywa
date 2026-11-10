import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logDbError } from "@/lib/supabase/db-error";

/**
 * 상담 삭제 전 확인 — 그 상담에 걸린 전화·방문·등록 기록 수(s2_0062 · 서버 전용 표라 admin + 지점 필터 · 행은 안 받는다).
 * `active` = 집계 제외가 아닌 기록(있으면 삭제를 막는다) · `voided` = 집계 제외 기록(상담과 함께 지워진다 — 감사로그에 수를 남긴다).
 * 🔴 이 확인은 **안내용**이다. '확인 → 삭제' 사이에 들어온 기록은 DB 트리거(s2_0063)가 막는다 — 여기만 믿지 말 것.
 * 못 세면 null — 호출부는 삭제를 막지 않고(트리거가 지킨다) 감사로그에 '못 셈'으로 남긴다.
 */
export const JOURNEY_DELETE_BLOCKED = "전화·방문·등록 기록이 있는 상담은 삭제할 수 없습니다. 잘못 입력한 기록은 '집계 제외'로 돌리거나, 중복 상담이면 병합해 주세요.";

export async function countJourneyRecords(tenantId: string, consultationId: string): Promise<{ active: number; voided: number } | null> {
  const admin = createAdminClient();
  const count = (voided: boolean) => admin.from("enrollment_journey_records").select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId).eq("consultation_id", consultationId).eq("voided", voided);
  const [active, voided] = await Promise.all([count(false), count(true)]);
  for (const res of [active, voided]) {
    if (res.error) { logDbError(res.error, "enrollment.journey.countForDelete", { consultationId }); return null; }
  }
  return { active: active.count ?? 0, voided: voided.count ?? 0 };
}

/** DB 트리거(s2_0063)가 삭제를 막았나 — 사전 확인 뒤에 들어온 기록. 판정은 트리거가 던진 문구 앞머리로(코드는 일반 예외라 못 가른다). */
export const isJourneyDeleteBlocked = (error: { message?: string } | null | undefined) =>
  !!error?.message?.includes("전화·방문·등록 기록이 있는 상담은 삭제할 수 없습니다");
