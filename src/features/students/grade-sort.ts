import { gradeOrder } from "@/features/attendance/sort-rows";

/**
 * 원생목록 학년 정렬 — 원장 2026-10-14 *"각 필터에 오름차순 내림차순이 있어야지"*로 '학년 오름·내림차순'이 화면에 서자
 * 종전 DB 정렬(학년 글자순 = `7세 → 고 → 중 → 초`)이 그대로 드러났다. 학년 순서는 출석부 학년순과 **같은 함수**
 * ([`gradeOrder`](../attendance/sort-rows.ts) — 미취학 → 초 → 중 → 고)로 정한다(같은 목록이 화면마다 다르게 줄 서지 않게).
 * 같은 학년 안은 방향과 상관없이 이름 가나다순 → id(쪽 경계가 흔들리지 않게). 학년을 모르는 학생은 **늘 맨 뒤**(내림차순에서도
 * 맨 위로 올리지 않는다 — 모르는 값이 목록을 덮는다).
 * 서버·클라 양쪽이 쓰는 순수 모듈 — `"use client"`도 `server-only`도 붙이지 말 것([[#61]]).
 */
export function isGradeSort(sort: string | undefined): boolean {
  return !sort || sort === "grade" || sort === "grade_desc";
}

export function sortByGrade<T extends { id: string; grade: string | null; name: string }>(rows: readonly T[], desc: boolean): T[] {
  const UNKNOWN = gradeOrder(null);
  return [...rows].sort((a, b) => {
    const ga = gradeOrder(a.grade);
    const gb = gradeOrder(b.grade);
    const unknown = (ga >= UNKNOWN ? 1 : 0) - (gb >= UNKNOWN ? 1 : 0);
    return unknown || (desc ? gb - ga : ga - gb) || a.name.localeCompare(b.name, "ko") || a.id.localeCompare(b.id);
  });
}
