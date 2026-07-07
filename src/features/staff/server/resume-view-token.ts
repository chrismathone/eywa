import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * 직원 이력서 "열람 창" 토큰 — 본인 재인증(비밀번호 재입력) 성공 시 발급되는 단기 서명 쿠키.
 * 작성자·원장이 아닌 사무실 직원이 이력서 상세를 열람하려면 이 토큰이 유효해야 한다(민감 HR PII 보호).
 *
 * 서명 = HMAC-SHA256(userId.resumeId.exp, SERVICE_ROLE_KEY) → 위조 불가. userId·resumeId를 포함해
 * **다른 사용자에게도, 다른 이력서에도 전이되지 않는다**(A의 이력서를 풀어도 B의 이력서는 다시 재인증 필요 —
 * 한 번 입력으로 전 직원 주민번호·급여·계좌를 훑는 것 차단). exp로 10분 창(같은 이력서 새로고침·인쇄·수정은
 * 재입력 없이, 자리 비운 세션 오남용은 완화). 서버 전용 발급·검증(server-only), 쿠키는 httpOnly.
 */
export const RESUME_VIEW_COOKIE = "eywa_resume_view";
export const RESUME_VIEW_TTL_SEC = 600; // 10분

function hmacKey(): string {
  // 서버 전용 고엔트로피 시크릿 재사용(별도 env 불필요). 없으면 서명 불가 = 안전측 실패(항상 잠김).
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error("resume-view-token: SUPABASE_SERVICE_ROLE_KEY missing");
  return key;
}

function sign(payload: string): string {
  return createHmac("sha256", hmacKey()).update(payload).digest("base64url");
}

/** 이 사용자에게 이 이력서 전용 10분 열람 창 토큰 발급. 형식 `${exp}.${sig}` (exp = epoch seconds). */
export function signResumeViewToken(userId: string, resumeId: string, nowMs: number = Date.now()): string {
  const exp = Math.floor(nowMs / 1000) + RESUME_VIEW_TTL_SEC;
  const sig = sign(`${userId}.${resumeId}.${exp}`);
  return `${exp}.${sig}`;
}

/** 토큰이 이 사용자·이 이력서에 유효하고 만료 전인지. 위조·타 사용자·타 이력서·만료·형식오류는 전부 false. */
export function verifyResumeViewToken(
  token: string | undefined | null,
  userId: string,
  resumeId: string,
  nowMs: number = Date.now(),
): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= 0) return false;
  if (exp * 1000 <= nowMs) return false; // 만료
  let expected: string;
  try {
    expected = sign(`${userId}.${resumeId}.${exp}`);
  } catch {
    return false; // 시크릿 없음 = 안전측 잠김
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
