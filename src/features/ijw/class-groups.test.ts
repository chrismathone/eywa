import { describe, expect, it } from "vitest";
import {
  classRefsOfRow,
  groupRowsByClass,
  hasMultiClassStudent,
  summarizeScoreGroups,
  summarizeStudyRows,
  type JjMembership,
} from "./class-groups";

const M: JjMembership = {
  classes: [
    { id: "c-a", name: "LS4", track: "eie" },
    { id: "c-b", name: "중고E_중2", track: "injaewon" },
  ],
  classIdsByStudent: new Map([
    ["s1", ["c-a"]],
    ["s2", ["c-a", "c-b"]],
    ["s3", []],
  ]),
};

type Row = { eywa: { studentId: string; name: string } | null; ijwId: string; score: number };
const row = (ijwId: string, studentId: string | null, name: string, score = 50): Row => ({
  eywa: studentId ? { studentId, name } : null,
  ijwId,
  score,
});
const ROWS: Row[] = [
  row("x3", "s3", "다나", 70),
  row("x2", "s2", "나리", 90),
  row("x1", "s1", "가온", 80),
  row("xz", null, "zz", 40),
];
const nameOf = (r: Row) => r.eywa?.name ?? r.ijwId;

describe("groupRowsByClass", () => {
  it("반(이름순) → 영어 반 없음 → 연결 필요 · 두 반 학생은 두 반 모두에", () => {
    const g = groupRowsByClass(ROWS, M, { classFilter: null, includeUnlinked: true, nameOf });
    expect(g.map((x) => [x.key, x.rows.map((r) => r.ijwId)])).toEqual([
      ["class:c-a", ["x1", "x2"]],
      ["class:c-b", ["x2"]],
      ["none", ["x3"]],
      ["unlinked", ["xz"]],
    ]);
    expect(hasMultiClassStudent(g)).toBe(true);
  });

  it("짝 없는 행은 includeUnlinked=false면 뺀다", () => {
    const g = groupRowsByClass(ROWS, M, { classFilter: null, includeUnlinked: false, nameOf });
    expect(g.map((x) => x.key)).toEqual(["class:c-a", "class:c-b", "none"]);
  });

  it("반 필터 = 그 반을 다니는 학생만 · 모르는 반은 빈 목록", () => {
    const g = groupRowsByClass(ROWS, M, { classFilter: "c-b", includeUnlinked: true, nameOf });
    expect(g).toHaveLength(1);
    expect(g[0]!.rows.map((r) => r.ijwId)).toEqual(["x2"]);
    expect(hasMultiClassStudent(g)).toBe(false);
    expect(groupRowsByClass(ROWS, M, { classFilter: "nope", includeUnlinked: true, nameOf })).toEqual([]);
  });

  it("classRefsOfRow — 반 이름순, 짝 없으면 빈 배열", () => {
    expect(classRefsOfRow(ROWS[1]!, M).map((c) => c.name)).toEqual(["LS4", "중고E_중2"]);
    expect(classRefsOfRow(ROWS[3]!, M)).toEqual([]);
  });
});

describe("summarizeStudyRows", () => {
  const base = { studyMs: 0, newWords: 0, activeDays: 0, longTermWords: 0, seenWords: 0 };
  it("정답률은 푼 문제로 가중한다(학생 평균이 아니다)", () => {
    const s = summarizeStudyRows([
      { ...base, answers: 1, correct: 1, activeDays: 1 },
      { ...base, answers: 99, correct: 49, activeDays: 4 },
    ]);
    expect(s.accuracy).toBe(50);
    expect(s.activeStudents).toBe(2);
    expect(s.avgActiveDays).toBe(2.5);
  });

  it("아무도 안 풀면 정답률 null · 학생이 0이면 평균 null", () => {
    expect(summarizeStudyRows([{ ...base, answers: 0, correct: 0 }]).accuracy).toBeNull();
    const empty = summarizeStudyRows([]);
    expect([empty.students, empty.avgStudyMs, empty.avgActiveDays]).toEqual([0, null, null]);
  });
});

describe("summarizeScoreGroups", () => {
  it("반마다 응시·평균(정수 반올림)·최고·최저", () => {
    const g = groupRowsByClass(ROWS, M, { classFilter: null, includeUnlinked: true, nameOf });
    const s = summarizeScoreGroups(g);
    expect(s[0]!.stats).toEqual({ count: 2, avg: 85, max: 90, min: 80 });
    expect(s[3]!.stats.count).toBe(1);
  });
});
