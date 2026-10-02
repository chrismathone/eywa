/**
 * 학부모 출결 연락 벨의 받는 사람 조립 — 순수 함수(Vitest).
 *
 * 받는 사람은 두 갈래다:
 *  ① 직원설정에서 '학생 출결 알림 받기'를 켠 계정(전 학생, 원장 2026-08-06).
 *  ② 그 학생의 **다른 과목 지금 담당 선생님**(0331a, 원장 2026-10-02) — 연동 PC가 원문 행의 `cross_teacher_ids`에 적어 둔다.
 * 한 사람이 양쪽에 다 있으면 벨은 한 줄만.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 한 연락에 붙을 수 있는 다른 과목 담당 상한 — 워커의 수신자 상한(5명)보다 넉넉히. 그보다 많으면 저장값이 이상한 것이다. */
const CROSS_LIMIT = 10;

/** 저장된 jsonb(`cross_teacher_ids`) → 계정 id 목록. 배열이 아니거나 모양이 다른 원소는 버린다(jsonb라 무엇이든 올 수 있다). */
export function crossTeacherIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v === "string" && UUID.test(v) && !out.includes(v)) out.push(v);
    if (out.length >= CROSS_LIMIT) break;
  }
  return out;
}

/** 토글 켠 계정 + 다른 과목 담당 — 순서는 토글 계정 먼저, 중복 없이. */
export function mergeAlertTargets(optedIn: readonly string[], cross: readonly string[]): string[] {
  return [...new Set([...optedIn, ...cross])];
}
