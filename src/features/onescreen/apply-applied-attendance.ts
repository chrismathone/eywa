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
 *  4. 🔴 `attendanceUnits`는 칸에 **`units` 키가 있을 때만** 그 값으로 맞춘다 — 서버가 **새로 만든** 칸에
 *     실제로 넣은 시수다(수학 자동 시수 1.5·2, 조회 실패·비수학이면 null = 1, 원장 2026-09-11).
 *     종전엔 "새 칸의 실제 값도 null"이라 시수를 안 건드려도 됐지만, 자동 시수가 생긴 뒤로 그 전제가
 *     거짓이 됐다 — 방송 뒤 '타임' 칸이 1로 보이고, 이어지는 보강 합침이 1 + 보강으로 **1.5 기록을 덮어**
 *     정규 몫 0.5가 사라졌다(적대 리뷰 2026-09-11). 키가 없는 칸(갱신 — 기존 시수 보존)은 그대로 둔다.
 *     ⚠️ `attendanceNote`는 여전히 건드리지 않는다 — 스트립은 메모를 안 보낸다.
 *  5. 학생 배지(`attendance`)는 [attendance-mark.ts](./attendance-mark.ts) `studentMarkFromRows`로 **행에서 다시
 *     계산**한다 — 로스터와 같은 함수·같은 우선순위(결석 > 조퇴 > 지각 > 출석). 방금 쓴 칸이 배지를 통째로
 *     덮지 않는다(다른 반의 결석·조퇴가 '출석' 방송 한 번에 가려지면 안 된다).
 *  6. 바뀐 게 없으면 **입력 배열을 그대로 반환**(참조 동일) — 불필요한 리렌더 0.
 */
import { studentMarkFromRows } from "./attendance-mark";
import type { OneScreenStudent } from "./types";

/** 방송 칸(`AttendanceAppliedDetail.cells`)과 같은 모양 — `units`는 새로 만든 칸에만 온다(규칙 4). */
export type AppliedCell = { studentId: string; classId: string; units?: number | null };

export function applyAppliedAttendance(
  students: readonly OneScreenStudent[],
  cells: readonly AppliedCell[],
  status: string,
  pending: ReadonlySet<string>,
): OneScreenStudent[] {
  // (학생 → 반 → 칸) — pending 칸은 여기서 이미 뺀다(아래 루프가 두 번 판단하지 않게).
  const byStudent = new Map<string, Map<string, AppliedCell>>();
  for (const c of cells) {
    if (!c?.studentId || !c?.classId) continue;
    if (pending.has(`${c.studentId}::${c.classId}`)) continue;
    const byClass = byStudent.get(c.studentId);
    if (byClass) byClass.set(c.classId, c);
    else byStudent.set(c.studentId, new Map([[c.classId, c]]));
  }
  if (byStudent.size === 0) return students as OneScreenStudent[];

  let touched = false;
  const next = students.map((s) => {
    const byClass = byStudent.get(s.id);
    if (!byClass) return s;
    let rowChanged = false;
    const subjects = s.subjects.map((su) => {
      const cell = su.classId ? byClass.get(su.classId) : undefined;
      if (!cell) return su;
      // 규칙 4 — 새로 만든 칸이면 서버가 실제로 넣은 시수(키가 없으면 모른다 = 그대로).
      const unitsKnown = cell.units !== undefined;
      const sameUnits = !unitsKnown || (su.attendanceUnits ?? null) === (cell.units ?? null);
      if (su.attendanceRaw === status && sameUnits) return su;
      rowChanged = true;
      return unitsKnown
        ? { ...su, attendanceRaw: status, attendanceUnits: cell.units ?? null }
        : { ...su, attendanceRaw: status };
    });
    // 행에 못 붙은 내 반 칸(`attendanceOffRow`)도 **같은 반 키로** 고친다 — 안 고치면 출석부에서 결석을 출석으로
    // 정정해도 배지가 옛 결석을 계속 센다(적대 리뷰 2026-09-30). 새 키는 만들지 않는다(내 반인지 클라는 모른다).
    let attendanceOffRow = s.attendanceOffRow;
    if (attendanceOffRow) {
      for (const cid of byClass.keys()) {
        if (cid in attendanceOffRow && attendanceOffRow[cid] !== status) {
          attendanceOffRow = { ...attendanceOffRow, [cid]: status };
          rowChanged = true;
        }
      }
    }
    // 행이 하나도 안 바뀌었으면 배지도 손대지 않는다 — 이미 그 값이라 새로 알릴 것이 없다.
    if (!rowChanged) return s;
    touched = true;
    const nextStudent = { ...s, subjects, ...(attendanceOffRow ? { attendanceOffRow } : {}) };
    return { ...nextStudent, attendance: studentMarkFromRows(nextStudent) };
  });
  return touched ? next : (students as OneScreenStudent[]);
}
