/**
 * 자리 출석부 공개 PIN — 서명·검증·시도제한 **순수 규칙**(IO 없음, Vitest).
 *
 * 쿠키 값 = HMAC(tenantId|seat|exp). 비밀은 호출부가 넘긴다(여기선 env를 읽지 않음).
 * 실패 사유는 호출부가 화면에 흘리지 않는다 — 여기 반환값도 통과/거절만.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { PIN_SEAT_KEYS, type SeatKey } from "./seat";

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
  if (!(PIN_SEAT_KEYS as readonly string[]).includes(seatRaw)) return null;
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

/**
 * 그 자리의 학원설정 비밀번호(`operations.seatPins[자리]`) — 비어 있으면 **그 자리 공개 접속을 끈다**.
 *
 * ⚠️ 자리 중립이다. 랩실·JJ실 모두 기본값 7099(defaults)이고, 원장이 학원설정에서
 *    자리별로 바꾸거나 비워서 그 자리만 닫는다. 자리를 하드코딩하면 새 자리가 남의 비밀번호로 열린다.
 */
export function configuredSeatPin(raw: string | null | undefined): string | null {
  const v = normalizePin(raw);
  return v.length > 0 ? v : null;
}

/**
 * 자리 PIN 화면이 **어느 지점(테넌트)** 의 비밀번호로 검증할지 — 순수 판정.
 *
 * URL에 지점이 없다(결정 C, 2026-09-18)라 로그인 전 화면은 지점을 스스로 모른다. 학원이 하나면 그 하나로 확정하고,
 * 둘 이상이면 화면의 지점 선택값이 목록 안에 있을 때만 그 지점이다.
 * 🔴 여럿인데 선택이 없거나 목록 밖이면 null — 첫 지점으로 떨어뜨리면 A지점 태블릿이 B지점 명단을 연다.
 */
export function resolveSeatPinTenant(tenantIds: readonly string[], chosen: string | null | undefined): string | null {
  if (tenantIds.length === 0) return null;
  if (tenantIds.length === 1) return tenantIds[0]!;
  const want = chosen?.trim();
  return want && tenantIds.includes(want) ? want : null;
}

/**
 * 학원설정 **원본 jsonb**에서 그 자리의 비밀번호만 — 기본값(DEFAULT_SETTINGS의 7099)을 **섞지 않는다**.
 *
 * 학원이 둘 이상이면 자리 PIN 화면이 모든 지점을 공개 목록에 세우므로, 아직 PIN을 정하지 않은 새 지점이 공개 저장소에
 * 적힌 기본 7099로 열리면 안 된다(적대 리뷰 2026-09-18). 그래서 멀티테넌트에선 **명시한 값만** 인정한다 — 학원 1개일 때의
 * "설정 안 건드려도 배포 즉시 열려야"(2026-08-19)는 그 전제(학원 1개)에서만 그대로다.
 * 원본이 객체가 아니거나 칸이 없으면 null(= 그 자리 닫힘). 값의 정리는 `configuredSeatPin`이 한다.
 * 🔴 **저장소 기본값과 같은 값도 "미설정"이다**(`shippedDefault`, 재리뷰 2026-09-18): 운영 탭 폼은 기본값이 병합된
 *    설정으로 시작하고 `saveOwnerSection`이 섹션을 통째로 upsert하므로, 새 지점에서 과목 하나 넣고 저장만 해도 jsonb에
 *    `seatPins:{lab:"7099"}`가 **명시값처럼** 적힌다 — 그걸 인정하면 이 가드가 첫 저장에서 무너진다. 그래서 지점이 둘
 *    이상이면 7099(기본값)는 자리 PIN으로 쓸 수 없다(원장이 다른 값을 정해야 열린다).
 */
export function explicitSeatPin(rawSettings: unknown, seat: SeatKey, shippedDefault: string | null | undefined): string | null {
  if (!rawSettings || typeof rawSettings !== "object") return null;
  const ops = (rawSettings as { operations?: unknown }).operations;
  if (!ops || typeof ops !== "object") return null;
  const pins = (ops as { seatPins?: unknown }).seatPins;
  if (!pins || typeof pins !== "object") return null;
  const v = (pins as Record<string, unknown>)[seat];
  const pin = typeof v === "string" ? configuredSeatPin(v) : null;
  if (!pin) return null;
  const def = configuredSeatPin(shippedDefault);
  return def && pinsMatch(pin, def) ? null : pin;
}
