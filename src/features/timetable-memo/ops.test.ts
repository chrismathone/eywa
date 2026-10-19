import { describe, expect, it } from "vitest";
import { cellKey, cleanText, colName, emptyDoc, type SheetDoc } from "./doc";
import { cellAt, expandToMerges, layoutOf, mergeIndex, stepPos } from "./geometry";
import { applyBorders, clearContents, mergeCells, patchStyle, setTexts, unmergeCells } from "./ops";
import { deleteLines, ensureSize, insertLines, resizeLines } from "./ops-struct";
import { jumpPos } from "./nav";

const line = { w: 1 as const, c: "#000000", s: "solid" as const };
const small = (): SheetDoc => emptyDoc(6, 5);

describe("판 이름·좌표", () => {
  it("엑셀 열 이름", () => {
    expect([0, 25, 26, 51, 52, 69, 103].map(colName)).toEqual(["A", "Z", "AA", "AZ", "BA", "BR", "CZ"]);
  });
  it("좌표 → 칸(경계·판 밖은 가장자리)", () => {
    const l = layoutOf({ colW: [10, 20, 30], rowH: [5, 5] });
    expect(cellAt(l, 0, 0)).toEqual({ r: 0, c: 0 });
    expect(cellAt(l, 10, 4)).toEqual({ r: 0, c: 1 });
    expect(cellAt(l, 59, 9)).toEqual({ r: 1, c: 2 });
    expect(cellAt(l, 999, 999)).toEqual({ r: 1, c: 2 });
    expect(cellAt(l, -5, -5)).toEqual({ r: 0, c: 0 });
  });
  it("병합 일부만 고르면 병합 전체로 넓힌다 · 이동은 병합을 한 칸처럼", () => {
    const d = mergeCells(small(), { r0: 1, c0: 1, r1: 2, c1: 2 });
    expect(expandToMerges({ r0: 2, c0: 0, r1: 2, c1: 1 }, d.merges)).toEqual({ r0: 1, c0: 0, r1: 2, c1: 2 });
    const idx = mergeIndex(d.merges);
    expect(stepPos(d, idx, { r: 1, c: 1 }, 1, 0)).toEqual({ r: 3, c: 1 });
    expect(stepPos(d, idx, { r: 0, c: 1 }, 1, 0)).toEqual({ r: 1, c: 1 });
  });
});

describe("편집", () => {
  it("글자·서식 넣고 지우기 — 빈 칸은 키째 빠진다", () => {
    let d = setTexts(small(), [{ r: 0, c: 0, t: "추민아" }]);
    d = patchStyle(d, { r0: 0, c0: 0, r1: 0, c1: 1 }, { b: true, bg: "#ff0000" });
    expect(d.cells[cellKey(0, 0)]).toEqual({ t: "추민아", s: { b: true, bg: "#ff0000" } });
    d = patchStyle(d, { r0: 0, c0: 0, r1: 0, c1: 1 }, { b: null, bg: null });
    expect(d.cells[cellKey(0, 1)]).toBeUndefined();
    expect(d.cells[cellKey(0, 0)]).toEqual({ t: "추민아" });
    d = clearContents(d, { r0: 0, c0: 0, r1: 0, c1: 0 });
    expect(d.cells).toEqual({});
  });
  it("병합은 왼쪽 위 글자만 남기고, 해제하면 병합만 풀린다", () => {
    let d = setTexts(small(), [{ r: 0, c: 0, t: "가" }, { r: 0, c: 1, t: "나" }]);
    d = mergeCells(d, { r0: 0, c0: 0, r1: 0, c1: 1 });
    expect(d.merges).toEqual([{ r: 0, c: 0, rs: 1, cs: 2 }]);
    expect(d.cells[cellKey(0, 1)]).toBeUndefined();
    d = unmergeCells(d, { r0: 0, c0: 1, r1: 0, c1: 1 });
    expect(d.merges).toEqual([]);
    expect(d.cells[cellKey(0, 0)]?.t).toBe("가");
  });
  it("왼쪽 위가 비었으면 첫 글자를 올린다(빈 칸에서 시작한 병합이 글자를 지우지 않게)", () => {
    let d = setTexts(small(), [{ r: 1, c: 0, t: "11월 퇴원생 명단" }, { r: 2, c: 1, t: "둘째" }]);
    d = mergeCells(d, { r0: 0, c0: 0, r1: 2, c1: 1 });
    expect(d.cells[cellKey(0, 0)]?.t).toBe("11월 퇴원생 명단");
    expect(d.cells[cellKey(1, 0)]).toBeUndefined();
    expect(d.cells[cellKey(2, 1)]).toBeUndefined();
  });
  it("바깥 테두리는 이웃의 마주 보는 변을 지운다 · 없음은 범위 안 전부", () => {
    let d = applyBorders(small(), { r0: 0, c0: 0, r1: 2, c1: 0 }, "all", { ...line, c: "#ff0000" });
    d = applyBorders(d, { r0: 0, c0: 1, r1: 0, c1: 1 }, "outer", line);
    // (0,0)의 오른쪽 변(빨강)은 (0,1)의 바깥 왼쪽 변(검정)에 밀려 지워진다.
    expect(d.cells[cellKey(0, 0)]?.s?.bd?.r).toBeUndefined();
    expect(d.cells[cellKey(0, 1)]?.s?.bd).toEqual({ t: line, r: line, b: line, l: line });
    d = applyBorders(d, { r0: 0, c0: 0, r1: 5, c1: 4 }, "none", line);
    expect(Object.values(d.cells).every((c) => !c.s?.bd)).toBe(true);
  });
});

describe("행·열 넣기/지우기", () => {
  it("넣는 자리를 가로지르는 병합은 늘고, 아래 칸은 밀린다", () => {
    let d = setTexts(emptyDoc(6, 3), [{ r: 3, c: 0, t: "아래" }]);
    d = mergeCells(d, { r0: 1, c0: 0, r1: 2, c1: 0 });
    d = insertLines(d, "row", 2, 2);
    expect(d.rows).toBe(8);
    expect(d.rowH).toHaveLength(8);
    expect(d.merges).toEqual([{ r: 1, c: 0, rs: 4, cs: 1 }]);
    expect(d.cells[cellKey(5, 0)]?.t).toBe("아래");
  });
  it("지우면 병합은 줄고, 한 칸만 남으면 사라진다 · 최소 한 줄", () => {
    let d = mergeCells(emptyDoc(4, 4), { r0: 0, c0: 1, r1: 0, c1: 2 });
    d = deleteLines(d, "col", 2, 1);
    expect(d.cols).toBe(3);
    expect(d.merges).toEqual([]);
    d = deleteLines(d, "col", 0, 10);
    expect(d.cols).toBe(1);
  });
  it("크기 바꾸기·판 키우기", () => {
    const d = resizeLines(emptyDoc(2, 2), "col", [0, 1], 3);
    expect(d.colW).toEqual([6, 6]);
    expect(ensureSize(d, 5, 4)).toMatchObject({ rows: 5, cols: 4 });
  });
});

describe("칸 글자 정리", () => {
  it("상한에서 자를 때 이모지를 쪼개지 않고, 짝 없는 반쪽은 대체 문자로", () => {
    expect(cleanText("ab😀c", 3)).toBe("ab");
    expect(cleanText("ab😀c", 4)).toBe("ab😀");
    expect(cleanText("x\ud83dy")).toBe("x�y");
    expect(cleanText("\ude00")).toBe("�");
    expect(setTexts(emptyDoc(1, 1), [{ r: 0, c: 0, t: "가".repeat(6000) }]).cells["0,0"]?.t).toHaveLength(5000);
  });
});

describe("Ctrl+방향키", () => {
  it("찬 칸이 이어지면 그 끝, 아니면 다음 찬 칸 · 없으면 판 끝", () => {
    const d = setTexts(emptyDoc(1, 8), [0, 1, 2, 5].map((c) => ({ r: 0, c, t: "x" })));
    expect(jumpPos(d, { r: 0, c: 0 }, 0, 1)).toEqual({ r: 0, c: 2 });
    expect(jumpPos(d, { r: 0, c: 2 }, 0, 1)).toEqual({ r: 0, c: 5 });
    expect(jumpPos(d, { r: 0, c: 5 }, 0, 1)).toEqual({ r: 0, c: 7 });
  });
});
