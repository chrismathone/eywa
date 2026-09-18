"use server";

import { redirect } from "next/navigation";
import { DEFAULT_SETTINGS } from "@/features/owner/defaults";
import { getPublicBrandingByTenantId, listPublicBranchChoices } from "@/features/owner/server/public-branding";
import { configuredSeatPin, explicitSeatPin, pinsMatch, resolveSeatPinTenant } from "../pin";
import { parseSeatKey } from "../seat";
import {
  delayAfterPinFail,
  markPinFailure,
  rateLimitKey,
  resolvePinSigningSecret,
  takePinAttempt,
  writeSeatPinCookie,
} from "./pin-session";

export type SeatPinResult = { error: string } | undefined;

const UNAVAILABLE = "지금은 이 화면을 쓸 수 없습니다. 관리자에게 문의하세요.";

/**
 * 자리(랩실·JJ실) 공개 출석부 PIN 제출 — 로그인 없음.
 *
 * 지점(테넌트) 판정은 URL이 아니라 **폼**이다(결정 C 2026-09-18 — URL에 지점을 넣지 않는다): 학원이 하나면 그
 * 하나, 둘 이상이면 화면의 지점 선택(`tenant`)이 목록 안에 있어야 한다([`resolveSeatPinTenant`](../pin.ts)).
 * 🔴 비밀번호는 **고른 지점의 학원설정**(`operations.seatPins[자리]`)으로 검증하고 쿠키에도 그 지점을 적는다 —
 *    브랜드 학원(`getPublicBranding`)으로 검증하면 B지점 태블릿이 A지점 비밀번호로 A지점 명단을 연다.
 * 🔴 순서 = 지점 판정 → **시도 제한** → 설정 조회(캐시) → 비교(적대 리뷰 2026-09-18): 시도 제한이 설정 조회 뒤에 서면
 *    한도가 다 찬 뒤에도 요청마다 DB 조회가 나가 제한기가 DB 부하를 못 막는다. 조회는 `loadTenantSettingsRaw`
 *    태그 캐시(`getPublicBrandingByTenantId`)라 종전(`getPublicBranding` 캐시 히트)과 같은 비용이고, 순간 장애 땐 캐시된
 *    진짜 값이 서빙된다.
 * 🔴 학원이 **둘 이상이면 명시한 PIN만**(`explicitSeatPin` — 원본 jsonb, 기본 7099 안 섞음 · **기본값과 같은 값도 미설정**):
 *    모든 지점이 공개 목록에 서므로 아직 PIN을 안 정한 새 지점이 저장소에 적힌 기본값으로 열리면 안 된다(운영 탭 첫 저장이
 *    기본값을 명시값처럼 적는다 — 재리뷰 2026-09-18). 학원 1개면 종전(2026-08-19 "설정 안 건드려도 배포 즉시 열려야")
 *    그대로 기본값을 쓴다.
 * ⚠️ 시도 제한 키는 지점을 **안 섞는다**(IP 단위 그대로) — 지점마다 따로 세면 지점을 갈아타며 4자리를 N배로
 *    시도할 수 있다. 전역 창(`GLOBAL_KEY`)도 그대로다.
 */
export async function submitSeatPin(
  _prev: SeatPinResult,
  formData: FormData,
): Promise<SeatPinResult> {
  const seat = parseSeatKey(String(formData.get("seat") ?? ""));
  if (!seat) return { error: "비밀번호가 맞지 않습니다" };

  if (!resolvePinSigningSecret()) {
    console.error("[seat-pin] 서명 비밀이 없습니다 — ENCRYPTION_KEY 또는 기존 서버 비밀을 확인하세요");
    return { error: UNAVAILABLE };
  }

  const branches = await listPublicBranchChoices();
  const multi = branches.length > 1;
  const tenantId = resolveSeatPinTenant(
    branches.map((b) => b.id),
    formData.get("tenant") == null ? null : String(formData.get("tenant")),
  );
  if (!tenantId) {
    return { error: multi ? "지점을 선택하세요" : UNAVAILABLE };
  }

  const key = await rateLimitKey();
  if (!takePinAttempt(key).ok) {
    await delayAfterPinFail();
    return { error: "비밀번호가 맞지 않습니다" };
  }

  // 🔴 그 **자리의** 비밀번호를 고른다 — 자리를 하드코딩하면 새 자리를 열 때 남의 비밀번호로 들어온다.
  //    비어 있으면 그 자리만 닫힌다(다른 자리는 그대로 열려 있다).
  const branding = await getPublicBrandingByTenantId(tenantId);
  if (!branding) return { error: UNAVAILABLE };
  const expected = multi
    ? explicitSeatPin(branding.raw, seat, DEFAULT_SETTINGS.operations.seatPins[seat])
    : configuredSeatPin(branding.settings.operations.seatPins[seat]);
  if (!expected) return { error: UNAVAILABLE };

  const pin = String(formData.get("pin") ?? "");
  if (!pinsMatch(pin, expected)) {
    markPinFailure(key);
    await delayAfterPinFail();
    return { error: "비밀번호가 맞지 않습니다" };
  }

  await writeSeatPinCookie({ tenantId, seat });
  redirect(`/seat/${seat}`);
}
