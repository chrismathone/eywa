/**
 * ECS 오늘 보드 — 정규 수강생 뒤에 보강(수업외) 학생을 붙인다. 순수(Vitest).
 *
 * 출석부 `makeupStudentIds`와 **같은 집합**: 그 (반,날짜)에 기록은 있는데 수강행이 없는 학생.
 * 화면마다 다시 짜면 출석부엔 보이는데 ECS엔 없는(또는 반대) 갈라짐이 된다.
 */
import { makeupStudentIds } from "@/features/attendance/input-roster";

export { makeupStudentIds };

/** 정규 명단 뒤에 보강을 붙인다. 이미 있는 id는 건너뛴다(정규가 이긴다). 이름 가나다. */
export function appendMakeupStudents<T extends { studentId: string; name: string }>(
  regular: readonly T[],
  makeup: readonly T[],
): T[] {
  const have = new Set(regular.map((s) => s.studentId));
  const extra = makeup.filter((s) => !have.has(s.studentId));
  if (extra.length === 0) return [...regular];
  return [
    ...regular,
    ...[...extra].sort((a, b) => a.name.localeCompare(b.name, "ko") || a.studentId.localeCompare(b.studentId)),
  ];
}

/**
 * 시트 출결 state는 마운트 때 한 번만 시드된다. 보강 추가 → refresh 뒤에도 그 state에
 * 새 칸이 없으면 빈 칸으로 그려지고, 클릭이 makeup을 present로 덮는다.
 * 서버 칸이 아직 안 실렸으면 '보강'으로 보여 읽기 전용 배지가 뜨게 한다.
 */
export function attendanceOrMakeup<T extends { status: string }>(
  att: T | null | undefined,
  isMakeup: boolean | undefined,
): T | { status: "makeup"; note: null; units: null; slot: null } | null {
  if (att) return att;
  if (isMakeup) return { status: "makeup", note: null, units: null, slot: null };
  return null;
}
