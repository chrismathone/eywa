/**
 * 재원생 **구성** 집계 — 운영실 '재원생' 팝업·'동시 수강'·'학년별 재원생'·원생목록 상단 카드가 같은 분류를 쓰는 순수 함수.
 *
 * 🔑 조회는 호출부가 **한 번** 하고 행을 넘긴다 — 운영실 30초 갱신은 서버 액션이라 React cache가 조회를 묶지 않아서,
 *    원생목록(RSC)과 운영실(서버 액션)이 같은 집계를 쓰려면 조회와 집계가 갈라져 있어야 한다.
 * 🔑 한 학생을 영어(EiE·인재원 영어 중 하나라도)·수학 두 축으로 **넷 중 하나**에 넣는다(`subjectMixOf`) —
 *    '동시 수강 N명'과 학년별 막대의 보라(영어+수학) 합계가 **같은 함수**를 지나므로 늘 같다.
 * ⚠️ 프로그램별 인원은 **겹친다**(EiE와 수학을 함께 다니면 양쪽에 센다) — 합계가 재원생보다 클 수 있다.
 */
import { programOf, type Program, type ProgramSubject } from "./program";
import { axisHasSubject, subjectAxisOf } from "./scope-axis";
import { subjectEnrollmentSummary } from "./subject-enrollment-summary";

type One<T> = T | T[] | null;

/** 재원생 활성 수강 한 줄(end_date null · on_hold false · 학생 status=enrolled). */
export type ActiveEnrollmentRow = {
  id: string;
  student_id: string;
  class: One<{ subject?: string | null; english_track?: string | null }>;
};

export type EnrolledStudentRow = { id: string; grade: string | null; school: string | null };

/** 강사 스코프(`effectiveTeacherScope`)의 모양 — null = 학원 전체. */
export type StudentScope = { studentIds: string[]; subjects: string[] } | null;

export type StudentPrograms = ReadonlyMap<string, ReadonlySet<Program>>;

const classOf = (row: ActiveEnrollmentRow) => (Array.isArray(row.class) ? row.class[0] : row.class) ?? undefined;

/**
 * 과목별 재원생(distinct) + 수강 조합 — 원생목록 상단 카드·운영실 과목별 수강.
 * 강사 스코프면 담당 학생 · 담당 과목 축으로 좁힌다(원장 2026-08-20 표시 축).
 */
export function enrolledSubjectCounts(
  rows: readonly ActiveEnrollmentRow[],
  scope: StudentScope,
): { bySubject: Record<string, number>; combinations: { subjects: string[]; value: number }[] } {
  const inScope = scope ? new Set(scope.studentIds) : null;
  const axis = subjectAxisOf(scope);
  const bySubject = new Map<string, Set<string>>();
  for (const row of rows) {
    if (inScope && !inScope.has(row.student_id)) continue;
    const subject = classOf(row)?.subject;
    if (!subject || !axisHasSubject(axis, subject)) continue;
    const set = bySubject.get(subject) ?? new Set<string>();
    set.add(row.student_id);
    bySubject.set(subject, set);
  }
  return {
    bySubject: Object.fromEntries([...bySubject].map(([key, ids]) => [key, ids.size])),
    combinations: subjectEnrollmentSummary(bySubject).combinations,
  };
}

export type EnrolledComposition = {
  /** 재원생(강사 스코프 적용). */
  students: EnrolledStudentRow[];
  /** 학생 → 프로그램(활성 수강 · 강사 표시 축 적용). */
  programs: Map<string, Set<Program>>;
  /** 활성 수강이 하나라도 있는 학생(강사 표시 축 적용). */
  active: Set<string>;
};

/** 재원생 구성 — 프로그램 판정은 programOf 한 벌. 원생목록 `program=` 필터와 운영실 팝업이 같은 결과를 쓴다. */
export function composeEnrolled(input: {
  students: readonly EnrolledStudentRow[];
  rows: readonly ActiveEnrollmentRow[];
  scope: StudentScope;
  subjects: readonly ProgramSubject[];
}): EnrolledComposition {
  const inScope = input.scope ? new Set(input.scope.studentIds) : null;
  const axis = subjectAxisOf(input.scope);
  const programs = new Map<string, Set<Program>>();
  const active = new Set<string>();
  for (const row of input.rows) {
    if (inScope && !inScope.has(row.student_id)) continue;
    const klass = classOf(row);
    if (!klass || !axisHasSubject(axis, klass.subject)) continue;
    active.add(row.student_id);
    const program = programOf({ subject: klass.subject ?? null, englishTrack: klass.english_track ?? null }, input.subjects);
    if (!program) continue;
    const set = programs.get(row.student_id) ?? new Set<Program>();
    set.add(program);
    programs.set(row.student_id, set);
  }
  return {
    students: inScope ? input.students.filter((s) => inScope.has(s.id)) : [...input.students],
    programs,
    active,
  };
}

export type SubjectMix = "englishOnly" | "both" | "mathOnly" | "neither";

/** 영어·수학 두 축으로 본 한 학생의 자리. */
export function subjectMixOf(programs: ReadonlySet<Program> | undefined): SubjectMix {
  const english = !!programs && (programs.has("eie") || programs.has("injaewon"));
  const math = !!programs && programs.has("math");
  if (english && math) return "both";
  if (english) return "englishOnly";
  return math ? "mathOnly" : "neither";
}

export type ProgramSummary = {
  eie: number;
  injaewon: number;
  math: number;
  /** 영어 + 수학을 함께 수강 = 동시 수강. */
  both: number;
  /** 활성 수강(휴원 제외)이 하나도 없는 재원생. */
  noEnrollment: number;
  /** 활성 수강은 있으나 세 프로그램 어디에도 안 드는 재원생(국어·과학만 등). */
  otherOnly: number;
};

/**
 * @param studentIds 재원생 명단(스코프 적용).
 * @param programs 학생 → 프로그램(활성 수강 기준).
 * @param active 활성 수강이 하나라도 있는 학생.
 */
export function summarizePrograms(
  studentIds: readonly string[],
  programs: StudentPrograms,
  active: ReadonlySet<string>,
): ProgramSummary {
  const out: ProgramSummary = { eie: 0, injaewon: 0, math: 0, both: 0, noEnrollment: 0, otherOnly: 0 };
  for (const id of new Set(studentIds)) {
    const set = programs.get(id);
    if (set?.has("eie")) out.eie += 1;
    if (set?.has("injaewon")) out.injaewon += 1;
    if (set?.has("math")) out.math += 1;
    if (subjectMixOf(set) === "both") out.both += 1;
    if (!active.has(id)) out.noEnrollment += 1;
    else if (!set || set.size === 0) out.otherOnly += 1;
  }
  return out;
}

/** 재원생 대비 비율(%) — 반올림. 재원생 0명이면 null(0으로 나누지 않는다). */
export function concurrentShare(count: number, total: number): number | null {
  if (!(total > 0)) return null;
  return Math.round((count / total) * 100);
}

export const OTHER_GRADE_LABEL = "기타·미입력";

export type GradeSplitRow = { label: string; englishOnly: number; both: number; mathOnly: number };
export type GradeSplit = {
  /** 학원설정 `gradeLevels` 순서 + 마지막 '기타·미입력'. 0명 줄도 포함(표시 여부는 화면이 정한다). */
  rows: GradeSplitRow[];
  /** 영어·수학 어느 쪽도 없는 재원생 — 막대 밖 각주(합계를 재원생과 맞추는 몫). */
  neither: number;
};

/** 학년별 재원생을 영어만 · 영어+수학 · 수학만으로 가른다. */
export function gradeSplit(
  students: readonly { id: string; grade: string | null }[],
  programs: StudentPrograms,
  gradeLevels: readonly string[],
): GradeSplit {
  const rows = new Map<string, GradeSplitRow>();
  for (const label of gradeLevels) {
    if (!rows.has(label)) rows.set(label, { label, englishOnly: 0, both: 0, mathOnly: 0 });
  }
  const other: GradeSplitRow = { label: OTHER_GRADE_LABEL, englishOnly: 0, both: 0, mathOnly: 0 };
  let neither = 0;
  const seen = new Set<string>();
  for (const student of students) {
    if (seen.has(student.id)) continue;
    seen.add(student.id);
    const mix = subjectMixOf(programs.get(student.id));
    if (mix === "neither") {
      neither += 1;
      continue;
    }
    const row = rows.get(student.grade?.trim() ?? "") ?? other;
    row[mix] += 1;
  }
  return { rows: [...rows.values(), other], neither };
}
