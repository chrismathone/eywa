import { isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import { activeRows, type ActiveEnrollmentRow, type StudentScope } from "./enrolled-composition";
import { PROGRAMS, programOf, type Program, type ProgramSubject } from "./program";

/**
 * **강좌수**(원장 2026-10-20 *"대시보드에 강좌수도 볼 수 있으면 좋을듯 … 한 학생이 여러 강좌를 들을 수도 있기 때문에 듣는 모든 강좌를
 * 체크"* → 상단 '강좌수' 칸) — 재원생이 **오늘 듣는 반을 학생마다 모두** 센다(같은 과목 반이 둘이면 2 · 같은 반이 두 줄이면 한 번).
 * 줄 판정 = '재원생' 칸과 같은 `activeRows`(이미 시작 · 휴원 아님 · 스코프 학생 · 표시 축 과목) + **오늘 끝나지 않은 수강**
 * (`isEnrollmentEndedOn` — 종료일이 미래로 적힌 수강(특강 기간 · 반이동 예약 전의 원래 반)도 그날까지 센다 · 적대 리뷰 2026-10-20).
 * 오늘 강좌수 = 원생 통계 '강좌수 추이' 오늘 점(`course-trend.ts`가 같은 규약). 순수 함수(Vitest).
 */
export type CourseSummary = {
  /** 지금 강좌수. */
  total: number;
  /** 프로그램별 강좌수(EiE · 인재원 영어 · 수학 — 세 프로그램 밖 과목은 `total`에만 든다). */
  programs: Record<Program, number>;
  /** 학생당 강좌 수 — 1개 · 2개 · 3개 · 4개 이상(마지막 칸이 4개 이상을 모은다). */
  perStudent: CourseBucket[];
  /**
   * 강좌 수마다 **무엇으로 듣는지**(원장 같은 날 *"2개를 어떤걸로 듣는지 전혀 모르잖아"*) — 학생마다 프로그램별 반 수를 조합으로 묶은 인원.
   * 같은 강좌 수 칸의 조합 인원을 더하면 그 칸의 학생 수(`perStudent`)다. 칸 안에서는 많은 순.
   */
  combos: CourseCombo[];
};
export type CourseBucket = { courses: number; students: number };
/** 조합 한 줄 — `bucket` = 강좌 수 칸(4 = 4개 이상) · `parts` = 프로그램(없으면 'other' = 그 외 과목)별 반 수(표시 순서대로). */
export type CourseCombo = { bucket: number; parts: { program: Program | "other"; count: number }[]; students: number };

/** 학생당 강좌 수 칸 — 마지막 칸은 '이상'. */
export const COURSE_BUCKETS = 4;
const PART_ORDER: readonly (Program | "other")[] = [...PROGRAMS, "other"];

export function summarizeCourses(input: {
  rows: readonly ActiveEnrollmentRow[];
  scope: StudentScope;
  subjects: readonly ProgramSubject[];
  today: string;
  /** 과목 관리자 — 그 과목 반만 센다(운영실 과목별 값 `slicePredicate`). */
  inSubject?: (subject: string | null) => boolean;
}): CourseSummary {
  const byStudent = new Map<string, { seen: Set<string>; parts: Map<Program | "other", number> }>();
  const programs: Record<Program, number> = { eie: 0, injaewon: 0, math: 0 };
  for (const [row, klass] of activeRows(input.rows, input.scope, input.today)) {
    if (isEnrollmentEndedOn(row.end_date, input.today, row.is_transferred ?? false)) continue;
    if (input.inSubject && !input.inSubject(klass.subject ?? null)) continue;
    const key = row.class_id ?? `row:${row.id}`;
    const mine = byStudent.get(row.student_id) ?? { seen: new Set<string>(), parts: new Map() };
    if (mine.seen.has(key)) continue;
    mine.seen.add(key);
    byStudent.set(row.student_id, mine);
    const program = programOf({ subject: klass.subject ?? null, englishTrack: klass.english_track ?? null }, input.subjects);
    if (program) programs[program]++;
    mine.parts.set(program ?? "other", (mine.parts.get(program ?? "other") ?? 0) + 1);
  }
  const perStudent = Array.from({ length: COURSE_BUCKETS }, (_, i): CourseBucket => ({ courses: i + 1, students: 0 }));
  const combos = new Map<string, CourseCombo>();
  let total = 0;
  for (const { seen, parts } of byStudent.values()) {
    total += seen.size;
    const bucket = Math.min(seen.size, COURSE_BUCKETS);
    perStudent[bucket - 1]!.students++;
    const list = PART_ORDER.flatMap((program) => (parts.get(program) ? [{ program, count: parts.get(program)! }] : []));
    const id = `${bucket}|${list.map((p) => `${p.program}${p.count}`).join("+")}`;
    const combo = combos.get(id) ?? { bucket, parts: list, students: 0 };
    combo.students++;
    combos.set(id, combo);
  }
  return { total, programs, perStudent, combos: [...combos.values()].sort((a, b) => a.bucket - b.bucket || b.students - a.students) };
}
