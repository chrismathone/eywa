import { describe, expect, it } from "vitest";
import { autoFitLines, wrappedLineCount, type Measure } from "./autofit";
import { DEFAULT_COL_W, cellKey, emptyDoc, type SheetDoc } from "./doc";
import { headerLinesAt } from "./geometry";

/** 글자 한 자 = 7px(굵게는 8px) — 브라우저 없이 계산만 본다. */
const measure: Measure = (t, s) => t.length * (s?.b ? 8 : 7);

function withTexts(rows: number, cols: number, texts: [number, number, string, object?][]): SheetDoc {
  const d = emptyDoc(rows, cols);
  for (const [r, c, t, s] of texts) d.cells[cellKey(r, c)] = { t, ...(s ? { s } : {}) };
  return d;
}

describe("열 크기 맞추기", () => {
  it("그 열에서 가장 긴 줄 + 칸 안 여백 · 줄바꿈 칸은 줄마다 잰다", () => {
    const d = withTexts(3, 2, [[0, 0, "김지우A(달성초2)"], [1, 0, "짧음"], [2, 0, "가\n가나다라마바사아자차카"]]);
    const fit = autoFitLines(d, "col", [0], measure);
    expect(fit.colW[0]).toBe(11 * 7 + 10);
    expect(fit.colW[1]).toBe(d.colW[1]);
  });

  it("굵은 글자는 더 넓게 · 여러 열에 걸친 병합은 빼고 센다", () => {
    const d = withTexts(2, 3, [[0, 0, "가나다", { b: true }], [1, 0, "8월 퇴원생 명단 아주 긴 제목"]]);
    d.merges = [{ r: 1, c: 0, rs: 1, cs: 3 }];
    expect(autoFitLines(d, "col", [0], measure).colW[0]).toBe(3 * 8 + 10);
  });

  it("빈 열은 기본 폭으로 돌아가고, 이미 맞으면 문서를 그대로 돌려준다", () => {
    const d = { ...emptyDoc(2, 2), colW: [30, DEFAULT_COL_W] };
    const fit = autoFitLines(d, "col", [0, 1], measure);
    expect(fit.colW).toEqual([DEFAULT_COL_W, DEFAULT_COL_W]);
    expect(autoFitLines(fit, "col", [0, 1], measure)).toBe(fit);
  });
});

describe("행 크기 맞추기", () => {
  it("한 줄 칸은 글자 크기 한 줄, 줄을 나눈 칸은 줄 수만큼", () => {
    const d = withTexts(2, 2, [[0, 0, "가"], [1, 0, "가\n나\n다"]]);
    const fit = autoFitLines(d, "row", [0, 1], measure);
    expect(fit.rowH[0]).toBe(21);
    expect(fit.rowH[1]).toBe(Math.ceil(3 * (40 / 3) * 1.15 + 5));
  });

  it("줄바꿈 칸은 칸 폭에서 접어 센다 · 큰 글자는 더 높게", () => {
    const d = withTexts(1, 1, [[0, 0, "학원업 하는 어머니가 영어도 직접 가르치고 싶어함", { wr: "wrap", fs: 12 }]]);
    d.colW = [100];
    const lines = wrappedLineCount(d.cells["0,0"]!.t!, 94, d.cells["0,0"]!.s, measure);
    expect(lines).toBeGreaterThan(2);
    expect(autoFitLines(d, "row", [0], measure).rowH[0]).toBe(Math.ceil(lines * 16 * 1.15 + 5));
  });

  it("병합 속(덮인 칸)에 남은 글자는 세지 않는다", () => {
    // (0,1)~(1,1) 세로 병합 — 왼쪽 위 칸 (0,1)은 짧고, 덮인 칸 (1,1)에 안 보이는 긴 글자가 남아 있다.
    const d = { ...withTexts(2, 2, [[0, 1, "가나"], [1, 1, "안 보이는 아주 긴 글자 덩어리"]]), colW: [80, 30] };
    d.merges = [{ r: 0, c: 1, rs: 2, cs: 1 }];
    expect(autoFitLines(d, "col", [1], measure).colW[1]).toBe(2 * 7 + 10);
  });

  it("칸보다 긴 한 낱말은 글자 단위로 잘라 센다", () => {
    expect(wrappedLineCount("가".repeat(30), 70, undefined, measure)).toBe(3);
    expect(wrappedLineCount("", 70, undefined, measure)).toBe(1);
  });
});

describe("경계를 누른 줄", () => {
  it("열을 통째로 여럿 고른 채 그 안의 경계면 고른 열 전부, 아니면 그 열만", () => {
    const doc = emptyDoc(10, 6);
    expect(headerLinesAt(doc, { r0: 0, c0: 1, r1: 9, c1: 3 }, "col", 2)).toEqual([1, 2, 3]);
    expect(headerLinesAt(doc, { r0: 0, c0: 1, r1: 9, c1: 3 }, "col", 5)).toEqual([5]);
    expect(headerLinesAt(doc, { r0: 2, c0: 1, r1: 4, c1: 3 }, "col", 2)).toEqual([2]);
  });
});
