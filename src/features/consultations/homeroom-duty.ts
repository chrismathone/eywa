/**
 * 담임별 상담 현황의 **상담 의무** — 학생 × 과목마다 그 학생이 가장 많은 요일을 듣는 반의 담임만(같으면 모두) 담임으로 센다(순수).
 *
 * 원장 2026-10-27 *"수학과 기준 총 3t 중 1t만 수업을 들으면 부담임 — 화목 수업 중 화 하루만 들으면 그 학생 그 반 그 수업에는 부담임"*.
 * 🔑 판정은 강사평가 원생상담과 **한 벌**([`counselDutyOf`](../teacher-portfolio/model/students.ts) — 원장 2026-10-19
 *    *"주 3번 등원 중 2회 a · 1회 b면 a만 상담 의무"*) · 보고서 미발송 반은 빼되 그런 반만 다니면 그 반 담당 ·
 *    과목 운영에서 '수업 담당'으로 둔 과목(영어 기본)은 학생 반의 담임 모두(`counselByClassTeacher`).
 *    여기서 다시 구현하지 말 것 — 두 화면의 담당 학생 수가 갈린다.
 */
import { buildStudentTracking } from "../teacher-portfolio/model/students";
import type { SnapshotClass, SnapshotEnrollment, SnapshotSchedule } from "../teacher-portfolio/model/types";

export type DutyInput = {
  /** 담임 상담 대상 반만(특강·JJ 제외) — 빠진 반은 요일 셈에도 안 든다. */
  classes: readonly SnapshotClass[];
  schedules: readonly SnapshotSchedule[];
  enrollments: readonly SnapshotEnrollment[];
  /** 그날 그 반의 담임. */
  owner: (c: SnapshotClass, day: string) => string | null;
  /** 반 담임 모두가 의무인 과목. */
  allHomerooms: (subject: string) => boolean;
  /** 담임이 될 수 있는 사람(지금 담임 + 담임 이력). */
  teacherIds: Iterable<string>;
  from: string;
  end: string;
};

/** `isDuty(담임, 학생, 반, 날)` — 그날 그 담임이 그 반으로 그 학생의 상담 의무를 지는가. 날마다 한 번 계산해 기억한다. */
export function buildCounselDuty(input: DutyInput) {
  const { churnSource } = buildStudentTracking({
    from: input.from, end: input.end, classes: input.classes, schedules: input.schedules, enrollments: input.enrollments, owner: input.owner,
  });
  const teachers = [...new Set(input.teacherIds)];
  const byDay = new Map<string, Set<string>>();
  const keysOn = (day: string) => {
    let keys = byDay.get(day);
    if (!keys) {
      keys = new Set<string>();
      for (const t of teachers) {
        for (const [studentId, classIds] of churnSource.counselDutyOf(day, t, input.allHomerooms)) {
          for (const classId of classIds) keys.add(`${t}|${studentId}|${classId}`);
        }
      }
      byDay.set(day, keys);
    }
    return keys;
  };
  return (teacherId: string, studentId: string, classId: string, day: string) => keysOn(day).has(`${teacherId}|${studentId}|${classId}`);
}
