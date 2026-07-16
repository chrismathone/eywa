/**
 * 원스크린 학생 표시 순서(3-2, edutrix '순서변경' 패리티) — 순수 함수(Vitest 대상).
 * 저장 단위 = (강사×반)의 student id 배열(onescreen_student_order.student_ids).
 * 적용 규칙: 반 그룹(연속된 같은 classId) **내부만** 재배열 — 반 시각순 등 상위 정렬은 보존,
 * 저장 목록에 없는(신규) 학생은 기존 정렬 순서 그대로 뒤에 붙는다.
 */

export function applyStudentOrder<T extends { id: string; classId?: string | null }>(
  students: T[],
  orderByClass: ReadonlyMap<string, readonly string[]>,
): T[] {
  if (orderByClass.size === 0) return students;
  const out: T[] = [];
  let i = 0;
  while (i < students.length) {
    const cid = students[i]!.classId ?? "";
    let j = i;
    while (j < students.length && (students[j]!.classId ?? "") === cid) j++;
    const group = students.slice(i, j);
    const saved = cid ? orderByClass.get(cid) : undefined;
    if (saved && saved.length) {
      const pos = new Map(saved.map((id, k) => [id, k]));
      const ranked = group.map((s, k) => ({ s, k, p: pos.get(s.id) ?? Number.MAX_SAFE_INTEGER }));
      ranked.sort((a, b) => a.p - b.p || a.k - b.k); // 미등재=뒤, 그 안에선 기존 상대순서 유지
      out.push(...ranked.map((r) => r.s));
    } else {
      out.push(...group);
    }
    i = j;
  }
  return out;
}

/** 순서 배열에서 id를 위(-1)/아래(+1)로 한 칸 이동(불변). 경계 밖이면 그대로. */
export function moveInOrder(order: readonly string[], id: string, dir: -1 | 1): string[] {
  const i = order.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return [...order];
  const next = [...order];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}
