import { describe, expect, it } from "vitest";
import {
  expandPeriodDates,
  findPeriodForDate,
  monthBounds,
  periodIncludes,
  resolvePeriodWindow,
  type PeriodDef,
} from "./resolve";

// 2026년 3월 세션 = 3/6~4/2 (달력월을 넘긴다 — 공휴일로 빠진 요일을 4월 초에서 채운 형태)
const mathBase: PeriodDef = {
  id: "def-math-3",
  subjectKey: "math",
  classId: null,
  labelYear: 2026,
  labelMonth: 3,
  startDate: "2026-03-06",
  endDate: "2026-04-02",
};
const mathClassException: PeriodDef = {
  ...mathBase,
  id: "def-math-3-jj2b",
  classId: "class-jj2b",
  startDate: "2026-03-09",
  endDate: "2026-04-06",
};

describe("monthBounds", () => {
  it("말일을 정확히 잡는다(윤년 2월 포함)", () => {
    expect(monthBounds("2026-02")).toMatchObject({ start: "2026-02-01", end: "2026-02-28" });
    expect(monthBounds("2028-02")).toMatchObject({ start: "2028-02-01", end: "2028-02-29" });
    expect(monthBounds("2026-12")).toMatchObject({ start: "2026-12-01", end: "2026-12-31" });
  });

  it("형식이 아니면 null", () => {
    expect(monthBounds("2026-13")).toBeNull();
    expect(monthBounds("2026-00")).toBeNull();
    expect(monthBounds("2026-3")).toBeNull();
    expect(monthBounds("")).toBeNull();
  });
});

describe("resolvePeriodWindow — 폴백이 기본 경로다", () => {
  it("정의가 없으면 달력월로 떨어진다(에러 아님)", () => {
    const w = resolvePeriodWindow({ period: "2026-03", subjectKey: "math", defs: [] });
    expect(w).toMatchObject({ kind: "month", scope: null, start: "2026-03-01", end: "2026-03-31" });
    expect(w.label).toBe("2026년 3월");
  });

  it("과목이 지정 안 되면 달력월(과목 없이는 세션을 특정할 수 없다)", () => {
    const w = resolvePeriodWindow({ period: "2026-03", defs: [mathBase] });
    expect(w.kind).toBe("month");
  });

  it("다른 과목의 세션을 가져다 쓰지 않는다", () => {
    const w = resolvePeriodWindow({ period: "2026-03", subjectKey: "english", defs: [mathBase] });
    expect(w.kind).toBe("month");
  });

  it("다른 달의 세션을 가져다 쓰지 않는다", () => {
    const w = resolvePeriodWindow({ period: "2026-04", subjectKey: "math", defs: [mathBase] });
    expect(w).toMatchObject({ kind: "month", start: "2026-04-01", end: "2026-04-30" });
  });
});

describe("resolvePeriodWindow — 세션 적중", () => {
  it("과목 기본값을 찾는다(달력월을 넘겨도 그대로)", () => {
    const w = resolvePeriodWindow({ period: "2026-03", subjectKey: "math", defs: [mathBase] });
    expect(w).toMatchObject({
      kind: "session",
      scope: "subject",
      start: "2026-03-06",
      end: "2026-04-02",
      defId: "def-math-3",
    });
    expect(w.label).toBe("2026년 3월 세션 (3/6~4/2)");
  });

  it("반 예외가 있으면 과목 기본값보다 우선한다", () => {
    const w = resolvePeriodWindow({
      period: "2026-03",
      subjectKey: "math",
      classId: "class-jj2b",
      defs: [mathBase, mathClassException],
    });
    expect(w).toMatchObject({ kind: "session", scope: "class", start: "2026-03-09", defId: "def-math-3-jj2b" });
  });

  it("반 예외가 없는 반은 과목 기본값으로 떨어진다", () => {
    const w = resolvePeriodWindow({
      period: "2026-03",
      subjectKey: "math",
      classId: "class-other",
      defs: [mathBase, mathClassException],
    });
    expect(w).toMatchObject({ scope: "subject", defId: "def-math-3" });
  });

  it("반 예외만 있고 과목 기본값이 없으면, 다른 반은 달력월", () => {
    const w = resolvePeriodWindow({
      period: "2026-03",
      subjectKey: "math",
      classId: "class-other",
      defs: [mathClassException],
    });
    expect(w.kind).toBe("month");
  });
});

describe("resolvePeriodWindow — 깨진 입력은 조용히 세지 않는다", () => {
  it("start > end 인 행은 세션으로 인정하지 않는다", () => {
    const broken: PeriodDef = { ...mathBase, startDate: "2026-04-02", endDate: "2026-03-06" };
    expect(resolvePeriodWindow({ period: "2026-03", subjectKey: "math", defs: [broken] }).kind).toBe("month");
  });

  it("날짜 형식이 깨진 행도 달력월로", () => {
    const broken: PeriodDef = { ...mathBase, endDate: "2026-4-2" };
    expect(resolvePeriodWindow({ period: "2026-03", subjectKey: "math", defs: [broken] }).kind).toBe("month");
  });

  it("period가 깨지면 todayIso가 속한 달로 clamp한다(빈 창으로 전건 조회 방지)", () => {
    const w = resolvePeriodWindow({ period: "쓰레기", subjectKey: "math", defs: [mathBase], todayIso: "2026-08-07" });
    expect(w).toMatchObject({ kind: "month", start: "2026-08-01", end: "2026-08-31" });
  });

  it("period도 깨지고 todayIso도 없으면 빈 창 + 한글 라벨(raw 코드 노출 금지)", () => {
    const w = resolvePeriodWindow({ period: "", subjectKey: "math", defs: [mathBase] });
    expect(w).toMatchObject({ kind: "month", start: "", end: "" });
    expect(w.label).toBe("기간을 확인할 수 없습니다");
    expect(periodIncludes(w, "2026-03-10")).toBe(false); // 빈 창은 아무 날도 포함하지 않는다
  });
});

describe("resolvePeriodWindow — mode='month'는 표시 렌즈", () => {
  it("정의가 있어도 달력월로 본다", () => {
    const w = resolvePeriodWindow({ period: "2026-03", subjectKey: "math", defs: [mathBase], mode: "month" });
    expect(w).toMatchObject({ kind: "month", start: "2026-03-01", end: "2026-03-31" });
  });
});

describe("periodIncludes / expandPeriodDates", () => {
  const w = resolvePeriodWindow({ period: "2026-03", subjectKey: "math", defs: [mathBase] });

  it("양끝을 포함한다", () => {
    expect(periodIncludes(w, "2026-03-06")).toBe(true);
    expect(periodIncludes(w, "2026-04-02")).toBe(true);
    expect(periodIncludes(w, "2026-03-05")).toBe(false);
    expect(periodIncludes(w, "2026-04-03")).toBe(false);
  });

  it("주말을 빼지 않는다(세션에 편입 — 원장 2026-08-07)", () => {
    const days = expandPeriodDates(w);
    expect(days[0]).toBe("2026-03-06");
    expect(days.at(-1)).toBe("2026-04-02");
    expect(days).toHaveLength(28);
    expect(days).toContain("2026-03-07"); // 토
    expect(days).toContain("2026-03-08"); // 일
  });

  it("월 경계를 넘어 이어진다", () => {
    const days = expandPeriodDates(w);
    expect(days).toContain("2026-03-31");
    expect(days).toContain("2026-04-01");
  });

  it("빈 창은 빈 배열", () => {
    expect(expandPeriodDates({ ...w, start: "", end: "" })).toEqual([]);
  });
});

describe("findPeriodForDate — 출석 한 건이 어느 세션인지", () => {
  const defs = [mathBase, mathClassException];

  it("과목 기본값으로 찾는다", () => {
    expect(findPeriodForDate(defs, "math", "2026-04-01")?.id).toBe("def-math-3");
  });

  it("반 예외가 우선", () => {
    expect(findPeriodForDate(defs, "math", "2026-04-05", "class-jj2b")?.id).toBe("def-math-3-jj2b");
  });

  it("어느 세션에도 안 속하면 null(달력월로 처리하라는 신호)", () => {
    expect(findPeriodForDate(defs, "math", "2026-03-01")).toBeNull();
    expect(findPeriodForDate(defs, "english", "2026-03-10")).toBeNull();
  });
});
