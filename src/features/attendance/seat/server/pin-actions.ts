"use server";

import { redirect } from "next/navigation";
import { getPublicBranding } from "@/features/owner/server/public-branding";
import { configuredLabPin, pinsMatch } from "../pin";
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

  const expected = configuredLabPin(branding.settings.operations.seatPins.lab);
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
