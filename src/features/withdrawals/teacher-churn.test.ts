import { describe, expect, it } from "vitest";
import {
  churnCellOf, comparePair, countsFrom, deltaOf, deltaText, inTenure, subjectsTaught, taughtIn, heatMix, monthSpan, parseChurnSort, rateText, sortTeachers, yyMm,
  type ChurnCell, type ChurnMonth, type ChurnTeacherRow,
} from "./teacher-churn";

const ok = (rate: number, base = 40, counted = 2, closed = true): ChurnCell => ({ state: "ok", rate, base, counted, closed, end: "" });
const row = (id: string, name: string, cells: Record<string, ChurnCell>): ChurnTeacherRow =>
  ({ id, name, subjects: [], subjectsByMonth: {}, hireDate: null, resignDate: null, cells });
const months = (list: [string, boolean][]): ChurnMonth[] => list.map(([month, partial]) => ({ month, partial, ends: [`${month}-28`] }));

describe("churnCellOf — 저장된 퇴원율 항목 그대로", () => {
  it("퇴원율·분모·분자를 그대로 옮긴다(다시 계산하지 않는다)", () => {
    expect(churnCellOf({ id: "churn", raw: 3.9, base: 51, counted: 2, detail: [{ studentId: "x" }] }, true, "2026-09-30"))
      .toEqual({ state: "ok", rate: 3.9, base: 51, counted: 2, closed: true, end: "2026-09-30" });
  });
  it("분모 0·퇴원율 비움 = 담당 없음(0%가 아니다)", () => {
    expect(churnCellOf({ id: "churn", raw: null, base: 0, counted: 0, missing: true }, true).state).toBe("noBase");
  });
  it("분모가 있는데 퇴원율이 비었으면 '담당 없음'이 아니라 확인 불가(저장 모양이 어긋남)", () => {
    expect(churnCellOf({ id: "churn", raw: null, base: 10, counted: 1 }, true).state).toBe("unreadable");
  });
  it("퇴원율 항목이 아니거나 모양이 틀리면 확인 불가", () => {
    expect(churnCellOf({ id: "payRatio", raw: 5, base: 3, counted: 1 }, true).state).toBe("unreadable");
    expect(churnCellOf({ id: "churn", raw: 5 }, false)).toEqual({ state: "unreadable", rate: null, base: 0, counted: 0, closed: false, end: "" });
    expect(churnCellOf(undefined, true).state).toBe("unreadable");
  });
});

describe("comparePair — 모든 강사가 같은 두 달로 견준다", () => {
  it("진행 중이 아닌 가장 최근 달과 그 앞 달", () => {
    expect(comparePair(months([["2026-09", false], ["2026-10", false], ["2026-11", true]]))).toEqual(["2026-09", "2026-10"]);
  });
  it("해가 바뀌는 달도 잇는다", () => {
    expect(comparePair(months([["2025-12", false], ["2026-01", false]]))).toEqual(["2025-12", "2026-01"]);
  });
  it("앞 달이 표에 없거나 마감한 달이 없으면 null", () => {
    expect(comparePair(months([["2026-08", false], ["2026-10", false]]))).toBeNull();
    expect(comparePair(months([["2026-11", true]]))).toBeNull();
  });
});

describe("deltaOf — 두 칸 다 마감·퇴원율이 있을 때만", () => {
  const pair: [string, string] = ["2026-09", "2026-10"];
  it("%p 차이(소수 한 자리)", () => {
    expect(deltaOf(row("a", "가", { "2026-09": ok(3.9), "2026-10": ok(6.1) }), pair)).toEqual({ kind: "value", delta: 2.2 });
  });
  it("한쪽이 마감 전이면 '마감 전' — 다른 두 달로 바꿔 견주지 않는다", () => {
    expect(deltaOf(row("a", "가", { "2026-09": ok(3.9), "2026-10": ok(6.1, 40, 2, false) }), pair)).toEqual({ kind: "open" });
  });
  it("칸이 없거나 퇴원율이 없으면 비교 없음", () => {
    expect(deltaOf(row("a", "가", { "2026-10": ok(6.1) }), pair)).toEqual({ kind: "none" });
    const none: ChurnCell = { state: "noBase", rate: null, base: 0, counted: 0, closed: true, end: "" };
    expect(deltaOf(row("a", "가", { "2026-09": none, "2026-10": ok(6.1) }), pair)).toEqual({ kind: "none" });
    expect(deltaOf(row("a", "가", { "2026-09": ok(1), "2026-10": ok(2) }), null)).toEqual({ kind: "none" });
  });
});

describe("sortTeachers", () => {
  const pair: [string, string] = ["2026-09", "2026-10"];
  const rows = [
    row("a", "다강사", { "2026-10": ok(2) }),
    row("b", "가강사", { "2026-10": ok(8) }),
    row("c", "나강사", { "2026-10": ok(8, 40, 3, false) }), // 마감 전 — 뒤로
    row("d", "라강사", {}),
    row("e", "마강사", { "2026-10": ok(2) }),
  ];
  it("recent = 공통 비교 달 퇴원율 높은 순 · 같으면 이름 · 마감 전·값 없음은 뒤(이름 순)", () => {
    expect(sortTeachers(rows, pair, "recent").map((r) => r.name)).toEqual(["가강사", "다강사", "마강사", "나강사", "라강사"]);
  });
  it("name = 가나다 · 비교할 두 달이 없으면 이름순", () => {
    expect(sortTeachers(rows, pair, "name").map((r) => r.name)).toEqual(["가강사", "나강사", "다강사", "라강사", "마강사"]);
    expect(sortTeachers(rows, null, "recent").map((r) => r.name)).toEqual(["가강사", "나강사", "다강사", "라강사", "마강사"]);
  });
  it("저장값 해석 — 모르는 값은 기본(recent)", () => {
    expect(parseChurnSort("name")).toBe("name");
    expect(parseChurnSort("period")).toBe("recent");
    expect(parseChurnSort(undefined)).toBe("recent");
  });
});

describe("countsFrom — 입사 다음 달부터(입사한 달 값도 입사 전 기록으로 셈한 것)", () => {
  it("월초·월중 입사 모두 다음 달 · 해 넘김 · 입사일 없으면 자르지 않음", () => {
    expect(countsFrom("2026-09-01")).toBe("2026-10");
    expect(countsFrom("2026-07-07")).toBe("2026-08");
    expect(countsFrom("2025-12-15")).toBe("2026-01");
    expect(countsFrom(null)).toBeNull();
    expect(countsFrom("")).toBeNull();
  });
});

describe("inTenure — 입사 다음 달부터 퇴사한 달까지", () => {
  it("입사·퇴사 둘 다", () => {
    expect(inTenure("2026-07", "2025-07-07", "2026-10-31")).toBe(true);
    expect(inTenure("2026-10", "2025-07-07", "2026-10-31")).toBe(true);
    expect(inTenure("2026-11", "2025-07-07", "2026-10-31")).toBe(false);
    expect(inTenure("2026-09", "2026-09-01", null)).toBe(false);
    expect(inTenure("2026-10", "2026-09-01", null)).toBe(true);
  });
  it("모르는 쪽은 자르지 않는다", () => {
    expect(inTenure("2020-01", null, null)).toBe(true);
    expect(inTenure("2030-01", "2026-01-01", null)).toBe(true);
  });
});

describe("taughtIn · subjectsTaught — 고른 기간 안에 가르친 과목만", () => {
  const ms = months([["2026-09", false], ["2026-10", false]]);
  const a = { ...row("a", "가", {}), subjectsByMonth: { "2026-04": ["english"], "2026-09": ["math"], "2026-10": ["math"] } };
  it("기간 밖 과목 이력으로 고르지 않는다", () => {
    expect(taughtIn(a, ms, "math")).toBe(true);
    expect(taughtIn(a, ms, "english")).toBe(false);
    expect(taughtIn(a, ms, "all")).toBe(true);
    expect([...subjectsTaught([a], ms)]).toEqual(["math"]);
  });
});

describe("monthSpan — 축은 빠짐없이", () => {
  it("해를 넘겨도 한 달씩", () => {
    expect(monthSpan("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(monthSpan("2026-04", "2026-04")).toEqual(["2026-04"]);
    expect(monthSpan("2026-05", "2026-04")).toEqual([]);
  });
});

describe("표시", () => {
  it("색 농도 = 퇴원율에만 비례 · 20% 이상은 끝 · 0%·없음은 칠하지 않는다", () => {
    expect(heatMix(null)).toBe(0);
    expect(heatMix(0)).toBe(0);
    expect(heatMix(10)).toBe(40);
    expect(heatMix(20)).toBe(80);
    expect(heatMix(50)).toBe(80);
  });
  it("글자", () => {
    expect(rateText(3.9)).toBe("3.9%");
    expect(rateText(0)).toBe("0%");
    expect(deltaText(2.2)).toBe("+2.2%p");
    expect(deltaText(-1)).toBe("−1%p");
    expect(deltaText(0)).toBe("0%p");
    expect(yyMm("2026-04")).toBe("26.04");
    expect(yyMm("2026-11")).toBe("26.11");
    expect(yyMm("2027-01")).toBe("27.01");
  });
});
