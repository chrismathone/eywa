import { describe, expect, it } from "vitest";
import {
  countGoalCells,
  goalCellState,
  goalCellStateOf,
  indexDayLines,
  indexGoals,
  normalizeGoalsBoardRole,
} from "./goals-board";

const g = (textbook: string | null, targetProgress: string | null = null) => ({ textbook, targetProgress });

describe("goalCellState — 월간 ↔ 주간 대조", () => {
  it("월간이 없으면 none(주간이 있어도)", () => {
    expect(goalCellState(null, g("리딩튜터 3"))).toBe("none");
    expect(goalCellState(g("  ", ""), g("리딩튜터 3"))).toBe("none");
  });
  it("월간은 있는데 주간이 비면 weekEmpty", () => {
    expect(goalCellState(g("리딩튜터 3", "Unit 5~8"), null)).toBe("weekEmpty");
    expect(goalCellState(g("리딩튜터 3"), g("", " "))).toBe("weekEmpty");
  });
  it("표기 흔들림은 같은 책 — 월간 뷰 경고와 같은 눈", () => {
    expect(goalCellState(g("그래머인사이드LV3"), g("그래머인사이드", "Ch.3"))).toBe("same");
  });
  it("다른 책이면 diff", () => {
    expect(goalCellState(g("리딩튜터 3"), g("수능딥독"))).toBe("diff");
  });
  it("🔴 한쪽 교재가 비면 비교 불가라 same — 거짓 경보 금지", () => {
    expect(goalCellState(g(null, "Unit 5~8"), g("리딩튜터 3"))).toBe("same");
    expect(goalCellState(g("리딩튜터 3"), g(null, "Unit 6"))).toBe("same");
  });
});

describe("countGoalCells · indexGoals · normalizeGoalsBoardRole", () => {
  it("상태별로 센다", () => {
    expect(countGoalCells(["same", "diff", "diff", "none"])).toEqual({ same: 1, diff: 2, weekEmpty: 0, none: 1 });
  });
  it("역할이 다른 행은 버리고 월간·주간을 가른다 — 전체면 담임 → 부담임 순", () => {
    const rows = [
      { class_id: "c", scope: "month", role: "homeroom", skill_area: "vocab", textbook: "A", target_progress: "1" },
      { class_id: "c", scope: "week", role: "homeroom", skill_area: "vocab", textbook: "B", target_progress: null },
      { class_id: "c", scope: "month", role: "assistant", skill_area: "vocab", textbook: "Z", target_progress: null },
      { class_id: "c", scope: "week", role: "assistant", skill_area: "vocab", textbook: " ", target_progress: "" },
    ];
    const idx = indexGoals(rows, "homeroom");
    expect(idx.month.get("c|vocab")?.map((x) => x.goal.textbook)).toEqual(["A"]);
    expect(idx.week.get("c|vocab")?.map((x) => x.goal.textbook)).toEqual(["B"]);
    expect(indexGoals(rows, "assistant").month.get("c|vocab")?.map((x) => x.goal.textbook)).toEqual(["Z"]);
    const all = indexGoals(rows, "all");
    expect(all.month.get("c|vocab")?.map((x) => x.role)).toEqual(["homeroom", "assistant"]);
    // 빈 부담임 주간은 적힌 것으로 안 친다
    expect(all.week.get("c|vocab")?.map((x) => x.role)).toEqual(["homeroom"]);
  });
  it("goalCellStateOf — 같은 사람끼리 먼저 견준다", () => {
    const rg = (role: "homeroom" | "assistant", textbook: string) => ({ role, goal: { textbook, targetProgress: null } });
    expect(goalCellStateOf([rg("homeroom", "A"), rg("assistant", "Z")], [rg("assistant", "Z")])).toBe("same");
    expect(goalCellStateOf([rg("homeroom", "A")], [rg("assistant", "Q")])).toBe("diff");
    expect(goalCellStateOf([], [rg("homeroom", "A")])).toBe("none");
  });
  it("모르는 역할 값은 담임으로", () => {
    expect(normalizeGoalsBoardRole("assistant")).toBe("assistant");
    expect(normalizeGoalsBoardRole("all")).toBe("all");
    expect(normalizeGoalsBoardRole("x")).toBe("homeroom");
    expect(normalizeGoalsBoardRole(undefined)).toBe("homeroom");
  });
});

describe("indexDayLines — 일간", () => {
  const line = (o: Partial<import("./goals-board").PlanLineRow>) => ({
    class_id: "c",
    slot_start: "16:20:00",
    skill_area: "reading",
    line_no: 1,
    textbook: null,
    page_range: null,
    progress: null,
    homework: null,
    ...o,
  });
  it("🔴 자리(JJ) 교시 줄은 빼고, 빈 줄도 뺀다 — 교시·줄 순서대로", () => {
    const idx = indexDayLines(
      [
        line({ slot_start: "17:20:00", textbook: "B" }),
        line({ slot_start: "16:20:00", textbook: "A" }),
        line({ slot_start: "18:10:00", textbook: "SRS" }),
        line({ slot_start: "16:20:00", line_no: 2 }),
      ],
      new Map([["c", new Set(["18:10"])]]),
    );
    expect(idx.get("c|reading")?.map((l) => l.textbook)).toEqual(["A", "B"]);
  });
});
