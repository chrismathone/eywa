"use server";

import { redirect } from "next/navigation";
import { getPublicBrandingByTenantId, listPublicBranchChoices } from "@/features/owner/server/public-branding";
import { configuredSeatPin, pinsMatch, resolveSeatPinTenant } from "../pin";
import { parseSeatKey } from "../seat";
import { isModuleEnabled } from "@/lib/modules";
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
 * 🔑 비밀번호 = 고른 지점의 학원설정 값(저장이 없으면 기본 **0000**) — 학원이 하나든 여럿이든 같은 규칙이다
 *    (원장 2026-09-22 *"새로운 지점들은 기본 비밀번호 0000으로. 세팅되게."*). 새 지점은 0000으로 바로 열리고, 지점장이
 *    학원설정 → 운영 → '자리 출석부 비밀번호'에서 바꾼다. ⚠️ 종전(2026-09-18)엔 여럿이면 저장소 기본값과 같은 값을 안 받았다
 *    (`explicitSeatPin` — 안 바꾼 지점이 공개된 기본값으로 열리지 않게). 원장 지시로 폐기했다 — 되살리면 새 지점의 0000이 막힌다.
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
  // 자습실(자리) 모듈이 꺼진 지점엔 공개 자리 화면이 없다 — PIN이 기본값(0000)이어도 문을 열지 않는다(2026-09-22 방향 B).
  // 침산은 모듈이 켜져 있어 종전과 같다.
  if (!isModuleEnabled(branding.settings.modules.disabled, "seat_attendance")) return { error: UNAVAILABLE };
  const expected = configuredSeatPin(branding.settings.operations.seatPins[seat]);
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
