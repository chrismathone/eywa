import { describe, it, expect } from "vitest";
import {
  buildLearning,
  findSession,
  dateKo,
  pctOf,
  SESSION_DATES,
} from "./history";
import type { OneScreenStudent } from "@/features/onescreen/types";

function makeBase(overrides: Partial<OneScreenStudent> = {}): OneScreenStudent {
  return {
    id: "s1",
    name: "김서연",
    grade: "중2",
    tag: "A반",
    attendance: "출석",
    subjects: [
      { name: "영어 독해", prev: "Unit 7 · p.82", today: "Unit 8 · p.90" },
      { name: "영어 문법", prev: "관계대명사", today: "관계부사" },
    ],
    tests: {
      daily: { score: 18, max: 20, prevScore: 16 },
      check: { score: 19, max: 20, prevScore: 17 },
    },
    attitude: "아주 좋음",
    homework: "완료",
    progressConfirmed: false,
    reportDraft: "",
    reportSent: true,
    ...overrides,
  };
}

describe("buildLearning", () => {
  it("결정적 — 같은 base/idx면 항상 같은 이력", () => {
    const a = buildLearning(makeBase(), 0);
    const b = buildLearning(makeBase(), 0);
    expect(a.history).toEqual(b.history);
    expect(a.stat).toEqual(b.stat);
  });

  it("9세션 + 날짜가 SESSION_DATES와 일치", () => {
    const { history } = buildLearning(makeBase(), 0);
    expect(history).toHaveLength(9);
    expect(history.map((h) => h.date)).toEqual(SESSION_DATES);
  });

  it("마지막 세션은 base의 UI값으로 오버라이드", () => {
    const { history } = buildLearning(makeBase(), 0);
    const last = history[8]!;
    expect(last.subjects[0]!.today).toBe("Unit 8 · p.90");
    expect(last.subjects[0]!.daily).toBe(18); // base.tests.daily.score
    expect(last.subjects[0]!.check).toBe(19);
    expect(last.attendance).toBe("출석");
    expect(last.attitude).toBe("아주 좋음");
    expect(last.reportSent).toBe(true);
  });

  it("prev 점수는 직전 세션 집계(첫 세션은 null)", () => {
    const { history } = buildLearning(makeBase(), 0);
    expect(history[0]!.prevDaily).toBeNull();
    expect(history[3]!.prevDaily).toBe(history[2]!.daily);
  });

  it("stat 범위/형태 — sessions=9, 나머지 0~100", () => {
    const { stat, curriculum } = buildLearning(makeBase(), 0);
    expect(stat.sessions).toBe(9);
    for (const k of ["avgPct", "attRate", "currPct"] as const) {
      expect(stat[k]).toBeGreaterThanOrEqual(0);
      expect(stat[k]).toBeLessThanOrEqual(100);
    }
    expect(curriculum).toHaveLength(2);
    expect(curriculum[0]!.done).toBeLessThanOrEqual(16);
  });

  it("학생 idx가 다르면 이력도 다름", () => {
    const a = buildLearning(makeBase({ reportSent: false, attitude: null }), 1);
    const b = buildLearning(makeBase({ reportSent: false, attitude: null }), 4);
    expect(a.history).not.toEqual(b.history);
  });
});

describe("findSession", () => {
  const { history } = buildLearning(makeBase(), 0);
  it("날짜로 찾기", () => {
    expect(findSession(history, "5/14").date).toBe("5/14");
  });
  it("없는 날짜/누락 시 최신", () => {
    expect(findSession(history, "9/9").date).toBe("6/1");
    expect(findSession(history, null).date).toBe("6/1");
  });
});

describe("pctOf / dateKo", () => {
  it("pctOf 백분율", () => {
    expect(pctOf(18, 20)).toBe(90);
    expect(pctOf(5, 0)).toBe(0);
  });
  it("dateKo 한국어 날짜", () => {
    expect(dateKo("5/7")).toBe("5월 7일");
  });
});
