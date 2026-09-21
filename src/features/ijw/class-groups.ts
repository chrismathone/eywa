/**
 * 인재원 자료를 **aywa 반**으로 묶는 순수 판정(Vitest로 잠금) — 학생별·반별을 한 화면에서 오가게(사용자 2026-09-11:
 * *"이게 학생별 반별 이렇게 있자나 유기적으로 잘 사용할 수 있도록 해주고"*).
 *
 * 🔑 반은 **인재원 반 이름(className)이 아니라 aywa 반**이다 — 인재원 반은 aywa 반과 1:1이 아니다(테스터 그룹·A반 등).
 *    그래서 짝이 걸린 학생의 **지금 다니는 영어 반**(수강)으로 묶는다. 재료 조회는 server/queries.ts `loadJjMembership`.
 * 🔴 한 학생이 영어 반 둘을 다니면 **두 반 모두에** 선다(반마다 그 반 아이들의 합계라서) — 화면이 그 사실을 적는다.
 * ⚠️ 짝은 있는데 지금 영어 반이 없으면 '영어 반 없음', 짝이 없으면 '연결 필요'(관리자만) — 뭉쳐서 사라지지 않게.
 */
import { summarizeScores } from "./contract";

export type JjTrack = "eie" | "injaewon" | null;
export type JjClassRef = { id: string; name: string; track: JjTrack };
export type JjMembership = {
  /** 지금 도는 영어 반(이름순). */
  classes: readonly JjClassRef[];
  /** aywa 학생 id → 지금 다니는 영어 반 id들. */
  classIdsByStudent: ReadonlyMap<string, readonly string[]>;
};

export type JjGroupKind = "class" | "none" | "unlinked";
export type JjGroup<Row> = { key: string; kind: JjGroupKind; classRef: JjClassRef | null; rows: Row[] };

type LinkedRow = { aywa: { studentId: string; name: string } | null };

const byKo = (a: string, b: string) => a.localeCompare(b, "ko");

/** 이 행의 aywa 영어 반(반 이름순). 짝이 없으면 빈 배열. */
export function classRefsOfRow(row: LinkedRow, m: JjMembership): JjClassRef[] {
  if (!row.aywa) return [];
  const ids = new Set(m.classIdsByStudent.get(row.aywa.studentId) ?? []);
  return m.classes.filter((c) => ids.has(c.id));
}

/**
 * 행 → 반 묶음. 순서 = 반(이름순) → 영어 반 없음 → 연결 필요. 묶음 안은 이름순.
 * - `classFilter`를 주면 그 반 묶음 하나만(그 반을 다니는 학생만). 모르는 반이면 빈 배열.
 * - `includeUnlinked`가 false면 짝 없는 행을 뺀다(강사 화면은 애초에 짝 있는 자기 학생만 온다).
 */
export function groupRowsByClass<Row extends LinkedRow>(
  rows: readonly Row[],
  m: JjMembership,
  opts: { classFilter: string | null; includeUnlinked: boolean; nameOf: (row: Row) => string },
): JjGroup<Row>[] {
  const sortRows = (list: Row[]) => list.sort((a, b) => byKo(opts.nameOf(a), opts.nameOf(b)));
  if (opts.classFilter) {
    const ref = m.classes.find((c) => c.id === opts.classFilter);
    if (!ref) return [];
    const inClass = rows.filter((r) => classRefsOfRow(r, m).some((c) => c.id === ref.id));
    return [{ key: `class:${ref.id}`, kind: "class", classRef: ref, rows: sortRows(inClass) }];
  }
  const byClass = new Map<string, Row[]>();
  const none: Row[] = [];
  const unlinked: Row[] = [];
  for (const r of rows) {
    if (!r.aywa) {
      if (opts.includeUnlinked) unlinked.push(r);
      continue;
    }
    const refs = classRefsOfRow(r, m);
    if (refs.length === 0) none.push(r);
    for (const c of refs) byClass.set(c.id, [...(byClass.get(c.id) ?? []), r]);
  }
  const groups: JjGroup<Row>[] = m.classes
    .filter((c) => byClass.has(c.id))
    .map((c) => ({ key: `class:${c.id}`, kind: "class" as const, classRef: c, rows: sortRows(byClass.get(c.id)!) }));
  if (none.length) groups.push({ key: "none", kind: "none", classRef: null, rows: sortRows(none) });
  if (unlinked.length) groups.push({ key: "unlinked", kind: "unlinked", classRef: null, rows: sortRows(unlinked) });
  return groups;
}

/** 한 학생이 두 반 이상에 섰는가 — 섰으면 화면이 "두 반 모두에 셉니다"를 적는다. */
export function hasMultiClassStudent(groups: readonly JjGroup<LinkedRow>[]): boolean {
  const seen = new Set<string>();
  for (const g of groups) {
    if (g.kind !== "class") continue;
    for (const r of g.rows) {
      if (!r.aywa) continue;
      if (seen.has(r.aywa.studentId)) return true;
    }
    for (const r of g.rows) if (r.aywa) seen.add(r.aywa.studentId);
  }
  return false;
}

export type StudyNumbers = {
  answers: number;
  correct: number;
  studyMs: number;
  newWords: number;
  activeDays: number;
  longTermWords: number;
  seenWords: number;
};

export type StudySummary = {
  students: number;
  /** 기간 중 한 문제라도 푼 학생. */
  activeStudents: number;
  answers: number;
  /** 푼 문제로 가중한 정답률(0~100 정수) — 학생 평균이 아니다. 푼 문제가 0이면 null. */
  accuracy: number | null;
  studyMs: number;
  avgStudyMs: number | null;
  newWords: number;
  avgActiveDays: number | null;
  avgLongTermWords: number | null;
  avgSeenWords: number | null;
};

const avg = (sum: number, n: number, digits = 0) => {
  if (n === 0) return null;
  const f = 10 ** digits;
  return Math.round((sum / n) * f) / f;
};

/**
 * 반 줄 숫자. 🔑 정답률은 **푼 문제로 가중**한다 — 학생별 정답률의 평균이면 한 문제 푼 학생의 100%가
 * 수백 문제 푼 학생과 같은 무게를 갖는다. 인재원과 같은 반올림(정수).
 */
export function summarizeStudyRows(rows: readonly StudyNumbers[]): StudySummary {
  const n = rows.length;
  const sum = (f: (r: StudyNumbers) => number) => rows.reduce((s, r) => s + (Number.isFinite(f(r)) ? f(r) : 0), 0);
  const answers = sum((r) => r.answers);
  const correct = sum((r) => r.correct);
  const studyMs = sum((r) => r.studyMs);
  return {
    students: n,
    activeStudents: rows.filter((r) => r.answers > 0).length,
    answers,
    accuracy: answers > 0 ? Math.round((correct / answers) * 100) : null,
    studyMs,
    avgStudyMs: avg(studyMs, n),
    newWords: sum((r) => r.newWords),
    avgActiveDays: avg(sum((r) => r.activeDays), n, 1),
    avgLongTermWords: avg(sum((r) => r.longTermWords), n),
    avgSeenWords: avg(sum((r) => r.seenWords), n),
  };
}

/** 시험 하나의 반별 요약(응시·평균·최고·최저) — 인재원과 같은 반올림(summarizeScores). */
export function summarizeScoreGroups<Row extends LinkedRow & { score: number }>(
  groups: readonly JjGroup<Row>[],
): { group: JjGroup<Row>; stats: ReturnType<typeof summarizeScores> }[] {
  return groups.map((group) => ({ group, stats: summarizeScores(group.rows.map((r) => r.score)) }));
}
