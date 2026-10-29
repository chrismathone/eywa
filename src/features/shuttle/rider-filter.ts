/**
 * 시간표 **셔틀 탑승 학생만**(순수 · Vitest) — 사용자 2026-10-27 *"에이와에 수업 시간표를 표시해 주는 기능이 있을 거야.
 * 거기 있는 걸 따와서 차량 타는 친구들만 추려내 줘"*.
 *
 * 🔑 재료는 시간표와 **같은 슬롯 목록**(`getWeeklyScheduleWithStudents`)이고, 여기선 명단만 좁힌다(학년 필터 `applyGradeFilter`와 같은 층).
 * 🔑 학년 필터와 다른 점: 탑승 학생이 하나도 없는 반은 **빼고**, 명단이 원래 비어 있던 반도 뺀다(셔틀 학생 수업만 보려는 보기라서).
 * 🔑 `riderIds`가 null이면(필터 안 씀) 입력을 그대로 돌려준다.
 */
type StudentLike = { studentId: string };
type SlotLike<S extends StudentLike> = { students: S[] };

export function applyRiderFilter<S extends StudentLike, T extends SlotLike<S>>(slots: readonly T[], riderIds: ReadonlySet<string> | null): T[] {
  if (!riderIds) return slots as T[];
  const out: T[] = [];
  for (const slot of slots) {
    const students = slot.students.filter((st) => riderIds.has(st.studentId));
    if (students.length === 0) continue;
    out.push(students.length === slot.students.length ? slot : { ...slot, students });
  }
  return out;
}
