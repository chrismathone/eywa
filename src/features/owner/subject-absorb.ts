// 과목 흡수(absorb) 순수 헬퍼 — 과목 삭제 시 그 과목을 참조하는 데이터를 다른 과목 키로 옮기는 변환.
// 서버 액션(owner/server/subject-actions.ts)이 users.subjects[]·jsonb 컬럼 변환에 사용. Vitest 커버.

/**
 * text[] 배열(users.subjects)에서 from → to 치환 + 중복 제거(순서 보존).
 * from이 없으면 null(변경 불필요). [math, english]에서 math→english면 [english] (중복 1회).
 */
export function absorbSubjectInArray(arr: string[], from: string, to: string): string[] | null {
  if (!arr.includes(from)) return null;
  const out: string[] = [];
  for (const k of arr) {
    const v = k === from ? to : k;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * 과목 키로 키잉된 jsonb(enrollment_consultations.subject_details·onescreen subject_progress)에서
 * from 키를 to로 개명. 양쪽 키가 다 있으면 값(객체)을 얕은 병합하되 **to 우선**(to에 없던 from 필드만
 * 살리고 겹치는 필드는 to 보존 — 통째 폐기 없이 최선 보존). from이 없으면 null(변경 불필요).
 */
export function absorbJsonSubjectKey(
  obj: unknown,
  from: string,
  to: string,
): Record<string, unknown> | null {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const rec = obj as Record<string, unknown>;
  if (!(from in rec)) return null;
  const { [from]: fromVal, ...rest } = rec;
  const toVal = rest[to];
  const bothObjects =
    fromVal !== null && typeof fromVal === "object" && !Array.isArray(fromVal) &&
    toVal !== null && toVal !== undefined && typeof toVal === "object" && !Array.isArray(toVal);
  const merged = bothObjects
    ? { ...(fromVal as Record<string, unknown>), ...(toVal as Record<string, unknown>) }
    : (toVal ?? fromVal);
  return { ...rest, [to]: merged };
}

/** 과목 키 형식 가드 — 자동 생성 키(math·english·subject_N…)만 통과(PostgREST json path 주입 방지). */
export function isValidSubjectKey(key: string): boolean {
  return /^[a-z0-9_]{1,40}$/.test(key);
}
