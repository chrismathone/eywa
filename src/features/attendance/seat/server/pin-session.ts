import "server-only";
import { cookies, headers } from "next/headers";
import { parseForwardedFor } from "@/features/attendance/kiosk/device-info";
import {
  nextPinAttempt,
  recordPinFailure,
  SEAT_PIN_COOKIE,
  SEAT_PIN_FAIL_DELAY_MS,
  SEAT_PIN_TTL_MS,
  signSeatPin,
  verifySeatPin,
  type PinAttemptWindow,
  type SeatPinPayload,
} from "../pin";
import { OPEN_SEAT_KEYS, type SeatKey } from "../seat";

/**
 * 쿠키 HMAC 비밀 — 새 env를 요구하지 않는다.
 * ENCRYPTION_KEY가 있으면 그걸 쓰고, 없으면 이미 있는 서버 비밀로 폴백.
 * 전부 없으면 null(호출부가 기능을 죽이지 않고 안내).
 */
export function resolvePinSigningSecret(): string | null {
  for (const key of [
    "ENCRYPTION_KEY",
    "ASSEMBLYAI_WEBHOOK_SECRET",
    "CRON_SECRET",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]) {
    const v = process.env[key]?.trim();
    if (v) return v;
  }
  return null;
}

export async function readSeatPinSession(): Promise<SeatPinPayload | null> {
  const secret = resolvePinSigningSecret();
  if (!secret) return null;
  const jar = await cookies();
  return verifySeatPin(jar.get(SEAT_PIN_COOKIE)?.value, secret);
}

export async function writeSeatPinCookie(p: { tenantId: string; seat: SeatKey }): Promise<void> {
  const secret = resolvePinSigningSecret();
  if (!secret) throw new Error("signing-secret-missing");
  if (!(OPEN_SEAT_KEYS as readonly string[]).includes(p.seat)) {
    throw new Error("seat-not-open");
  }
  const exp = Date.now() + SEAT_PIN_TTL_MS;
  const jar = await cookies();
  jar.set(SEAT_PIN_COOKIE, signSeatPin({ tenantId: p.tenantId, seat: p.seat, exp }, secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    // path=/ — 서버 액션 POST가 페이지 경로와 다를 수 있어 /seat 로 좁히면 쓰기가 쿠키를 못 본다.
    path: "/",
    maxAge: Math.floor(SEAT_PIN_TTL_MS / 1000),
  });
}

/** 프로세스 메모리 시도창 — 같은 인스턴스에서 IP별 10회/10분. 멀티 인스턴스는 best-effort. */
const attempts = new Map<string, PinAttemptWindow>();

export async function rateLimitKey(): Promise<string> {
  const h = await headers();
  const ip = parseForwardedFor(h.get("x-forwarded-for"), h.get("x-real-ip"));
  return ip ?? "unknown";
}

export function takePinAttempt(key: string, nowMs = Date.now()): { ok: boolean } {
  const decided = nextPinAttempt(attempts.get(key), nowMs);
  attempts.set(key, decided.next);
  return { ok: decided.ok };
}

export function markPinFailure(key: string): void {
  const cur = attempts.get(key);
  if (!cur) return;
  attempts.set(key, recordPinFailure(cur));
}

export function delayAfterPinFail(): Promise<void> {
  return new Promise((r) => setTimeout(r, SEAT_PIN_FAIL_DELAY_MS));
}
