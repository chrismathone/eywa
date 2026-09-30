/**
 * 보호 계정 판정의 순수 부분(Vitest) — 조회 결과를 받아 "보호 대상 id 집합"을 만든다.
 * `rows === null` = 조회 실패 → `lookupFailed`. **막는 쪽**으로 다루되(모르면 안 바꾼다) "보호 계정"과는 구분한다 —
 * 섞으면 보호 대상이 아닌 사람 이름으로 거짓 '거절' 감사로그가 남고 화면엔 거짓 '보호 계정' 안내가 뜬다(적대 리뷰 2026-09-30).
 */
export type ProtectedLookup = { protectedIds: Set<string>; lookupFailed: boolean };

export function protectedIdsFrom(wanted: readonly string[], rows: readonly { id: unknown }[] | null): ProtectedLookup {
  if (rows === null) return { protectedIds: new Set(), lookupFailed: true };
  const members = new Set(rows.map((r) => String(r.id)));
  return { protectedIds: new Set(wanted.filter((id) => members.has(id))), lookupFailed: false };
}

/** 한 계정의 상태 — protected(보호) · clear(아님) · unknown(조회 실패 = 막되 이유가 다르다). */
export type ProtectionStatus = "protected" | "clear" | "unknown";

export function protectionStatusOf(lookup: ProtectedLookup, id: string): ProtectionStatus {
  if (lookup.lookupFailed) return "unknown";
  return lookup.protectedIds.has(id) ? "protected" : "clear";
}
