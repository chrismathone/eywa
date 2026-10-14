import { describe, expect, it } from "vitest";
import {
  addToLessonIndex,
  addToTally,
  compareCell,
  emptyTally,
  lessonNoOf,
  matchRate,
  type LessonIndex,
} from "./plan-compare";

const index: LessonIndex = {};
addToLessonIndex(index, "Reading Smart 3", [
  { lessonNo: 1, progress: "Unit 1" },
  { lessonNo: 2, progress: "Unit 2" },
  { lessonNo: 3, progress: "Unit 3" },
]);

const base = (lessonNo: number) => ({ lessonNo, skillArea: "reading", title: "Reading Smart 3", progress: `Unit ${lessonNo}` });
const act = (progress: string | null, textbook: string | null = "Reading Smart 3") => ({
  skillArea: "reading",
  textbook,
  progress,
});

describe("compareCell — 원래 계획 ↔ 실제 (원장 2026-09-28)", () => {
  it("원래 계획이 없으면 비교하지 않는다", () => {
    expect(compareCell({ baseline: [], actual: [act("Unit 1")], lessonIndex: index, isFuture: false }).verdict).toBe(
      "noPlan",
    );
  });

  it("같은 진도면 일치 — 공백·대소문자·교재 표기 흔들림은 무시", () => {
    const c = compareCell({
      baseline: [base(2)],
      actual: [act("  unit   2 ", "ReadingSmart3")],
      lessonIndex: index,
      isFuture: false,
    });
    expect(c.verdict).toBe("match");
  });

  it("앞 차수를 했으면 늦음 + 몇 차수", () => {
    const c = compareCell({ baseline: [base(3)], actual: [act("Unit 1")], lessonIndex: index, isFuture: false });
    expect([c.verdict, c.lag]).toEqual(["behind", 2]);
  });

  it("뒤 차수를 했으면 빠름", () => {
    const c = compareCell({ baseline: [base(1)], actual: [act("Unit 2")], lessonIndex: index, isFuture: false });
    expect([c.verdict, c.lag]).toEqual(["ahead", 1]);
  });

  it("차수표에 없는 진도는 늦음을 지어내지 않고 '다름'", () => {
    const c = compareCell({ baseline: [base(2)], actual: [act("복습 테스트")], lessonIndex: index, isFuture: false });
    expect(c.verdict).toBe("differ");
  });

  it("다른 교재면 '다름'", () => {
    const c = compareCell({ baseline: [base(2)], actual: [act("Unit 2", "Grammar Inside")], lessonIndex: index, isFuture: false });
    expect(c.verdict).toBe("differ");
  });

  it("실제가 비었으면 지난 날은 미작성, 앞날은 예정 — 빈 줄은 없는 것과 같다", () => {
    expect(compareCell({ baseline: [base(1)], actual: [act(null, null)], lessonIndex: index, isFuture: false }).verdict).toBe(
      "unwritten",
    );
    expect(compareCell({ baseline: [base(1)], actual: [], lessonIndex: index, isFuture: true }).verdict).toBe("upcoming");
  });

  it("교재명을 안 적은 실제 줄은 같은 구분일 때만 짝이 된다", () => {
    const c = compareCell({
      baseline: [base(2)],
      actual: [{ skillArea: "vocab", textbook: null, progress: "Unit 2" }],
      lessonIndex: index,
      isFuture: false,
    });
    expect(c.verdict).toBe("differ");
    expect(c.lines[0]!.verdict).toBe("missing");
  });

  it("교재가 표기만 다른 이름이어도 차수표를 찾는다", () => {
    expect(lessonNoOf(index, "Reading Smart3", "unit 3")).toBe(3);
  });
});

describe("집계", () => {
  it("분모는 지난 칸만 · 예정·계획 없음은 밖 · 일치율은 분모 0이면 null", () => {
    const t = emptyTally();
    expect(matchRate(t)).toBeNull();
    addToTally(t, { verdict: "match", lag: 0, lines: [] });
    addToTally(t, { verdict: "behind", lag: 2, lines: [] });
    addToTally(t, { verdict: "unwritten", lag: 0, lines: [] });
    addToTally(t, { verdict: "upcoming", lag: 0, lines: [] });
    addToTally(t, { verdict: "noPlan", lag: 0, lines: [] });
    expect(t).toMatchObject({ due: 3, match: 1, behind: 1, unwritten: 1, upcoming: 1, lagSum: 2 });
    expect(matchRate(t)).toBe(33);
  });
});
