/**
 * 출결 벨의 이름·건수 — 순수(Vitest).
 *
 * 🔴 건수는 **신규 학생 수**이지 조회된 이름 배열 길이가 아니다(#89).
 *    이름 조회가 100에서 잘리거나 못 찾은 칸이 있으면, 잘린 길이로 "외 N명"을 세면
 *    150명이 영원히 "외 99명"이 된다.
 */
export function formatAttendanceNotifyNames(
  names: readonly string[],
  expected: number,
): { who: string; listedLabel: string } {
  const n = Math.max(0, expected);
  const first = names[0] ?? "학생";
  const who = n <= 1 ? first : `${first} 외 ${n - 1}명`;
  const missing = Math.max(0, n - names.length);
  const listedLabel =
    names.length === 0 ? `${n}명` : missing > 0 ? `${names.join(", ")} 외 ${missing}명` : names.join(", ");
  return { who, listedLabel };
}

/** id 순서대로 이름을 모은다. 못 찾은 id 수는 호출부가 로그한다. */
export function collectStudentNames(
  ids: readonly string[],
  nameById: ReadonlyMap<string, string>,
): { names: string[]; missing: number } {
  const names: string[] = [];
  const seen = new Set<string>();
  let missing = 0;
  for (const id of ids) {
    const name = nameById.get(id);
    if (!name) {
      missing += 1;
      continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return { names, missing };
}
