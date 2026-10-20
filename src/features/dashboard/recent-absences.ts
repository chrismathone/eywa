/**
 * **최근 결석** — 최근 7일(어제까지) 결석을 학생별로 모으는 순수 함수(Vitest). 운영실 '최근 결석' 카드·팝업이 쓴다.
 * (원장 2026-10-20 *"전일결석 -> 최근 결석 (최근 7일 반영)"* · *"학생별로 누적 결석 정렬"* · *"담당 누군지도 적어주고
 *  (결석이 입력되었을때 수업하는 선생님)"*)
 *
 * 🔴 세는 단위는 '반복 결석'·결석 횟수 알림(0221a)과 **한 벌** — `effectiveAbsentCells`(칸마다 최신 정정만 · 결석인 칸)를
 *    (학생, 반, 수업일)로 접은 것이 결석 1회다. 교시가 여럿이어도 그 반의 그날은 1회, 같은 날 두 반을 빠지면 2회.
 *    그래서 다른 반에 나온 날의 결석도 센다(옛 '전일 결석'의 "한 교시도 안 온 학생"과 다르다 — 학생이 아니라 빠진 수업을 센다).
 * 🔴 담당 선생님 = **그 칸을 실제로 가르친 사람**(출결 강사 귀속 — teacher-axis.ts 단일 소스)이다. 입력한 사람(`recorded_by`)이 아니다.
 *    귀속은 칸(교시)마다 하고, 그날 그 반의 결석 칸들에서 나온 이름을 중복 없이 모은다(영어는 교시마다 담당이 다를 수 있다).
 *    판정은 서버가 재료(슬롯·그날 담임·대신 보강)를 읽어 `teacherOf`로 넘긴다 — 이 파일은 모으고 정렬만 한다.
 * 사전 통보는 숫자에서 빼지 않고 표식으로 둔다(옛 카드와 같은 규약) — 그날 그 반의 결석 칸이 **전부** 미리 알린 것이면 사전 통보.
 */
import { effectiveAbsentCells, type AbsenceSubjectRow } from "./absence-subjects";
import { isPreNotified } from "./absence-reasons";

/** 서버 조회 한 줄 — 결석 판정 재료 + 이름·반 표시 + 귀속 재료(대신 보강·자리 표식). */
export type RecentAbsenceRow = AbsenceSubjectRow & {
  student_name: string | null;
  class_name: string | null;
  taught_by?: string | null;
  seat_label?: string | null;
  recorded_via?: string | null;
};

/** 결석 칸 하나의 담당 — 표시 이름(자리 수업이면 방 이름, 담당이 갈리면 '담당 여럿'). 모르면 null. */
export type CellTeacher = { label: string | null };

export type RecentAbsence = {
  date: string;
  classId: string;
  className: string | null;
  subject: string | null;
  preNotified: boolean;
  /** 그날 그 반 결석 칸들의 담당 표시(중복 없음 · 교시 순). 담당을 못 구했으면 빈 배열('담당 모름'). */
  teachers: string[];
};

export type RecentAbsentStudent = {
  studentId: string;
  name: string;
  /** 결석 횟수(빠진 수업 수) = `absences.length`. */
  count: number;
  /** 미리 알리지 않은 결석 수 — 0보다 크면 '연락 필요'. */
  unnotified: number;
  /** 날짜 오름차순. */
  absences: RecentAbsence[];
};

export type RecentAbsences = { from: string; to: string; students: RecentAbsentStudent[] };

/** 정렬 — 누적 결석 많은 순 → 연락 필요(미리 안 알린 결석이 있는 학생) 먼저 → 이름. 과목 관리자 화면이 다시 셀 때도 이 한 벌. */
export function sortRecentAbsentStudents(rows: readonly RecentAbsentStudent[]): RecentAbsentStudent[] {
  return [...rows].sort(
    (a, b) =>
      b.count - a.count ||
      Number(b.unnotified > 0) - Number(a.unnotified > 0) ||
      a.name.localeCompare(b.name, "ko") ||
      a.studentId.localeCompare(b.studentId),
  );
}

/** 결석 목록을 다시 접은 학생 한 줄(과목 관리자 화면처럼 일부 결석만 남길 때 — 횟수·연락 필요를 같은 규칙으로 다시 센다). */
export function withAbsences(student: RecentAbsentStudent, absences: RecentAbsence[]): RecentAbsentStudent {
  return { ...student, absences, count: absences.length, unnotified: absences.filter((a) => !a.preNotified).length };
}

/**
 * 원시 출결 행(창 안 · 상태로 좁히지 않은 것) → 학생별 최근 결석.
 * @param teacherOf 결석 칸 하나의 담당(서버가 teacher-axis로 푼 값). 없으면 담당 표시가 빈다.
 */
export function foldRecentAbsences(
  rows: readonly RecentAbsenceRow[],
  range: { from: string; to: string },
  teacherOf: (cell: RecentAbsenceRow) => CellTeacher | null,
): RecentAbsences {
  const pairs = new Map<string, RecentAbsenceRow[]>();
  for (const cell of effectiveAbsentCells(rows)) {
    if (cell.session_date < range.from || cell.session_date > range.to) continue;
    const key = `${cell.student_id} ${cell.class_id} ${cell.session_date}`;
    pairs.set(key, [...(pairs.get(key) ?? []), cell]);
  }
  const byStudent = new Map<string, { name: string; absences: RecentAbsence[] }>();
  for (const cells of pairs.values()) {
    const ordered = [...cells].sort((a, b) => (a.slot_start ?? "").localeCompare(b.slot_start ?? ""));
    const first = ordered[0]!;
    const teachers: string[] = [];
    for (const cell of ordered) {
      const t = teacherOf(cell);
      if (t?.label && !teachers.includes(t.label)) teachers.push(t.label);
    }
    const entry = byStudent.get(first.student_id) ?? { name: first.student_name?.trim() || "이름 없음", absences: [] };
    entry.absences.push({
      date: first.session_date,
      classId: first.class_id,
      className: first.class_name?.trim() || null,
      subject: first.subject?.trim() || null,
      preNotified: ordered.every((c) => isPreNotified(c)),
      teachers,
    });
    byStudent.set(first.student_id, entry);
  }
  const students = [...byStudent.entries()].map(([studentId, { name, absences }]) => {
    const sorted = absences.sort((a, b) => a.date.localeCompare(b.date) || (a.className ?? "").localeCompare(b.className ?? "", "ko"));
    return withAbsences({ studentId, name, count: 0, unnotified: 0, absences: [] }, sorted);
  });
  return { from: range.from, to: range.to, students: sortRecentAbsentStudents(students) };
}
