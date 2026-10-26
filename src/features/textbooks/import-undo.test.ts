import { describe, expect, it } from "vitest";
import { diffImport, historyKindOf, planUndo, shiftTitleOf, splitBatchRows, undoChain, type LineFields } from "./import-undo";

const ME = "me";

describe("diffImport — 가져오기 앞뒤 차이", () => {
  it("새 줄은 added, 빈 칸을 채운 줄은 바뀐 칸만 담는다", () => {
    const before = new Map<string, LineFields>([
      ["kept", { textbook: "RANK", progress: "S4", homework: null, page_range: null }],
      ["blank", { textbook: null, progress: "", homework: null, page_range: null }],
    ]);
    const after = [
      { id: "kept", textbook: "RANK", progress: "S4", homework: null, page_range: null, updated_by: "x" },
      { id: "blank", textbook: "RANK", progress: "S5", homework: null, page_range: null, updated_by: ME },
      { id: "new", textbook: "RANK", progress: "S6", homework: "p.3", page_range: null, updated_by: ME },
    ];
    expect(diffImport(before, after, ME)).toEqual([
      { id: "blank", added: false, after: { textbook: "RANK", progress: "S5" }, before: { textbook: null, progress: "" } },
      { id: "new", added: true, after: { textbook: "RANK", page_range: null, progress: "S6", homework: "p.3" } },
    ]);
  });

  it("그 사이 다른 사람이 만든 줄은 가져오기 몫이 아니다", () => {
    const after = [{ id: "other", textbook: "X", progress: null, homework: null, page_range: null, updated_by: "someone" }];
    expect(diffImport(new Map(), after, ME)).toEqual([]);
  });
});

describe("planUndo — 손대지 않은 칸만 되돌린다", () => {
  const rows = [
    { id: "new", added: true, after: { textbook: "RANK", page_range: null, progress: "S6", homework: null } },
    { id: "fill", added: false, after: { textbook: "RANK", progress: "S5" }, before: { textbook: null, progress: null } },
  ];

  it("그대로면 새 줄은 지우고 채운 칸은 비운다", () => {
    const current = new Map<string, LineFields>([
      ["new", { textbook: "RANK", page_range: "", progress: "S6", homework: null }],
      ["fill", { textbook: "RANK", progress: "S5", homework: "직접 적은 숙제" }],
    ]);
    expect(planUndo(rows, current)).toEqual({
      deletes: ["new"],
      resets: [{ id: "fill", patch: { textbook: null, progress: null } }],
      restored: 2,
      kept: 0,
    });
  });

  it("고쳐 쓴 새 줄은 남기고, 한 칸만 고친 줄은 나머지 칸만 비운다", () => {
    const current = new Map<string, LineFields>([
      ["new", { textbook: "RANK", progress: "S6 (절반만)", homework: null, page_range: null }],
      ["fill", { textbook: "RANK", progress: "S5 복습" }],
    ]);
    expect(planUndo(rows, current)).toEqual({
      deletes: [],
      resets: [{ id: "fill", patch: { textbook: null } }],
      restored: 1,
      kept: 1,
    });
  });

  it("사라진 줄(지웠거나 미룸으로 옮김)은 건드리지 않고 남긴 수로 센다", () => {
    expect(planUndo(rows, new Map())).toEqual({ deletes: [], resets: [], restored: 0, kept: 2 });
  });
});

describe("splitBatchRows / undoChain — plan meta, last 5", () => {
  it("separates the plan meta element from line rows; old records have no plan", () => {
    const row = { id: "l1", added: true, after: { textbook: "RANK" } };
    expect(splitBatchRows([{ kind: "plan", planId: "p1", title: "RANK" }, row])).toEqual({
      rows: [row],
      plan: { kind: "plan", planId: "p1", title: "RANK" },
      meta: { kind: "plan", planId: "p1", title: "RANK" },
    });
    expect(splitBatchRows([row])).toEqual({ rows: [row], plan: null, meta: null });
    expect(splitBatchRows(null)).toEqual({ rows: [], plan: null, meta: null });
    expect(splitBatchRows([1, "x", { kind: "plan" }, row]).rows).toEqual([row]);
  });

  it("picking one undoes it and everything newer, newest first", () => {
    const recent = [{ id: "c" }, { id: "b" }, { id: "a" }];
    expect(undoChain(recent, "c")).toEqual([{ id: "c" }]);
    expect(undoChain(recent, "a")).toEqual([{ id: "c" }, { id: "b" }, { id: "a" }]);
    expect(undoChain(recent, "zz")).toBeNull();
  });
});

describe("history kinds — fill / shift / delete (2026-10-26)", () => {
  it("reads shift and delete meta; they carry no line rows", () => {
    const token = { classId: "c", date: "2026-10-26", slot: "16:00", removed: [], added: [], changed: [], markers: [] };
    const shift = splitBatchRows([{ kind: "shift", shift: "skip", title: "RANK", token }]);
    expect(shift.rows).toEqual([]);
    expect(shift.plan).toBeNull();
    expect(historyKindOf(shift.meta)).toBe("skip");
    const del = splitBatchRows([{ kind: "delete", title: null, plan: { id: "p" } }]);
    expect(historyKindOf(del.meta)).toBe("delete");
    expect(historyKindOf(splitBatchRows([{ kind: "shift", shift: "bogus", token }]).meta)).toBe("fill");
    expect(historyKindOf(null)).toBe("fill");
  });

  it("shift title = first textbook among touched lines", () => {
    expect(
      shiftTitleOf({
        removed: [{ textbook: " " }],
        added: [],
        changed: [{ before: { textbook: null }, after: { textbook: "Grammar Inside" } }],
      }),
    ).toBe("Grammar Inside");
    expect(shiftTitleOf({ removed: [], added: [], changed: [] })).toBeNull();
  });
});
