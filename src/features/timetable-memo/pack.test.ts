import { describe, expect, it } from "vitest";
import { blockFromAywaHtml, blockToHtml, blockToTsv, copyBlock, parseTsv, pasteBlock, textBlock } from "./clipboard";
import { cellKey, emptyDoc } from "./doc";
import { docFromGoogle, styleFromGoogle } from "./google";
import { blockFromHtmlTable, cssColorToHex } from "./html-paste";
import { mergeCells, patchStyle, setTexts } from "./ops";
import { packSheet, packedSheetSchema, parsePackedSheet, sanitizeStyle } from "./pack";

describe("저장 모양(pack)", () => {
  it("같은 서식은 한 번만 적고, 펼치면 그대로 돌아온다", () => {
    let d = setTexts(emptyDoc(4, 4), [{ r: 0, c: 0, t: "가" }, { r: 1, c: 1, t: "나" }]);
    d = patchStyle(d, { r0: 0, c0: 0, r1: 1, c1: 1 }, { bg: "#d9ead3", b: true });
    d = mergeCells(d, { r0: 2, c0: 0, r1: 3, c1: 1 });
    const p = packSheet(d);
    expect(p.styles).toHaveLength(1);
    expect(packedSheetSchema.safeParse(p).success).toBe(true);
    expect(parsePackedSheet(JSON.parse(JSON.stringify(p)), 80, 25)).toEqual(d);
  });
  it("틀린 값은 거절하고(색·글꼴 이름), 바깥 서식은 맞는 키만 남긴다", () => {
    const p = packSheet(patchStyle(emptyDoc(1, 1), { r0: 0, c0: 0, r1: 0, c1: 0 }, { bg: "#d9ead3" }));
    expect(packedSheetSchema.safeParse({ ...p, styles: [{ bg: "red" }] }).success).toBe(false);
    expect(packedSheetSchema.safeParse({ ...p, styles: [{ ff: 'Arial"; color:red' }] }).success).toBe(false);
    expect(sanitizeStyle({ bg: "red", fc: "#112233", b: true, bd: { t: { w: 1, c: "#000000", s: "solid" }, r: { w: 9 } }, x: 1 })).toEqual({
      fc: "#112233",
      b: true,
      bd: { t: { w: 1, c: "#000000", s: "solid" } },
    });
  });
  it("겹치는 병합·판 밖 칸은 펼칠 때 버린다", () => {
    const raw = { v: 1, rows: 2, cols: 2, colW: [80, 80], rowH: [25, 25], styles: [], cells: [[5, 5, "밖", -1]], merges: [[0, 0, 2, 1], [0, 0, 1, 2]] };
    const d = parsePackedSheet(raw, 80, 25)!;
    expect(d.cells).toEqual({});
    expect(d.merges).toEqual([{ r: 0, c: 0, rs: 2, cs: 1 }]);
  });
});

describe("복사·붙여넣기", () => {
  it("TSV 왕복 — 탭·줄바꿈·따옴표가 든 칸", () => {
    const d = setTexts(emptyDoc(2, 2), [{ r: 0, c: 0, t: '줄\n바꿈' }, { r: 0, c: 1, t: '"따옴"' }, { r: 1, c: 0, t: "a\tb" }]);
    const tsv = blockToTsv(copyBlock(d, { r0: 0, c0: 0, r1: 1, c1: 1 }));
    expect(parseTsv(tsv)).toEqual([["줄\n바꿈", '"따옴"'], ["a\tb", ""]]);
  });
  it("판끼리 복사는 서식·병합까지 · 판이 모자라면 키운다", () => {
    let d = setTexts(emptyDoc(3, 3), [{ r: 0, c: 0, t: "명단" }]);
    d = patchStyle(mergeCells(d, { r0: 0, c0: 0, r1: 0, c1: 1 }), { r0: 0, c0: 0, r1: 0, c1: 1 }, { bg: "#00ff00" });
    const block = blockFromAywaHtml(blockToHtml(copyBlock(d, { r0: 0, c0: 0, r1: 0, c1: 1 })))!;
    const out = pasteBlock(d, { r: 2, c: 2 }, block, true);
    expect(out.doc.cols).toBe(4);
    expect(out.doc.cells[cellKey(2, 2)]).toEqual({ t: "명단", s: { bg: "#00ff00" } });
    expect(out.doc.merges).toContainEqual({ r: 2, c: 2, rs: 1, cs: 2 });
  });
  it("글자만 붙이면 대상 칸 서식은 그대로", () => {
    const d = patchStyle(emptyDoc(2, 2), { r0: 0, c0: 0, r1: 0, c1: 0 }, { bg: "#ffff00" });
    const out = pasteBlock(d, { r: 0, c: 0 }, textBlock([["새 글"]]), false);
    expect(out.doc.cells[cellKey(0, 0)]).toEqual({ t: "새 글", s: { bg: "#ffff00" } });
  });
  it("바깥(구글 시트) 표 HTML의 인라인 서식·병합을 읽는다", () => {
    const html =
      '<table><tbody><tr><td colspan="2" style="background-color:#00ff00;font-weight:bold;text-align:center;border-bottom:1px solid #000000">8월 퇴원생 명단</td></tr>' +
      '<tr><td style="color:rgb(255, 0, 0);text-decoration:line-through">현가현<br>(종로초4)</td><td>이사</td></tr></tbody></table>';
    const b = blockFromHtmlTable(html)!;
    expect(b.merges).toEqual([{ r: 0, c: 0, rs: 1, cs: 2 }]);
    expect(b.cells[0]![0]).toEqual({ t: "8월 퇴원생 명단", s: { bg: "#00ff00", b: true, ha: "center", bd: { b: { w: 1, c: "#000000", s: "solid" } } } });
    expect(b.cells[1]![0]).toEqual({ t: "현가현\n(종로초4)", s: { fc: "#ff0000", st: true } });
    expect(cssColorToHex("rgba(0, 0, 0, 0)")).toBeUndefined();
  });
});

describe("구글 시트 구역 → 판", () => {
  const cell = (v: string, f: Record<string, unknown> = {}) => ({ formattedValue: v, effectiveFormat: f });
  it("서식·병합·크기를 옮기고 구역을 걸친 병합은 버린다", () => {
    const grid = {
      columnMetadata: [{ pixelSize: 36 }, { pixelSize: 70 }],
      rowMetadata: [{ pixelSize: 25 }, { pixelSize: 40 }],
      rowData: [
        { values: [cell("8월 퇴원생 명단", { backgroundColor: { green: 1 }, textFormat: { bold: true }, horizontalAlignment: "CENTER" }), cell("")] },
        { values: [{ formattedValue: "1", userEnteredValue: { numberValue: 1 }, effectiveFormat: { verticalAlignment: "MIDDLE" } }, cell("타학원 이동", { wrapStrategy: "WRAP", textFormat: { strikethrough: true, fontSize: 8 } })] },
      ],
    };
    const merges = [
      { startRowIndex: 4, endRowIndex: 5, startColumnIndex: 69, endColumnIndex: 71 },
      { startRowIndex: 5, endRowIndex: 7, startColumnIndex: 70, endColumnIndex: 71 },
    ];
    const d = docFromGoogle(grid, merges, { row0: 4, col0: 69, rows: 2, cols: 2 });
    expect(d.colW).toEqual([36, 70]);
    expect(d.rowH).toEqual([25, 40]);
    expect(d.merges).toEqual([{ r: 0, c: 0, rs: 1, cs: 2 }]);
    expect(d.cells[cellKey(0, 0)]).toEqual({ t: "8월 퇴원생 명단", s: { bg: "#00ff00", b: true, ha: "center" } });
    expect(d.cells[cellKey(1, 0)]).toEqual({ t: "1", s: { ha: "right", va: "middle" } });
    expect(d.cells[cellKey(1, 1)]).toEqual({ t: "타학원 이동", s: { st: true, fs: 8, wr: "wrap" } });
  });
  it("검정 글자·흰 바탕·Arial 10은 기본값이라 적지 않는다", () => {
    expect(styleFromGoogle(cell("x", { backgroundColor: { red: 1, green: 1, blue: 1 }, textFormat: { foregroundColor: {}, fontFamily: "arial,sans,sans-serif", fontSize: 10 } }))).toBeUndefined();
    expect(styleFromGoogle(cell("x", { textFormat: { fontFamily: "Malgun Gothic" }, borders: { top: { style: "SOLID_MEDIUM", colorStyle: { rgbColor: {} } } } }))).toEqual({
      ff: "Malgun Gothic",
      bd: { t: { w: 2, c: "#000000", s: "solid" } },
    });
  });
});
