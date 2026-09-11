import { describe, expect, it } from "vitest";
import { parseJjSnapshot, slotAvailability, snapshotFromDay, type JjReportSnapshot } from "./snapshot";
import type { IjwDay, IjwExamResult, IjwStudy } from "./contract";

const study = (answers: number, exams = 0): IjwStudy => ({
  student: { id: "jdw", name: "jdw", className: "A반" },
  from: "2026-08-13",
  to: "2026-09-11",
  totals: { answers, correct: Math.floor(answers / 2), accuracy: answers ? 50 : 0, studyMs: 60000, newWords: 3, activeDays: 2 },
  longTermWords: 10,
  seenWords: 40,
  daily: [],
  byDeck: [],
  byPos: [],
  weak: [],
  exams: Array.from({ length: exams }, (_, i) => ({
    attemptId: `a${i}`,
    deckId: "d",
    deck: "시험",
    examType: "regular",
    submittedAt: "2026-09-10T01:00:00.000Z",
    total: 20,
    correct: 15,
    score: 75,
  })),
});

const exam: IjwExamResult = {
  student: { id: "jdw", name: "jdw", className: "A반" },
  deck: { id: "d", name: "Unit 3", examType: "regular" },
  submittedAt: "2026-09-11T05:00:00.000Z",
  elapsedMs: 300000,
  total: 20,
  correct: 18,
  score: 90,
  classAvg: 80,
  overallAvg: null,
  byPos: [{ pos: "n", label: "명사", correct: 9, total: 10 }],
  wrong: [{ prompt: "[명] 교복", answer: "school uniform", typed: "" }],
};

const snap = (s: IjwStudy | null, exams: IjwExamResult[]): JjReportSnapshot => ({
  v: 1,
  date: "2026-09-11",
  ijwId: "jdw",
  fetchedAt: "2026-09-11T06:00:00.000Z",
  study: s,
  exams,
});

describe("snapshotFromDay · parseJjSnapshot", () => {
  it("하루치 응답을 동결본으로 옮기고 다시 읽으면 같다", () => {
    const day = { v: 1, ijwId: "jdw", name: "jdw", date: "2026-09-11", exams: [exam], study: study(30) } as IjwDay;
    const s = snapshotFromDay(day, "2026-09-11T06:00:00.000Z");
    expect(s).toEqual(snap(study(30), [exam]));
    expect(parseJjSnapshot(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it("모양이 어긋난 저장본은 null — 0으로 채운 그림을 그리지 않는다", () => {
    const broken = JSON.parse(JSON.stringify(snap(study(30), [exam])));
    delete broken.study.totals.answers;
    expect(parseJjSnapshot(broken)).toBeNull();
    expect(parseJjSnapshot({ v: 2 })).toBeNull();
    expect(parseJjSnapshot(null)).toBeNull();
  });
});

describe("slotAvailability", () => {
  it("그날 응시가 있어야 시험결과지, 30일 활동이 있어야 학습분석지", () => {
    expect(slotAvailability(snap(study(0), []))).toEqual({ 시험결과지: false, 학습분석지: false });
    expect(slotAvailability(snap(study(12), [exam]))).toEqual({ 시험결과지: true, 학습분석지: true });
    expect(slotAvailability(snap(study(0, 1), []))).toEqual({ 시험결과지: false, 학습분석지: true });
    expect(slotAvailability(snap(null, [exam]))).toEqual({ 시험결과지: true, 학습분석지: false });
  });

  it("자료가 없으면 둘 다 없다", () => {
    expect(slotAvailability(null)).toEqual({ 시험결과지: false, 학습분석지: false });
  });
});
