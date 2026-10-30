import { isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import { activeRows, type ActiveEnrollmentRow, type StudentScope } from "./enrolled-composition";
import { courseGroupOf, type ProgramSubject } from "./program";

/**
 * 강좌수 = 학생 × 과목(2026-10-24). 수학 반 다섯 개 + 영어 + 국어 = 3. 수학 심화도 수학으로 묶는다.
 * 영어는 `splitEnglish`(EiE 모듈이 켜진 지점)면 인재원 영어 · EiE를 **따로** 센다(원장 2026-10-30 — 사업자·금액이 다르다) — 과목 칸 키 `injaewon`·`eie`.
 */
export type CourseSummary = {
  basis: "student-subject";
  total: number;
  subjects: Record<string, number>;
  perStudent: CourseBucket[];
  combos: CourseCombo[];
  students: number;
};
export type CourseBucket = { courses: number; students: number };
export type CourseCombo = { bucket: number; parts: { subject: string; count: number }[]; students: number };
export const COURSE_BUCKETS = 4;

/** 현재 수강 여부·권한은 기존 규약 그대로. 과목이 없는 반은 과목을 알 수 없어 강좌수에 넣지 않는다. */
export function summarizeCourses(input: {
  rows: readonly ActiveEnrollmentRow[];
  scope: StudentScope;
  subjects: readonly ProgramSubject[];
  today: string;
  inSubject?: (subject: string | null) => boolean;
  /** 영어를 인재원 영어 · EiE 두 강좌로(EiE 모듈 켜진 지점). */
  splitEnglish?: boolean;
}): CourseSummary {
  const byStudent = new Map<string, Set<string>>();
  for (const [row, klass] of activeRows(input.rows, input.scope, input.today)) {
    if (isEnrollmentEndedOn(row.end_date, input.today, row.is_transferred ?? false)) continue;
    if (input.inSubject && !input.inSubject(klass.subject ?? null)) continue;
    const subject = courseGroupOf(klass.subject, klass.english_track, input.subjects, input.splitEnglish);
    if (!subject) continue;
    const mine = byStudent.get(row.student_id) ?? new Set<string>();
    mine.add(subject);
    byStudent.set(row.student_id, mine);
  }
  const perStudent = Array.from({ length: COURSE_BUCKETS }, (_, i): CourseBucket => ({ courses: i + 1, students: 0 }));
  const combos = new Map<string, CourseCombo>();
  const counts = new Map<string, number>();
  let total = 0;
  for (const mine of byStudent.values()) {
    total += mine.size;
    for (const subject of mine) counts.set(subject, (counts.get(subject) ?? 0) + 1);
    const bucket = Math.min(mine.size, COURSE_BUCKETS);
    perStudent[bucket - 1]!.students++;
    const subjects = [...mine].sort();
    const id = JSON.stringify(subjects);
    const combo = combos.get(id) ?? { bucket, parts: subjects.map((subject) => ({ subject, count: 1 })), students: 0 };
    combo.students++;
    combos.set(id, combo);
  }
  return {
    basis: "student-subject", total, subjects: Object.fromEntries(counts), perStudent,
    combos: [...combos.values()].sort((a, b) => a.bucket - b.bucket || b.students - a.students),
    students: byStudent.size,
  };
}
