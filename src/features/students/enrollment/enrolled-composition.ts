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
import { axisHasSubject, subjectAxisOf } from "../scope-axis";
import { subjectEnrollmentSummary } from "./subject-enrollment-summary";
import {
  mixMatches,
  studentLevelOf,
  type StudentLevel,
  type StudentMixFilter,
} from "../list-filter-values";
import { getGradeLevel, isPreschoolGrade } from "@/lib/format/school-grade";

type One<T> = T | T[] | null;

/** 재원생 활성 수강 한 줄(end_date null · on_hold false · 학생 status=enrolled). */
export type ActiveEnrollmentRow = {
  id: string;
  student_id: string;
  /**
   * 수강 시작일 — **아직 안 온 수강을 빼기 위한 재료**(원장 2026-09-16 '실시간 재원생').
   * 없으면(null) 시작한 것으로 본다: 모르는 것을 "아직 안 다닌다"로 읽으면 멀쩡한 재원생이 사라진다.
   */
  start_date?: string | null;
  class: One<{ subject?: string | null; english_track?: string | null }>;
};

export type EnrolledStudentRow = { id: string; grade: string | null; school: string | null };

/** 강사 스코프(`effectiveTeacherScope`)의 모양 — null = 학원 전체. */
export type StudentScope = { studentIds: string[]; subjects: string[] } | null;

export type StudentPrograms = ReadonlyMap<string, ReadonlySet<Program>>;

const classOf = (row: ActiveEnrollmentRow) => (Array.isArray(row.class) ? row.class[0] : row.class) ?? undefined;

/**
 * 이 수강이 **오늘 기준 이미 시작했나**. `today`를 안 주면(옛 호출부) 전부 시작한 것으로 본다.
 * 🔴 `start_date`가 비면 시작한 것으로 본다 — 모름을 '미시작'으로 읽으면 재원생이 조용히 사라진다.
 */
function hasStarted(row: Pick<ActiveEnrollmentRow, "start_date">, today?: string): boolean {
  if (!today) return true;
  const start = row.start_date ?? null;
  return !start || start.slice(0, 10) <= today;
}

/**
 * **아직 하나도 시작 안 한** 학생 — 활성 수강은 있는데 전부 미래 시작이다.
 *
 * 원장 2026-09-16: *"우지윤학생처럼 이상이 나지 않으려면 실시간 재원생으로 바꿔야겠어"* → *"총원도 과목과
 * 동일하게 338"*. 실측(2026-09-16): 대시보드 '수학 195'와 시간표 '194'가 달랐던 원인이 정확히 이 한 명이었다
 * (수강 2건이 10/1·10/6 시작 — 등록은 확정됐지만 아직 교실에 앉지 않는다). 대시보드는 시작일을 안 보고,
 * 시간표는 그 주에 실제로 앉는 사람만 세서 갈렸다.
 *
 * 🔴 **수강이 아예 없는 재원생은 여기 안 들어간다**(반 배정 전 신입 — 실측 3명). 그들까지 빼면 335가 되는데,
 *    원장이 고른 값은 338이다: "아직 안 다니는 게 **확정된** 사람"만 뺀다.
 * ⚠️ 이 집합은 날짜가 지나면 저절로 빈다(10/1이 되면 우지윤은 재원생으로 합류) — 저장하지 않는다.
 * 🔴 `rows`는 **종료 안 됨 · 휴원 아님**인 수강만 넘긴다(위 `ActiveEnrollmentRow` 조건). 끝난 수강까지 넘기면
 *    "끝난 옛 수강 + 미래 시작 수강"을 가진 학생이 '이미 시작'으로 읽혀 한 명이 어긋난다.
 * 필요한 칸은 학생·시작일 둘뿐이라 그 둘만 가진 줄도 받는다(리텐션 명단이 같은 판정을 쓴다 — 2026-10-03).
 */
export function notYetStartedStudentIds(
  rows: readonly Pick<ActiveEnrollmentRow, "student_id" | "start_date">[],
  today: string,
): Set<string> {
  const any = new Set<string>();
  const started = new Set<string>();
  for (const row of rows) {
    any.add(row.student_id);
    if (hasStarted(row, today)) started.add(row.student_id);
  }
  const out = new Set<string>();
  for (const id of any) if (!started.has(id)) out.add(id);
  return out;
}

/**
 * 과목별 재원생(distinct) + 수강 조합 — 원생목록 상단 카드·운영실 과목별 수강.
 * 강사 스코프면 담당 학생 · 담당 과목 축으로 좁힌다(원장 2026-08-20 표시 축).
 */
export function enrolledSubjectCounts(
  rows: readonly ActiveEnrollmentRow[],
  scope: StudentScope,
  /** 오늘(KST) — 주면 **아직 시작 안 한 수강은 세지 않는다**('실시간 재원생', notYetStartedStudentIds 주석). */
  today?: string,
): { bySubject: Record<string, number>; combinations: { subjects: string[]; value: number }[] } {
  const inScope = scope ? new Set(scope.studentIds) : null;
  const axis = subjectAxisOf(scope);
  const bySubject = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!hasStarted(row, today)) continue;
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

/**
 * **지금 수강 중**으로 치는 수강 줄 — 이미 시작했고(`today`) · 스코프 학생이고 · 표시 축 과목인 반.
 * 🔑 운영실 '미수강' 막대(`composeEnrolled().active`의 여집합)와 원생목록 수강 과목 = '미수강'(`activeStudentIds`)이
 *    **이 한 판정**을 지난다(원장 2026-09-28 "막대 숫자 = 열린 목록 건수").
 */
function* activeRows(
  rows: readonly ActiveEnrollmentRow[],
  scope: StudentScope,
  today?: string,
): Generator<[ActiveEnrollmentRow, { subject?: string | null; english_track?: string | null }]> {
  const inScope = scope ? new Set(scope.studentIds) : null;
  const axis = subjectAxisOf(scope);
  for (const row of rows) {
    if (!hasStarted(row, today)) continue;
    if (inScope && !inScope.has(row.student_id)) continue;
    const klass = classOf(row);
    if (!klass || !axisHasSubject(axis, klass.subject)) continue;
    yield [row, klass];
  }
}

/**
 * 지금 수강 중인 과목이 하나라도 있는 학생 — `composeEnrolled().active`와 **같은 판정**(activeRows).
 * 원생목록 수강 과목 = '미수강'은 이 집합의 **여집합**이다(재원생이면 운영실 '미수강' 막대와 같은 사람들).
 * `rows`는 활성 수강(end_date null · on_hold false)만 — 휴원 중인 수강은 '수강 중'이 아니다(막대와 같다).
 */
export function activeStudentIds(
  rows: readonly ActiveEnrollmentRow[],
  scope: StudentScope,
  today?: string,
): Set<string> {
  const out = new Set<string>();
  for (const [row] of activeRows(rows, scope, today)) out.add(row.student_id);
  return out;
}

/** 재원생 구성 — 프로그램 판정은 programOf 한 벌. 원생목록 `program=` 필터와 운영실 팝업이 같은 결과를 쓴다. */
export function composeEnrolled(input: {
  students: readonly EnrolledStudentRow[];
  rows: readonly ActiveEnrollmentRow[];
  scope: StudentScope;
  subjects: readonly ProgramSubject[];
  /**
   * 오늘(KST) — 주면 **'실시간 재원생'**: 아직 시작 안 한 수강은 프로그램 판정에서 빼고,
   * 그런 수강만 가진 학생은 `students`(=재원생 명단)에서도 뺀다(원장 2026-09-16).
   * 안 주면 종전 그대로(시작일 무시) — 옛 호출부가 조용히 숫자를 바꾸지 않게 옵션이다.
   */
  today?: string;
}): EnrolledComposition {
  const inScope = input.scope ? new Set(input.scope.studentIds) : null;
  const programs = new Map<string, Set<Program>>();
  const active = new Set<string>();
  // 🔴 명단에서 뺄 학생 — 카드 숫자(총원)와 학년별·학교별 분해가 **같은 집합**을 보게 여기서 한 번 만든다.
  const pending = input.today ? notYetStartedStudentIds(input.rows, input.today) : null;
  for (const [row, klass] of activeRows(input.rows, input.scope, input.today)) {
    active.add(row.student_id);
    const program = programOf({ subject: klass.subject ?? null, englishTrack: klass.english_track ?? null }, input.subjects);
    if (!program) continue;
    const set = programs.get(row.student_id) ?? new Set<Program>();
    set.add(program);
    programs.set(row.student_id, set);
  }
  const visible = input.students.filter(
    (s) => (!inScope || inScope.has(s.id)) && !(pending && pending.has(s.id)),
  );
  return { students: visible, programs, active };
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

/**
 * 운영실 '재원생 구성' 막대 조각에 해당하는 재원생 id — 학교급 × 수강 구성. 원생목록 `level=`·`mix=`의 **단일 소스**.
 * 🔑 막대 숫자(`levelSubjectSplit`)와 같은 재료(`composition`)·같은 분류(`studentLevelOf`·`subjectMixOf`)를 쓴다.
 * 빈 조건은 그 축을 안 거른다.
 */
export function compositionStudentIds(
  composition: EnrolledComposition,
  filter: { levels: readonly StudentLevel[]; mixes: readonly StudentMixFilter[] },
): Set<string> {
  const out = new Set<string>();
  for (const student of composition.students) {
    if (filter.levels.length > 0 && !filter.levels.includes(studentLevelOf(student.grade))) continue;
    const mix = subjectMixOf(composition.programs.get(student.id));
    if (!mixMatches(mix, composition.active.has(student.id), filter.mixes)) continue;
    out.add(student.id);
  }
  return out;
}

/**
 * 학교급 이름 — 운영실 '재원생 구성'(학교급 분포)과 매일 기록(`student_daily_stats`)이 같이 쓰는 한 벌.
 * 미취학 → 초등·중등·고등 → 그 밖(학년은 있는데 학교급을 모름) '기타' → 학년이 비면 '미입력'.
 */
export function schoolLevelLabel(grade: string | null | undefined): string {
  if (isPreschoolGrade(grade ?? null)) return "미취학";
  const level = ({ 초: "초등", 중: "중등", 고: "고등" } as Record<string, string>)[getGradeLevel(grade ?? null)];
  return level ?? (grade ? "기타" : "미입력");
}
