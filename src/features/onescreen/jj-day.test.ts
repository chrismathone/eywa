import { describe, expect, it } from "vitest";
import { jjDayKey, jjDaySummary, jjKnownSlots, type JjDayState } from "./jj-day";
import type { JjReportSnapshot } from "@/features/ijw/snapshot";

const snapshot = (answers: number, exams: number): JjReportSnapshot => ({
  v: 1,
  date: "2026-09-11",
  ijwId: "jdw",
  fetchedAt: "2026-09-11T06:00:00.000Z",
  study: {
    student: { id: "jdw", name: "jdw", className: null },
    from: "2026-08-13",
    to: "2026-09-11",
    totals: { answers, correct: 0, accuracy: 0, studyMs: 0, newWords: 0, activeDays: 0 },
    longTermWords: 0,
    seenWords: 0,
    daily: [],
    byDeck: [],
    byPos: [],
    weak: [],
    exams: [],
  },
  exams: Array.from({ length: exams }, () => ({
    student: { id: "jdw", name: "jdw", className: null },
    deck: { id: "d", name: "Unit 3", examType: "regular" },
    submittedAt: "2026-09-11T05:00:00.000Z",
    elapsedMs: 1000,
    total: 20,
    correct: 18,
    score: 90,
    classAvg: null,
    overallAvg: null,
    byPos: [],
    wrong: [],
  })),
});

describe("jjKnownSlots", () => {
  it("받은 자료면 그림 자리 가용성", () => {
    const ok: JjDayState = { status: "ok", snapshot: snapshot(30, 1) };
    expect(jjKnownSlots(ok)).toEqual({ 시험결과지: true, 학습분석지: true });
    expect(jjKnownSlots({ status: "ok", snapshot: snapshot(0, 0) })).toEqual({ 시험결과지: false, 학습분석지: false });
  });

  it("🔑 미연결은 '그릴 게 없다'를 **안다** — 모름(null)과 다르다", () => {
    expect(jjKnownSlots({ status: "unlinked" })).toEqual({ 시험결과지: false, 학습분석지: false });
  });

  it("아직 안 받았거나 실패했으면 모름(null)", () => {
    expect(jjKnownSlots(undefined)).toBeNull();
    expect(jjKnownSlots({ status: "error", message: "x" })).toBeNull();
  });
});

describe("jjDaySummary · jjDayKey", () => {
  it("오늘 시험 수와 30일 푼 문제 수", () => {
    expect(jjDaySummary({ status: "ok", snapshot: snapshot(42, 2) })).toEqual({ exams: 2, answers: 42 });
    expect(jjDaySummary({ status: "unlinked" })).toBeNull();
    expect(jjDaySummary(undefined)).toBeNull();
  });

  it("키에 날짜가 들어간다(날짜를 넘기면 다른 자료)", () => {
    expect(jjDayKey("s1", "2026-09-11")).not.toBe(jjDayKey("s1", "2026-09-10"));
  });
});
