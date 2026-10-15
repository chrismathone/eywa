import { describe, expect, it } from "vitest";
import { diffImport, planUndo, type LineFields } from "./import-undo";

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
