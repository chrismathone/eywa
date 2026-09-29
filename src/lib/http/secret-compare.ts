import { timingSafeEqual } from "node:crypto";

// 공유 비밀(크론·내부 API·반출 토큰) 비교 — **상수시간**(보안 감사 2026-09-29).
// `a !== b`는 첫 불일치 글자에서 멈춰 응답 시간으로 비밀을 한 글자씩 맞혀 볼 여지가 있다.
// 원래 AssemblyAI 웹훅(`secretMatches`)에만 있던 것을 공용으로 올렸다.

/** 상수시간 문자열 비교. 기대값이 비었으면 **항상 false**(env 누락 배포가 문을 여는 fail-open 방지). */
export function secretMatches(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!expected || provided == null) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** `Authorization: Bearer <secret>` 헤더 검증(상수시간). */
export function bearerMatches(header: string | null | undefined, secret: string | null | undefined): boolean {
  if (!secret) return false;
  return secretMatches(header, `Bearer ${secret}`);
}
