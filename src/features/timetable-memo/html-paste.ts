import type { BorderLine, CellStyle, LineStyle } from "./doc";
import { sanitizeBlock, type Block } from "./clipboard";

/**
 * 바깥 표(구글 시트·엑셀·웹 표)를 붙여 넣을 때 **칸의 인라인 서식**을 읽는다 — 배경·글자색·굵기·기울임·
 * 밑줄·취소선·크기·글꼴·정렬·줄바꿈·테두리·병합(rowspan/colspan). 구글 시트는 서식을 칸마다 인라인으로 싣는다.
 * ⚠️ 엑셀은 서식을 `<style>`의 클래스로 싣는다 — 그건 읽지 않는다(글자는 그대로 붙는다).
 * 브라우저 전용(DOMParser) — 붙여넣기 이벤트에서만 부른다.
 */

/** `#abc`·`#aabbcc`·`rgb(…)`·`rgba(…)` → `#rrggbb`. 투명·모르는 값은 undefined. */
export function cssColorToHex(v: string | null | undefined): string | undefined {
  const s = (v ?? "").trim().toLowerCase();
  if (!s || s === "transparent" || s === "inherit" || s === "initial") return undefined;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (!rgb) return undefined;
  if (rgb[4] !== undefined && parseFloat(rgb[4]) === 0) return undefined;
  return `#${[rgb[1], rgb[2], rgb[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, "0")).join("")}`;
}

function parseBorder(v: string): BorderLine | undefined {
  const s = v.trim().toLowerCase();
  if (!s || s.startsWith("none") || s.startsWith("hidden") || s === "0" || s.startsWith("0px")) return undefined;
  const width = /([\d.]+)px/.exec(s);
  const px = width ? parseFloat(width[1]!) : 1;
  if (px <= 0) return undefined;
  const style = (["double", "dashed", "dotted", "solid"] as LineStyle[]).find((x) => s.includes(x)) ?? "solid";
  const colorMatch = /(#[0-9a-f]{3,6}|rgba?\([^)]*\))/.exec(s);
  const c = cssColorToHex(colorMatch?.[1]) ?? "#000000";
  return { w: px >= 3 ? 3 : px >= 2 ? 2 : 1, c, s: style };
}

function fontPt(v: string): number | undefined {
  const m = /([\d.]+)\s*(pt|px)/.exec(v);
  if (!m) return undefined;
  const n = parseFloat(m[1]!);
  return Math.round(m[2] === "px" ? n * 0.75 : n);
}

export function styleFromCss(st: CSSStyleDeclaration): CellStyle | undefined {
  const s: CellStyle = {};
  const bg = cssColorToHex(st.backgroundColor);
  if (bg && bg !== "#ffffff") s.bg = bg;
  const fc = cssColorToHex(st.color);
  if (fc && fc !== "#000000") s.fc = fc;
  const w = st.fontWeight;
  if (w === "bold" || w === "bolder" || Number(w) >= 600) s.b = true;
  if (st.fontStyle === "italic") s.i = true;
  const deco = `${st.textDecoration} ${st.textDecorationLine}`;
  if (deco.includes("underline")) s.u = true;
  if (deco.includes("line-through")) s.st = true;
  const fs = fontPt(st.fontSize);
  if (fs) s.fs = fs;
  const ff = st.fontFamily.split(",")[0]?.replace(/["']/g, "").trim();
  if (ff && /^[\p{L}\p{N} _-]+$/u.test(ff)) s.ff = ff;
  const ta = st.textAlign;
  if (ta === "center" || ta === "right" || ta === "left") s.ha = ta;
  const va = st.verticalAlign;
  if (va === "top") s.va = "top";
  else if (va === "middle") s.va = "middle";
  if (st.whiteSpace === "normal" || st.whiteSpace === "pre-wrap") s.wr = "wrap";
  const bd: NonNullable<CellStyle["bd"]> = {};
  const sides = { t: st.borderTop, r: st.borderRight, b: st.borderBottom, l: st.borderLeft };
  for (const [k, v] of Object.entries(sides) as [keyof typeof sides, string][]) {
    const line = v ? parseBorder(v) : undefined;
    if (line) bd[k] = line;
  }
  if (Object.keys(bd).length) s.bd = bd;
  return Object.keys(s).length ? s : undefined;
}

function cellText(td: Element): string {
  const clone = td.cloneNode(true) as Element;
  clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  return (clone.textContent ?? "").replace(/ /g, " ").replace(/\n+$/, "");
}

/** 바깥 HTML의 첫 표 → 덩어리(서식·병합 포함). 표가 없으면 null(글자 붙여넣기로). */
export function blockFromHtmlTable(html: string): Block | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = doc.querySelector("table");
  if (!table) return null;
  const grid: ({ t?: string; s?: CellStyle } | null)[][] = [];
  const merges: { r: number; c: number; rs: number; cs: number }[] = [];
  const taken = new Set<string>();
  Array.from(table.querySelectorAll("tr")).forEach((tr, r) => {
    grid[r] ??= [];
    let c = 0;
    for (const td of Array.from(tr.children).filter((x) => x.tagName === "TD" || x.tagName === "TH")) {
      while (taken.has(`${r},${c}`)) c++;
      const rs = Math.max(1, Number(td.getAttribute("rowspan")) || 1);
      const cs = Math.max(1, Number(td.getAttribute("colspan")) || 1);
      const text = cellText(td);
      const style = styleFromCss((td as HTMLElement).style);
      grid[r]![c] = text || style ? { t: text || undefined, s: style } : null;
      for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) taken.add(`${r + i},${c + j}`);
      if (rs * cs > 1) merges.push({ r, c, rs, cs });
      c += cs;
    }
  });
  const rows = Math.max(grid.length, ...merges.map((m) => m.r + m.rs));
  const cols = Math.max(1, ...grid.map((row) => row.length), ...merges.map((m) => m.c + m.cs));
  if (!rows) return null;
  const cells = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => grid[i]?.[j] ?? null));
  return sanitizeBlock({ rows, cols, cells, merges });
}
