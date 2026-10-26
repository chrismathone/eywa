import { describe, expect, it } from "vitest";
import { jjDayKey, jjDaySummary, jjKnownSlots, jjOptionChecked, toggleJjPick, type JjDayState } from "./jj-day";
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
    expect(jjKnownSlots(ok)).toEqual({ 시험결과지: true, 학습분석지: true, 단어백분위: false, 학습배지: false });
    expect(jjKnownSlots({ status: "ok", snapshot: snapshot(0, 0) })).toEqual({ 시험결과지: false, 학습분석지: false, 단어백분위: false, 학습배지: false });
  });

  it("🔑 미연결은 '그릴 게 없다'를 **안다** — 모름(null)과 다르다", () => {
    expect(jjKnownSlots({ status: "unlinked" })).toEqual({ 시험결과지: false, 학습분석지: false, 단어백분위: false, 학습배지: false });
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

describe("결과지 고르기 — jjOptionChecked · toggleJjPick (2026-09-28)", () => {
  const opt = (id: string, submittedAt: string) => ({
    attemptId: id,
    deckId: `d-${id}`,
    deck: id,
    examType: "regular",
    submittedAt,
    total: 20,
    correct: 18,
    score: 90,
  });
  // KST 9/28 오후 = UTC 9/28 07시 / KST 9/17 = 보카킹 / KST 9/29 00:30 = UTC 9/28 15:30(날짜 경계)
  const today = opt("today", "2026-09-28T07:00:00.000Z");
  const voca = opt("voca", "2026-09-17T08:34:09.999Z");
  const lateNight = opt("late", "2026-09-28T15:30:00.000Z");
  const options = [lateNight, today, voca];

  it("기본(null) = 그 KST 날짜에 낸 시험만", () => {
    expect(options.filter((o) => jjOptionChecked(o, null, "2026-09-28")).map((o) => o.attemptId)).toEqual(["today"]);
  });
  it("처음 누르면 지금 붙은 것에서 출발해 명시 배열이 된다", () => {
    expect(toggleJjPick(options, null, "2026-09-28", "voca")).toEqual(["today", "voca"]);
    expect(toggleJjPick(options, null, "2026-09-28", "today")).toEqual([]);
  });
  it("명시 고르기에서 켜고 끈다 · 목록 순서를 따른다", () => {
    expect(toggleJjPick(options, ["voca"], "2026-09-28", "late")).toEqual(["late", "voca"]);
    expect(toggleJjPick(options, ["late", "voca"], "2026-09-28", "late")).toEqual(["voca"]);
  });
  it("목록 밖으로 밀린 고른 응시는 지키고 간다", () => {
    expect(toggleJjPick(options, ["old"], "2026-09-28", "voca")).toEqual(["voca", "old"]);
  });
});
