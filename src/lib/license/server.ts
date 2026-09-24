import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  LICENSE_BLOCKED_MESSAGE,
  licenseAllows,
  seatBlockedMessage,
  seatLimitOf,
  seatsExceeded,
  type LicensedFeature,
} from "./rule";

/**
 * 지점 기능 라이선스 조회 — 판정 규칙은 [`rule.ts`](./rule.ts)(행 없음 = 허용 · 명시로 끔/만료 = 차단 · 조회 실패 = 허용).
 * service_role로 읽는다: 웹훅·크론처럼 로그인 세션이 없는 경로도 같은 함수를 쓰기 때문(그래서 `tenantId`를 반드시 받는다).
 * 요청 안에서는 `cache`로 한 번만 읽는다(한 요청이 AI를 여러 번 불러도 조회 1회).
 */
export const isFeatureLicensed = cache(async (tenantId: string, feature: LicensedFeature): Promise<boolean> => {
  if (!tenantId) return true;
  try {
    const { data, error } = await createAdminClient()
      .from("tenant_licenses")
      .select("is_active, expires_at")
      .eq("tenant_id", tenantId)
      .eq("feature", feature)
      .maybeSingle();
    if (error) {
      console.error("[license] 조회 실패 — 허용으로 둔다", feature, error.message);
      return true;
    }
    return licenseAllows(data);
  } catch (e) {
    console.error("[license] 조회 예외 — 허용으로 둔다", feature, e);
    return true;
  }
});

/** 막혔으면 한글 사유, 아니면 null — 서버 액션이 `{ error }`로 그대로 돌려준다. */
export async function licenseBlockReason(tenantId: string, feature: LicensedFeature): Promise<string | null> {
  return (await isFeatureLicensed(tenantId, feature)) ? null : LICENSE_BLOCKED_MESSAGE[feature];
}

/**
 * 재원생 좌석 게이트 — 학생이 **재원이 되는 모든 경로**(신규 등록·수정·상태 복구·퇴원 복구·상담 전환·엑셀 가져오기)가 부른다.
 * 한도가 없으면(행 없음·끔·max 비어 있음) 조회 한 번으로 끝난다. 재원생 수는 `status = 'enrolled'` 머릿수(운영실·슈퍼관리자와 같은 기준).
 * `excludeStudentIds` = 이번에 바뀌는 기존 학생 — 이미 재원이면 자리를 두 번 세지 않게 뺀다.
 * ⚠️ 조회 실패는 허용(fail-open) — 좌석 표 장애로 등록 업무를 멈추지 않는다. 동시 등록 두 건이 마지막 한 자리를
 *    함께 통과할 수는 있다(한도는 계약 관리용이지 안전장치가 아니다 — 잠금까지 걸 가치가 없다).
 */
export async function seatBlockReason(
  tenantId: string,
  adding: number,
  excludeStudentIds: string[] = [],
): Promise<string | null> {
  if (!tenantId || adding <= 0) return null;
  try {
    const admin = createAdminClient();
    const { data: row, error } = await admin
      .from("tenant_licenses")
      .select("is_active, max_seats")
      .eq("tenant_id", tenantId)
      .eq("feature", "student_seats")
      .maybeSingle();
    if (error) {
      console.error("[license] 좌석 조회 실패 — 허용으로 둔다", error.message);
      return null;
    }
    const limit = seatLimitOf(row);
    if (limit === null) return null;
    let q = admin
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "enrolled");
    // 폼에서 온 id다 — 필터 문자열에 넣기 전 uuid 모양만 남긴다(PostgREST 필터 문법 주입 방지).
    const exclude = excludeStudentIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    if (exclude.length > 0) q = q.not("id", "in", `(${exclude.join(",")})`);
    const { count, error: cErr } = await q;
    if (cErr || count === null) {
      console.error("[license] 재원생 수 조회 실패 — 허용으로 둔다", cErr?.message);
      return null;
    }
    return seatsExceeded(limit, count, adding) ? seatBlockedMessage(limit, count) : null;
  } catch (e) {
    console.error("[license] 좌석 판정 예외 — 허용으로 둔다", e);
    return null;
  }
}
