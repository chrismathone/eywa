/**
 * 상단 출석 스트립이 기록한 칸을 **원스크린 로스터 state에 반영**하는 순수 함수(Vitest로 잠금).
 *
 * 재료는 서버 액션 응답의 `applied` — 게이트·기존 기록에 걸려 빠진 칸은 애초에 실려 오지 않으므로,
 * 여기서 "정말 기록됐나"를 다시 판단하지 않는다(화면과 출석부가 갈리지 않게 하는 계약은 액션이 진실).
 *
 * 규칙:
 *  1. `pending`(내 in-flight 알약 쓰기)에 있는 칸은 **건너뛴다** — 방금 내가 누른 지각·결석을 뒤늦게
 *     도착한 스트립 방송이 '출석'으로 되돌리면 안 된다(응답 역전 방지, `setAttendanceFor`와 같은 규약).
 *  2. 로스터에 없는 (학생·반)은 무시한다 — 스트립은 그 날 내 전 교시를 다루고, 원스크린 로스터는
 *     날짜·요일로 좁혀져 있어 서로 범위가 다르다.
 *  3. 행의 `attendanceRaw`는 `status`로 **채택한다**(서버가 방금 쓴 값이 진실). 새로고침 뒤 로스터가
 *     보여줄 값과 같다 — 로스터는 (학생×반)의 **가장 최근 기록**을 집는다.
 *     ⚠️ `attendanceNote`·`attendanceUnits`는 건드리지 않는다 — 스트립은 그 둘을 안 보내고,
 *        `fillEmptyOnly`라 새로 만들어진 칸의 실제 값도 null이라 화면과 갈리지 않는다.
 *  4. 학생 배지(`attendance`)는 [attendance-mark.ts](./attendance-mark.ts) 단일 소스로 갱신한다
 *     — 로스터도 "그 학생의 가장 최근 기록"으로 배지를 만들고, 방금 쓴 행이 그 최신이다.
 *  5. 바뀐 게 없으면 **입력 배열을 그대로 반환**(참조 동일) — 불필요한 리렌더 0.
 */
import { attendanceMarkOf } from "./attendance-mark";
import type { OneScreenStudent } from "./types";

export type AppliedCell = { studentId: string; classId: string };

export function applyAppliedAttendance(
  students: readonly OneScreenStudent[],
  cells: readonly AppliedCell[],
  status: string,
  pending: ReadonlySet<string>,
): OneScreenStudent[] {
  // (학생 → 반 집합) — pending 칸은 여기서 이미 뺀다(아래 루프가 두 번 판단하지 않게).
  const byStudent = new Map<string, Set<string>>();
  for (const c of cells) {
    if (!c?.studentId || !c?.classId) continue;
    if (pending.has(`${c.studentId}::${c.classId}`)) continue;
    const set = byStudent.get(c.studentId);
    if (set) set.add(c.classId);
    else byStudent.set(c.studentId, new Set([c.classId]));
  }
  if (byStudent.size === 0) return students as OneScreenStudent[];

  const mark = attendanceMarkOf(status);
  let touched = false;
  const next = students.map((s) => {
    const classIds = byStudent.get(s.id);
    if (!classIds) return s;
    let rowChanged = false;
    const subjects = s.subjects.map((su) => {
      if (!su.classId || !classIds.has(su.classId) || su.attendanceRaw === status) return su;
      rowChanged = true;
      return { ...su, attendanceRaw: status };
    });
    // 행이 하나도 안 바뀌었으면 배지도 손대지 않는다 — 이미 그 값이라 새로 알릴 것이 없다.
    if (!rowChanged) return s;
    touched = true;
    return { ...s, attendance: mark, subjects };
  });
  return touched ? next : (students as OneScreenStudent[]);
}
