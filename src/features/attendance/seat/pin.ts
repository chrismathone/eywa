/**
 * 자리 출석부 공개 PIN — 서명·검증·시도제한 **순수 규칙**(IO 없음, Vitest).
 *
 * 쿠키 값 = HMAC(tenantId|seat|exp). 비밀은 호출부가 넘긴다(여기선 env를 읽지 않음).
 * 실패 사유는 호출부가 화면에 흘리지 않는다 — 여기 반환값도 통과/거절만.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { OPEN_SEAT_KEYS, type SeatKey } from "./seat";

export const SEAT_PIN_COOKIE = "eywa_seat_pin";
export const SEAT_PIN_TTL_MS = 12 * 60 * 60 * 1000;
export const SEAT_PIN_RL_MAX = 10;
export const SEAT_PIN_RL_WINDOW_MS = 10 * 60 * 1000;
/**
 * 🔴 **키와 무관한 전체 상한** — IP별 상한만 두면 헤더·회선을 바꿔가며 사실상 무제한이 된다
 * (4자리 = 1만 가지라 그 차이가 곧 뚫림/막힘이다). 이 인스턴스에서 창당 총 실패가 이 수를 넘으면
 * 키가 무엇이든 더 안 받는다. ⚠️ 그래도 **인스턴스 메모리**라 서버리스에선 best-effort다 —
 * 진짜 방어는 주소를 추측 불가능하게 만들거나(경로 토큰) 자릿수를 늘리는 것.
 */
export const SEAT_PIN_RL_GLOBAL_MAX = 40;
export const SEAT_PIN_FAIL_DELAY_MS = 400;

export type SeatPinPayload = { tenantId: string; seat: SeatKey; exp: number };

/** 입력 PIN을 비교용으로 정규화 — 앞뒤 공백만. 자리 0은 의미 있을 수 있어 지우지 않는다. */
export function normalizePin(raw: string | null | undefined): string {
  return (raw ?? "").normalize("NFKC").trim();
}

/** 두 PIN이 같은지. 길이가 달라도 해시 비교를 한 번 해서 길이로 바로 빠지지 않게 한다. */
export function pinsMatch(input: string, expected: string): boolean {
  const a = Buffer.from(normalizePin(input), "utf8");
  const b = Buffer.from(normalizePin(expected), "utf8");
  const ha = createHmac("sha256", "pin").update(a).digest();
  const hb = createHmac("sha256", "pin").update(b).digest();
  const hashOk = timingSafeEqual(ha, hb);
  return a.length === b.length && hashOk && timingSafeEqual(a, b);
}

export function signSeatPin(p: SeatPinPayload, secret: string): string {
  const body = `${p.tenantId}|${p.seat}|${p.exp}`;
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${Buffer.from(body, "utf8").toString("base64url")}.${sig}`;
}

export function verifySeatPin(
  token: string | null | undefined,
  secret: string,
  nowMs: number = Date.now(),
): SeatPinPayload | null {
  if (!token || !secret) return null;
  const [bodyB64, sig] = token.split(".");
  if (!bodyB64 || !sig) return null;
  let body: string;
  try {
    body = Buffer.from(bodyB64, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const got = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (got.length !== expBuf.length || !timingSafeEqual(got, expBuf)) return null;

  const [tenantId, seatRaw, expStr] = body.split("|");
  if (!tenantId || !seatRaw || !expStr) return null;
  if (!(OPEN_SEAT_KEYS as readonly string[]).includes(seatRaw)) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= nowMs) return null;
  return { tenantId, seat: seatRaw as SeatKey, exp };
}

export type PinAttemptWindow = { count: number; resetAt: number };

/** 이 창에서 한 번 더 시도해도 되는지. 창이 지났으면 리셋된 창을 돌려준다(호출부가 저장). */
export function nextPinAttempt(
  prev: PinAttemptWindow | null | undefined,
  nowMs: number,
  /** 상한 — 기본은 키(IP)별, 전체 창은 `SEAT_PIN_RL_GLOBAL_MAX`를 넘겨 쓴다. */
  max: number = SEAT_PIN_RL_MAX,
): { ok: true; next: PinAttemptWindow } | { ok: false; next: PinAttemptWindow } {
  const fresh = !prev || nowMs >= prev.resetAt;
  const window: PinAttemptWindow = fresh
    ? { count: 0, resetAt: nowMs + SEAT_PIN_RL_WINDOW_MS }
    : { count: prev.count, resetAt: prev.resetAt };
  if (window.count >= max) return { ok: false, next: window };
  return { ok: true, next: window };
}

export function recordPinFailure(window: PinAttemptWindow): PinAttemptWindow {
  return { count: window.count + 1, resetAt: window.resetAt };
}

/** 학원설정에 비밀번호가 비어 있으면 공개 접속을 끈다(기본값 7099는 defaults가 채움). */
export function configuredLabPin(raw: string | null | undefined): string | null {
  const v = normalizePin(raw);
  return v.length > 0 ? v : null;
}
