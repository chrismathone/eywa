import { DEFAULT_FONT_PT, type CellStyle } from "../doc";
import { fontStack } from "../style-css";

/**
 * 글자 폭(px) — 크기 맞추기(autofit.ts)가 쓴다. 글자 층과 같은 글꼴·크기·굵기·기울임으로 canvas에서 잰다.
 * canvas를 못 얻는 환경이면 글자 수로 어림한다(맞추기가 아예 안 되는 것보단 낫다).
 */
let ctx: CanvasRenderingContext2D | null | undefined;

export function measureText(text: string, s: CellStyle | undefined): number {
  if (ctx === undefined) ctx = document.createElement("canvas").getContext("2d");
  const pt = s?.fs ?? DEFAULT_FONT_PT;
  if (!ctx) return text.length * ((pt * 4) / 3) * 0.6;
  ctx.font = `${s?.i ? "italic " : ""}${s?.b ? "700 " : "400 "}${pt}pt ${fontStack(s?.ff)}`;
  // 탭은 canvas가 거의 0으로 재지만 화면은 띄어쓰기 8칸(CSS 기본 tab-size)만큼 민다.
  return ctx.measureText(text.replace(/\t/g, " ".repeat(8))).width;
}
