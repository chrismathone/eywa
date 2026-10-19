import type { CSSProperties } from "react";
import { DEFAULT_FONT, DEFAULT_FONT_PT, type BorderLine, type CellStyle } from "./doc";

/**
 * 칸 서식 → CSS 한 벌 — 화면(글자 층)과 복사 HTML이 같은 함수를 쓴다(붙여 넣은 곳과 화면이 다르게 보이지 않게).
 * 글꼴 크기는 **pt 그대로**(구글 시트·엑셀과 같은 단위 — 10pt = 13.3px). 한글은 글꼴에 없으면 브라우저 기본
 * 한글 글꼴로 떨어진다(구글 시트 화면과 같은 동작).
 */

/** 툴바 글꼴 목록 — 값은 CSS 글꼴 이름(저장값), 라벨은 화면 이름. */
export const FONT_CHOICES: readonly { value: string; label: string }[] = [
  { value: "Arial", label: "Arial" },
  { value: "Malgun Gothic", label: "맑은 고딕" },
  { value: "Gulim", label: "굴림" },
  { value: "Dotum", label: "돋움" },
  { value: "Batang", label: "바탕" },
  { value: "Gungsuh", label: "궁서" },
  { value: "Times New Roman", label: "Times New Roman" },
  { value: "Courier New", label: "Courier New" },
];

export const FONT_SIZES = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48] as const;

export function fontStack(ff: string | undefined): string {
  const name = (ff || DEFAULT_FONT).replace(/["\\]/g, "");
  return `"${name}", sans-serif`;
}

export function textDecoration(s: CellStyle | undefined): string | undefined {
  const parts = [s?.u ? "underline" : "", s?.st ? "line-through" : ""].filter(Boolean);
  return parts.length ? parts.join(" ") : undefined;
}

/** 글자 층 한 칸의 글꼴·색(배치·정렬은 그리는 쪽이 정한다). */
export function fontStyle(s: CellStyle | undefined): CSSProperties {
  return {
    fontFamily: fontStack(s?.ff),
    fontSize: `${s?.fs ?? DEFAULT_FONT_PT}pt`,
    fontWeight: s?.b ? 700 : 400,
    fontStyle: s?.i ? "italic" : "normal",
    textDecoration: textDecoration(s),
    color: s?.fc ?? "#000000",
  };
}

export function borderCss(line: BorderLine): string {
  return `${line.s === "double" ? 3 : line.w}px ${line.s} ${line.c}`;
}

/** 복사 HTML용 인라인 CSS 문자열(엑셀·구글 시트가 읽는 속성만). 서식이 없으면 빈 문자열. */
export function cssOfStyle(s: CellStyle | undefined): string {
  if (!s) return "";
  const out: string[] = [];
  // 속성 이름은 camelCase로 적고 내보낼 때 CSS 이름으로 바꾼다 — `text-align` 같은 글자를 그대로 두면 색 클래스 가드가 클래스로 읽는다.
  const decl = (prop: string, value: string) => out.push(`${prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${value}`);
  if (s.bg) decl("backgroundColor", s.bg);
  if (s.fc) decl("color", s.fc);
  if (s.ff) decl("fontFamily", fontStack(s.ff).replace(/"/g, "'"));
  if (s.fs) decl("fontSize", `${s.fs}pt`);
  if (s.b) decl("fontWeight", "bold");
  if (s.i) decl("fontStyle", "italic");
  const deco = textDecoration(s);
  if (deco) decl("textDecoration", deco);
  if (s.ha) decl("textAlign", s.ha);
  if (s.va) decl("verticalAlign", s.va);
  decl("whiteSpace", s.wr === "wrap" ? "normal" : "nowrap");
  const sides = { t: "top", r: "right", b: "bottom", l: "left" } as const;
  for (const [k, name] of Object.entries(sides) as [keyof typeof sides, string][]) {
    const line = s.bd?.[k];
    if (line) out.push(`border-${name}:${borderCss(line)}`);
  }
  return out.join(";");
}
