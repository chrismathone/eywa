import { describe, expect, it } from "vitest";
import { MP_SHEET_GEOM } from "./month-plan-sheet-style";
import {
  MP_PRINT_MARGIN_MM,
  mpPrintArea,
  mpPrintFit,
  mpPrintFitCaption,
  mpPrintPageCss,
  mpPrintValueHeight,
} from "./month-plan-print-fit";

/**
 * 원장 2026-09-21 *"인쇄도 한페이지에 딱 들어오게 맞춰 A4"* → *"세로 사이즈에 맞도록 비율 조정"* —
 * 줄인 문서가 **세로 A4 한 장 안**이고 **세로를 꽉 채우는지**를 숫자로 잠근다.
 * 문서 크기는 시트 격자(`MP_SHEET_GEOM`)에서 그대로 만든다: 머리 140 + Day 20 + 주마다(Date 20 + 라벨 20 + 값)
 * + 꼬리말(두 줄 ≈ 72) + 바깥 테두리 6.
 */
const BASE = MP_SHEET_GEOM.row * MP_SHEET_GEOM.valueRows; // 140
const docOf = (dataCols: number, weeks: number, valuePx = BASE, footer = 72) => ({
  width: MP_SHEET_GEOM.col * (1 + dataCols) + 6,
  height: MP_SHEET_GEOM.row * 8 + weeks * (MP_SHEET_GEOM.row * 2 + valuePx) + footer + 6,
});

/** 맞춤 결과를 실제로 적용한 문서(값 칸을 늘린 뒤 배율을 곱한 크기). */
function applied(dataCols: number, weeks: number, footer = 72) {
  const fit = mpPrintFit(docOf(dataCols, weeks, BASE, footer), { valueRows: weeks, basePx: BASE });
  const doc = docOf(dataCols, weeks, fit.valuePx, footer);
  return { fit, w: doc.width * fit.zoom, h: doc.height * fit.zoom };
}

const CASES: [string, number, number, number?][] = [
  ["주 5일 · 5주(원장 캡처 PL1a)", 15, 5],
  ["주 5일 · e-book 4열 · 6주", 20, 6],
  ["주 3일 · 5주(EiE 대다수)", 9, 5],
  ["주 3일 + e-book 한 요일(LE1)", 10, 5],
  ["주 2일 · 4주", 6, 4],
  ["주 3일 · 6주 · 꼬리말 긴 반", 9, 6, 200],
];

describe("🔴 세로 A4 한 장 안에 들어간다", () => {
  it.each(CASES)("%s", (_, cols, weeks, footer) => {
    const { w, h } = applied(cols, weeks, footer);
    const area = mpPrintArea();
    expect(w).toBeLessThanOrEqual(area.width);
    expect(h).toBeLessThanOrEqual(area.height);
  });
});

describe("🔑 세로를 꽉 채운다 — 남는 높이는 값 칸이 나눠 갖는다", () => {
  it.each(CASES)("%s — 종이 세로의 96% 이상", (_, cols, weeks, footer) => {
    const { h } = applied(cols, weeks, footer);
    expect(h / mpPrintArea().height).toBeGreaterThanOrEqual(0.96);
  });

  it("주 5일 반은 폭에 맞춰 줄이고 값 칸이 크게 늘어난다(아래가 비지 않는다)", () => {
    const { fit } = applied(15, 5);
    expect(fit.zoom).toBeLessThan(0.6);
    expect(fit.valuePx).toBeGreaterThan(BASE * 1.5);
  });

  it("🔴 칸은 줄이지 않는다 — 이미 세로가 넘치는 문서는 배율로만 줄인다(값 칸은 기본 이상)", () => {
    const tall = { width: 400, height: 3000 };
    const fit = mpPrintFit(tall, { valueRows: 6, basePx: BASE });
    // 배율 내림 몫으로 1~2px 늘 수는 있어도 기본보다 작아지는 일은 없다.
    expect(fit.valuePx).toBeGreaterThanOrEqual(BASE);
    expect(fit.valuePx - BASE).toBeLessThan(3);
    const after = tall.height + 6 * (fit.valuePx - BASE);
    expect(after * fit.zoom).toBeLessThanOrEqual(mpPrintArea().height);
  });
});

describe("경계", () => {
  it("⚠️ 키우지는 않는다(배율 최대 100% × 여유) — 남는 높이는 칸이 먹는다", () => {
    const fit = mpPrintFit({ width: 300, height: 200 }, { valueRows: 2, basePx: BASE });
    expect(fit.zoom).toBeLessThanOrEqual(1);
    expect(fit.valuePx).toBeGreaterThan(BASE);
  });

  it("아직 안 그려진 문서(0)는 손대지 않는다", () => {
    expect(mpPrintFit({ width: 0, height: 0 }, { valueRows: 5, basePx: BASE })).toEqual({ zoom: 1, valuePx: BASE });
    expect(mpPrintFit({ width: Number.NaN, height: 10 }, { valueRows: 5, basePx: BASE })).toEqual({
      zoom: 1,
      valuePx: BASE,
    });
  });

  it("값 칸 줄이 없으면 높이를 나눌 곳이 없다(배율만)", () => {
    expect(mpPrintFit(docOf(9, 5), { valueRows: 0, basePx: BASE }).valuePx).toBe(BASE);
  });

  it("@page는 세로 A4 하나만 선언한다", () => {
    expect(mpPrintPageCss()).toBe(`@page { size: A4 portrait; margin: ${MP_PRINT_MARGIN_MM}mm; }`);
  });

  it("값 칸 높이는 변수 → 없으면 시트 기본값", () => {
    expect(mpPrintValueHeight("140px")).toBe("var(--mp-value-h, 140px)");
  });

  it("미리보기 문구는 배율을 말한다", () => {
    expect(mpPrintFitCaption({ zoom: 0.551, valuePx: 290 })).toBe("A4 세로 한 장에 맞춤 · 55%");
  });
});
