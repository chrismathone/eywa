// **통합 탭 명단 ↔ 현재 영어 수강** diff — 순수 함수(Vitest).
//
// 원장 2026-08-29: *"통합영어시간표(9월)에 학생 명단이 있음. 학생 명단을 보고 학생도 전부 이동시켜야함."*
//
// 🔴 왜 `computeImportDiff`를 그대로 못 쓰는가 — **반 이름으로 비교하기 때문**이다([diff.ts](../diff.ts)
//    `norm(row.className) === norm(cur.className)`). 9월 컷오버는 이름 변경 17건을 **그날로 예약**하므로
//    (0234a) 시트엔 새 이름(`LE1`)이, DB엔 아직 옛 이름(`LS6`)이 있다. 이름으로 비교하면 **이름만 바뀐 반의
//    전원이 '이동'으로 잡혀** 수강이 통째로 갈린다. 그래서 여기서는 **classId로만** 비교한다.
//
// 그리고 `computeImportDiff`의 두 안전벨트는 모양을 바꿔 그대로 가져온다:
//   · cross-subject 보호 → 호출부가 `current`에 **영어 수강만** 넘긴다.
//   · 조용한 퇴출 방지 → 종료 후보는 **시트에 블록이 있는 반**으로 한정한다(`removableClassIds`).
//     한 블록을 못 읽었을 때 그 반 전원이 종료되는 것을 막는 마지막 방어다(파싱 검산이 1차).

import type { ImportDiff } from "../types";

/** 현재 DB의 영어 수강 1건. */
export interface RosterEnrollmentRow {
  enrollmentId: string;
  studentId: string;
  /** DB에 적힌 이름(보고용). */
  studentName: string;
  classId: string;
  /** DB 기준 반 이름 — 이름 변경 예약분은 아직 **옛 이름**이다(표시에만 쓴다). */
  className: string;
}

/** 시트가 말하는 "9월엔 이 학생이 이 반" 한 줄. 학생·반은 호출부가 이미 확정했다. */
export interface RosterDesiredRow {
  studentId: string;
  /** 시트 표기(보고용 — DB 이름과 다를 수 있다: 접미사·공백). */
  studentName: string;
  school: string | null;
  grade: string | null;
  classId: string;
  /** 시트에 적힌 반 이름(= 변경 후 이름). 표시·경고 문구에만 쓴다. */
  className: string;
}

const keyOf = (studentId: string, classId: string) => `${studentId}|${classId}`;

/**
 * 명단(desired) ↔ 현재 수강(current) → `ImportDiff`.
 *
 * 짝짓기 규칙: 한 학생이 **잃은 반**과 **얻은 반**을 하나씩 가지면 그건 새 등록이 아니라 **이동**이다
 * (이동으로 처리해야 `attendance_days`·`on_hold`가 승계된다 — 0228a). 수가 맞지 않으면 남는 쪽만
 * 추가·종료가 된다.
 *
 * @param removableClassIds 시트에 블록이 있던 반. 여기 없는 반의 수강은 **종료하지 않고 경고**한다.
 */
export function computeRosterDiff(
  desired: readonly RosterDesiredRow[],
  current: readonly RosterEnrollmentRow[],
  removableClassIds: ReadonlySet<string>,
): ImportDiff {
  const diff: ImportDiff = { moves: [], removes: [], adds: [], unchanged: 0, warnings: [] };

  // 같은 (학생·반)이 시트에 두 번 적혀도 한 번만 센다 — 중복 등록을 만들지 않는다.
  const wanted = new Map<string, RosterDesiredRow>();
  for (const d of desired) {
    const k = keyOf(d.studentId, d.classId);
    if (!wanted.has(k)) wanted.set(k, d);
  }

  // ① 이미 그 반에 있는 것은 그대로 둔다.
  const orphans: RosterEnrollmentRow[] = [];
  const currentKeys = new Set(current.map((c) => keyOf(c.studentId, c.classId)));
  for (const c of current) {
    const k = keyOf(c.studentId, c.classId);
    if (wanted.has(k)) {
      diff.unchanged += 1;
    } else {
      orphans.push(c);
    }
  }
  const pending = [...wanted.values()].filter((d) => !currentKeys.has(keyOf(d.studentId, d.classId)));

  // ② 학생별로 잃은 반 ↔ 얻은 반을 짝지어 **이동**으로 만든다.
  //    ⚠️ 순서를 정해 둔다(반 이름) — 안 그러면 같은 입력이 실행마다 다른 이동을 만들어 스냅샷이 흔들린다.
  const lostBy = new Map<string, RosterEnrollmentRow[]>();
  for (const o of [...orphans].sort((a, b) => a.className.localeCompare(b.className, "ko"))) {
    (lostBy.get(o.studentId) ?? lostBy.set(o.studentId, []).get(o.studentId)!).push(o);
  }
  const gainedBy = new Map<string, RosterDesiredRow[]>();
  for (const p of [...pending].sort((a, b) => a.className.localeCompare(b.className, "ko"))) {
    (gainedBy.get(p.studentId) ?? gainedBy.set(p.studentId, []).get(p.studentId)!).push(p);
  }

  for (const [studentId, gains] of gainedBy) {
    const losses = lostBy.get(studentId) ?? [];
    for (const gain of gains) {
      const loss = losses.shift();
      if (loss) {
        diff.moves.push({
          enrollmentId: loss.enrollmentId,
          studentName: loss.studentName,
          fromClassName: loss.className,
          toClassName: gain.className,
          toClassId: gain.classId,
        });
      } else {
        diff.adds.push({
          studentName: gain.studentName,
          school: gain.school,
          grade: gain.grade,
          className: gain.className,
          classId: gain.classId,
          studentId: gain.studentId,
        });
      }
    }
  }

  // ③ 짝을 못 만난 옛 수강 = 종료 후보. 🔴 시트에 그 반 블록이 있었을 때만.
  for (const losses of lostBy.values()) {
    for (const loss of losses) {
      if (!removableClassIds.has(loss.classId)) {
        diff.warnings.push(
          `"${loss.studentName}"(${loss.className})은 명단에 그 반 블록이 없어 손대지 않았습니다.`,
        );
        continue;
      }
      diff.removes.push({
        enrollmentId: loss.enrollmentId,
        studentName: loss.studentName,
        className: loss.className,
      });
    }
  }

  return diff;
}
