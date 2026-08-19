"use server";

import { redirect } from "next/navigation";
import { getPublicBranding } from "@/features/owner/server/public-branding";
import { configuredSeatPin, pinsMatch } from "../pin";
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

/**
 * 공개 자리 출석부 PIN 검증. 통과하면 httpOnly 쿠키를 굽고 같은 주소로 보낸다.
 * 실패 사유는 화면에 흘리지 않는다 — 메시지는 하나뿐.
 */
export async function submitSeatPin(
  _prev: SeatPinResult,
  formData: FormData,
): Promise<SeatPinResult> {
  const seat = parseSeatKey(String(formData.get("seat") ?? ""));
  if (!seat) return { error: "비밀번호가 맞지 않습니다" };

  if (!resolvePinSigningSecret()) {
    console.error("[seat-pin] 서명 비밀이 없습니다 — ENCRYPTION_KEY 또는 기존 서버 비밀을 확인하세요");
    return { error: "지금은 이 화면을 쓸 수 없습니다. 관리자에게 문의하세요." };
  }

  const branding = await getPublicBranding();
  if (!branding) return { error: "지금은 이 화면을 쓸 수 없습니다. 관리자에게 문의하세요." };

  // 🔴 그 **자리의** 비밀번호를 고른다 — 자리를 하드코딩하면 새 자리를 열 때 남의 비밀번호로 들어온다.
  //    비어 있으면 그 자리만 닫힌다(다른 자리는 그대로 열려 있다).
  const expected = configuredSeatPin(branding.settings.operations.seatPins[seat]);
  if (!expected) return { error: "지금은 이 화면을 쓸 수 없습니다. 관리자에게 문의하세요." };

  const key = await rateLimitKey();
  if (!takePinAttempt(key).ok) {
    await delayAfterPinFail();
    return { error: "비밀번호가 맞지 않습니다" };
  }

  const pin = String(formData.get("pin") ?? "");
  if (!pinsMatch(pin, expected)) {
    markPinFailure(key);
    await delayAfterPinFail();
    return { error: "비밀번호가 맞지 않습니다" };
  }

  await writeSeatPinCookie({ tenantId: branding.tenantId, seat });
  redirect(`/seat/${seat}`);
}
