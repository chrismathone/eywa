import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  LICENSE_BLOCKED_MESSAGE,
  licenseAllows,
  licenseExplicitlyOn,
  seatBlockedMessage,
  seatLimitOf,
  seatsExceeded,
  type LicensedFeature,
  type OptInFeature,
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

/**
 * 기본 꺼짐 기능(외부 앱 연결)의 조회 — 슈퍼관리자가 **켠 행이 있을 때만** true.
 * 🔴 조회가 실패하면 **꺼짐**(fail-closed) — 위 `isFeatureLicensed`와 반대다. 이 기능들은 멈춰도 원내 업무가 서지 않고
 *    (링크 하나·외부 반출), 잘못 열리면 계약하지 않은 지점의 데이터가 나간다.
 */
export const isFeatureOptedIn = cache(async (tenantId: string, feature: OptInFeature): Promise<boolean> => {
  if (!tenantId) return false;
  try {
    const { data, error } = await createAdminClient()
      .from("tenant_licenses")
      .select("is_active, expires_at")
      .eq("tenant_id", tenantId)
      .eq("feature", feature)
      .maybeSingle();
    if (error) {
      console.error("[license] 조회 실패 — 꺼짐으로 둔다", feature, error.message);
      return false;
    }
    return licenseExplicitlyOn(data);
  } catch (e) {
    console.error("[license] 조회 예외 — 꺼짐으로 둔다", feature, e);
    return false;
  }
});

/** 화면(클라)에 내려 보내는 라이선스 표 — 켜고 끄는 기능 넷. */
export type LicenseFlags = Record<LicensedFeature, boolean>;
const LICENSED_FEATURES: readonly LicensedFeature[] = ["ai_analysis", "google_sheets", "meeting_recording", "window_mode"];
const ALL_ON: LicenseFlags = { ai_analysis: true, google_sheets: true, meeting_recording: true, window_mode: true };

/** 라이선스 표시용 캐시 태그(tenantId별) — 슈퍼관리자 라이선스 카드가 켜고 끌 때 `updateTag`로 비운다. */
export function licenseFlagsTag(tenantId: string): string {
  return `tenant-licenses:${tenantId}`;
}

/** 캐시 안 조회 — 실패는 던져서 **캐시하지 않는다**(설정 캐시 loadTenantSettingsRaw와 같은 규약). */
const loadLicenseFlagsCached = (tenantId: string) =>
  unstable_cache(
    async (): Promise<LicenseFlags> => {
      const { data, error } = await createAdminClient()
        .from("tenant_licenses")
        .select("feature, is_active, expires_at")
        .eq("tenant_id", tenantId)
        .in("feature", [...LICENSED_FEATURES]);
      if (error) throw new Error(`tenant_licenses read failed: ${error.message}`);
      const out: LicenseFlags = { ...ALL_ON };
      for (const r of (data ?? []) as { feature: LicensedFeature; is_active: boolean; expires_at: string | null }[]) {
        if (LICENSED_FEATURES.includes(r.feature)) out[r.feature] = licenseAllows(r);
      }
      return out;
    },
    ["tenant-license-flags-v1", tenantId],
    // 셸이 창(iframe)마다 부르는 값이라 테넌트 캐시(B6). 만료는 표시에 영향이 없게 짧게 — 즉시 반영은 updateTag.
    { tags: [licenseFlagsTag(tenantId)], revalidate: 300 },
  )();

/**
 * 이 지점의 라이선스 넷을 **한 번에** — 셸이 화면 표시용으로 내려 보낸다(꺼진 기능의 버튼을 감추려고,
 * 원장 2026-09-30 "꺼지면 있었는지조차 모르게"). 판정은 `isFeatureLicensed`와 같다(행 없음 = 켜짐 · 조회 실패 = 켜짐).
 * ⚠️ 표시용이다 — 막는 것은 각 서버 경로의 `isFeatureLicensed`/`licenseBlockReason`이 따로 한다(캐시 없이).
 * 🔑 tenantId별 `unstable_cache`(창마다 셸이 다시 돈다 — B6) + 요청 cache.
 */
export const getLicenseFlags = cache(async (tenantId: string): Promise<LicenseFlags> => {
  if (!tenantId) return ALL_ON;
  try {
    return await loadLicenseFlagsCached(tenantId);
  } catch (e) {
    console.error("[license] 표 조회 실패 — 켜짐으로 둔다", e);
    return ALL_ON;
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
