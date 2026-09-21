import { describe, expect, it } from "vitest";
import { MP_SHEET_GEOM } from "./month-plan-sheet-style";
import {
  MP_PRINT_MARGIN_MM,
  mpPrintArea,
  mpPrintFit,
  mpPrintFitCaption,
  mpPrintPageCss,
} from "./month-plan-print-fit";

/**
 * 원장 2026-09-21 *"인쇄도 한페이지에 딱 들어오게 맞춰 A4"* — 줄인 문서가 **실제로 한 장 안**인지를 숫자로 잠근다.
 * 문서 크기는 시트 격자(`MP_SHEET_GEOM`)에서 그대로 만든다: 머리 140 + Day 20 + 주마다(Date 20 + 라벨 20 + 값 140)
 * + 꼬리말(두 줄 ≈ 72) + 바깥 테두리 6.
 */
const docOf = (dataCols: number, weeks: number, footer = 72) => ({
  width: MP_SHEET_GEOM.col * (1 + dataCols) + 6,
  height:
    MP_SHEET_GEOM.row * 7 +
    MP_SHEET_GEOM.row +
    weeks * (MP_SHEET_GEOM.row * 2 + MP_SHEET_GEOM.row * MP_SHEET_GEOM.valueRows) +
    footer +
    6,
});

const fitsOnePage = (doc: { width: number; height: number }) => {
  const fit = mpPrintFit(doc);
  const area = mpPrintArea(fit.orientation);
  return doc.width * fit.zoom <= area.width && doc.height * fit.zoom <= area.height;
};

describe("🔴 줄인 문서는 언제나 A4 한 장 안이다", () => {
  it.each([
    ["주 5일 · 5주(스크린샷 PL1a)", docOf(15, 5)],
    ["주 5일 · e-book 4열 · 6주", docOf(20, 6)],
    ["주 3일 · 5주(EiE 대다수)", docOf(9, 5)],
    ["주 2일 · 4주", docOf(6, 4)],
    ["주 3일 · 6주 · 꼬리말 긴 반", docOf(9, 6, 200)],
  ])("%s", (_, doc) => {
    expect(fitsOnePage(doc)).toBe(true);
  });
});

describe("방향은 더 크게 찍히는 쪽", () => {
  it("주 5일 반은 가로(폭이 넓다)", () => {
    expect(mpPrintFit(docOf(15, 5)).orientation).toBe("landscape");
  });

  it("주 3일 반은 세로 — 가로로 두면 필요 이상으로 작아진다", () => {
    const fit = mpPrintFit(docOf(9, 5));
    expect(fit.orientation).toBe("portrait");
    // 가로였다면 약 0.63 — 세로가 확실히 크다.
    expect(fit.zoom).toBeGreaterThan(0.85);
  });
});

describe("경계", () => {
  it("⚠️ 키우지는 않는다(최대 100% × 여유)", () => {
    expect(mpPrintFit({ width: 300, height: 200 }).zoom).toBeLessThanOrEqual(1);
  });

  it("아직 안 그려진 문서(0)는 손대지 않는다", () => {
    expect(mpPrintFit({ width: 0, height: 0 })).toEqual({ zoom: 1, orientation: "landscape" });
    expect(mpPrintFit({ width: Number.NaN, height: 10 })).toEqual({ zoom: 1, orientation: "landscape" });
  });

  it("@page는 고른 방향과 같은 여백 하나를 선언한다", () => {
    expect(mpPrintPageCss("portrait")).toBe(`@page { size: A4 portrait; margin: ${MP_PRINT_MARGIN_MM}mm; }`);
  });

  it("미리보기 문구는 방향과 배율을 말한다", () => {
    expect(mpPrintFitCaption({ zoom: 0.634, orientation: "landscape" })).toBe("A4 가로 한 장에 맞춤 · 63%");
    expect(mpPrintFitCaption({ zoom: 0.9, orientation: "portrait" })).toBe("A4 세로 한 장에 맞춤 · 90%");
  });
});
