import { describe, expect, it } from "vitest";
import { cellKey, emptyDoc, type SheetDoc } from "./doc";
import { liftMergeBorders } from "./merge-borders";
import { blockToHtml, copyBlock } from "./clipboard";
import { applyBorders, mergeCells } from "./ops";
import { deleteLines, insertLines } from "./ops-struct";
import { packSheet, unpackSheet } from "./pack";

const black = { w: 1 as const, c: "#000000", s: "solid" as const };
const red = { w: 2 as const, c: "#ff0000", s: "solid" as const };
const bdOf = (d: SheetDoc, r: number, c: number) => d.cells[cellKey(r, c)]?.s?.bd;

/** 구글 시트가 보내는 모양 — 2×3 병합의 네 변이 왼쪽 위 칸에만 있다. */
function googleShaped(): SheetDoc {
  const d = emptyDoc(4, 4);
  return {
    ...d,
    cells: { [cellKey(0, 0)]: { t: "조희연(12)", s: { bd: { t: black, r: black, b: black, l: black } } } },
    merges: [{ r: 0, c: 0, rs: 2, cs: 3 }],
  };
}

describe("병합 테두리 나눠 적기", () => {
  it("왼쪽 위 칸의 네 변이 덩어리 가장자리 칸마다 서고, 안쪽 변은 왼쪽 위 칸에서 빠진다", () => {
    const d = liftMergeBorders(googleShaped());
    expect(bdOf(d, 0, 0)).toEqual({ t: black, l: black });
    expect(bdOf(d, 0, 2)).toEqual({ t: black, r: black });
    expect(bdOf(d, 1, 0)).toEqual({ l: black, b: black });
    expect(bdOf(d, 1, 1)).toEqual({ b: black });
    expect(bdOf(d, 1, 2)).toEqual({ r: black, b: black });
    expect(bdOf(d, 0, 1)).toEqual({ t: black });
    expect(d.cells[cellKey(0, 0)]?.t).toBe("조희연(12)");
  });

  it("두 번 돌려도 같고, 바뀔 것이 없으면 받은 문서를 그대로 돌려준다", () => {
    const once = liftMergeBorders(googleShaped());
    expect(liftMergeBorders(once)).toBe(once);
    const plain = emptyDoc(2, 2);
    expect(liftMergeBorders(plain)).toBe(plain);
  });

  it("가장자리 칸에 이미 자기 선이 있으면 그 선이 이긴다", () => {
    const g = googleShaped();
    g.cells[cellKey(1, 2)] = { s: { bd: { b: red } } };
    const d = liftMergeBorders(g);
    expect(bdOf(d, 1, 2)?.b).toEqual(red);
    expect(bdOf(d, 1, 1)?.b).toEqual(black);
  });

  it("한 줄 병합은 왼쪽 위 칸이 아래 줄이기도 해서 아래 변을 지우지 않는다", () => {
    const d = liftMergeBorders({
      ...emptyDoc(2, 3),
      cells: { [cellKey(0, 0)]: { s: { bd: { b: black, r: black } } } },
      merges: [{ r: 0, c: 0, rs: 1, cs: 3 }],
    });
    expect(bdOf(d, 0, 0)).toEqual({ b: black });
    expect(bdOf(d, 0, 1)).toEqual({ b: black });
    expect(bdOf(d, 0, 2)).toEqual({ b: black, r: black });
  });

  it("표식(mb) 없는 옛 저장본은 펼칠 때 나눠 적는다(구글에서 옮긴 침산 판이 그대로 맞게 그려진다)", () => {
    const { mb, ...legacy } = packSheet(googleShaped());
    expect(mb).toBe(1);
    const d = unpackSheet(legacy, 80, 25);
    expect(bdOf(d, 1, 1)).toEqual({ b: black });
    expect(bdOf(d, 0, 0)?.b).toBeUndefined();
  });

  it("새 저장본(mb=1)은 다시 나누지 않는다 — 작은 병합에서 덮인 칸 선을 다 지워도 되살아나지 않는다(재리뷰 B1)", () => {
    let d = mergeCells(emptyDoc(3, 3), { r0: 1, c0: 0, r1: 1, c1: 1 });
    d = applyBorders(d, { r0: 1, c0: 0, r1: 1, c1: 1 }, "top", red);
    d = applyBorders(d, { r0: 0, c0: 1, r1: 0, c1: 1 }, "none", black);
    expect(bdOf(d, 1, 1)?.t).toBeUndefined();
    const reopened = unpackSheet(packSheet(d), 80, 25);
    expect(bdOf(reopened, 1, 1)?.t).toBeUndefined();
    expect(bdOf(reopened, 1, 0)?.t).toEqual(red);
  });
});

describe("병합 칸에 테두리 넣기", () => {
  it("안쪽 선은 병합 덩어리 속에 적지 않는다 — 덩어리 바깥 변만", () => {
    const merged = mergeCells(emptyDoc(3, 3), { r0: 0, c0: 0, r1: 1, c1: 1 });
    const d = applyBorders(merged, { r0: 0, c0: 0, r1: 1, c1: 1 }, "all", black);
    expect(bdOf(d, 0, 0)).toEqual({ t: black, l: black });
    expect(bdOf(d, 1, 1)).toEqual({ r: black, b: black });
    const inner = applyBorders(merged, { r0: 0, c0: 0, r1: 1, c1: 1 }, "inner", black);
    expect(Object.values(inner.cells).some((c) => c.s?.bd)).toBe(false);
  });

  it("병합 일부만 골라도 덩어리 전체 바깥에 선다", () => {
    const merged = mergeCells(emptyDoc(3, 3), { r0: 0, c0: 0, r1: 1, c1: 1 });
    const d = applyBorders(merged, { r0: 0, c0: 0, r1: 0, c1: 0 }, "outer", red);
    expect(bdOf(d, 1, 0)).toEqual({ l: red, b: red });
    expect(bdOf(d, 0, 1)).toEqual({ t: red, r: red });
  });

  it("병합하면 왼쪽 위 칸의 테두리가 덩어리 전체 테두리가 된다", () => {
    const boxed = applyBorders(emptyDoc(3, 3), { r0: 0, c0: 0, r1: 0, c1: 0 }, "outer", black);
    const d = mergeCells(boxed, { r0: 0, c0: 0, r1: 1, c1: 1 });
    expect(bdOf(d, 0, 0)).toEqual({ t: black, l: black });
    expect(bdOf(d, 1, 1)).toEqual({ r: black, b: black });
  });
});

describe("나눠 적기는 한 번만 — 사용자가 고친 선을 되살리지 않는다(리뷰 2026-10-19)", () => {
  /** (0,1)~(2,2) 병합에 상자 테두리를 건 판. */
  const boxed = () => applyBorders(mergeCells(emptyDoc(4, 4), { r0: 0, c0: 1, r1: 2, c1: 2 }), { r0: 0, c0: 1, r1: 2, c1: 2 }, "outer", black);

  it("왼쪽 이웃에서 다른 색 선을 걸면, 다시 열거나 다른 데를 병합해도 병합 쪽 검은 선이 돌아오지 않는다", () => {
    const d = applyBorders(boxed(), { r0: 1, c0: 0, r1: 1, c1: 0 }, "right", red);
    expect(bdOf(d, 1, 1)?.l).toBeUndefined();
    const reopened = unpackSheet(packSheet(d), 80, 25);
    expect(bdOf(reopened, 1, 1)?.l).toBeUndefined();
    expect(bdOf(reopened, 1, 0)?.r).toEqual(red);
    const mergedElsewhere = mergeCells(reopened, { r0: 3, c0: 0, r1: 3, c1: 1 });
    expect(bdOf(mergedElsewhere, 1, 1)?.l).toBeUndefined();
  });

  it("이웃에 '테두리 없음'으로 지운 선도 다시 열면 그대로 지워져 있다", () => {
    // 이웃 (1,0)에 '없음' = 그 칸 네 변 + 바깥 이웃의 마주 보는 변을 지운다 → 병합의 (1,1) 왼쪽 선이 지워진다.
    const d = applyBorders(boxed(), { r0: 1, c0: 0, r1: 1, c1: 0 }, "none", black);
    expect(bdOf(d, 1, 1)?.l).toBeUndefined();
    const reopened = unpackSheet(packSheet(d), 80, 25);
    expect(bdOf(reopened, 1, 1)?.l).toBeUndefined();
    expect(bdOf(reopened, 0, 1)?.l).toEqual(black);
    expect(bdOf(reopened, 2, 1)?.l).toEqual(black);
  });

  it("병합할 때 바깥 이웃이 마주 보는 선을 들고 있으면 겹쳐 적지 않는다", () => {
    let d = applyBorders(emptyDoc(2, 4), { r0: 0, c0: 3, r1: 0, c1: 3 }, "left", red);
    d = applyBorders(d, { r0: 0, c0: 1, r1: 0, c1: 1 }, "outer", black);
    // (0,1)의 오른쪽 검은 선은 (0,2)와 맞닿은 안쪽 선이 되고, 덩어리 오른쪽 변엔 이웃 (0,3)의 빨간 선이 이미 있다.
    const m = mergeCells(d, { r0: 0, c0: 1, r1: 0, c1: 2 });
    expect(bdOf(m, 0, 2)?.r).toBeUndefined();
    expect(bdOf(m, 0, 3)?.l).toEqual(red);
  });
});

describe("판 밖 복사와 줄 넣기·지우기", () => {
  it("병합 칸을 엑셀·구글 시트로 복사하면 네 변이 모두 실린다", () => {
    const d = liftMergeBorders(googleShaped());
    const html = blockToHtml(copyBlock(d, { r0: 0, c0: 0, r1: 1, c1: 2 }));
    const td = /<td rowspan="2" colspan="3" style="([^"]*)"/.exec(html)?.[1] ?? "";
    for (const side of ["top", "right", "bottom", "left"]) expect(td).toContain(`border-${side}:1px solid #000000`);
  });

  it("병합 속에 행을 넣어도 왼쪽·오른쪽 선이 이어지고, 끝 행을 지우면 아래 선이 새 끝 행으로 온다", () => {
    const d = liftMergeBorders(googleShaped());
    const grown = insertLines(d, "row", 1, 1);
    expect(bdOf(grown, 1, 0)?.l).toEqual(black);
    expect(bdOf(grown, 1, 2)?.r).toEqual(black);
    const shrunk = deleteLines(d, "row", 1, 1);
    expect(shrunk.merges).toEqual([{ r: 0, c: 0, rs: 1, cs: 3 }]);
    for (const c of [0, 1, 2]) expect(bdOf(shrunk, 0, c)?.b).toEqual(black);
  });
});
