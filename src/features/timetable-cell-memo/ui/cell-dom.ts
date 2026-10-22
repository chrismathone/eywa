import { visualColumns, type CellPos, type MemoCellSpec } from "../grid-index";

/** 메모를 다는 칸 하나 — 칸(td) · 그 칸의 강사 열·요일·시각 범위 · 날짜. */
export type MemoTarget = { td: HTMLTableCellElement; spec: MemoCellSpec; date: string };

/**
 * 강사뷰 표 본문(tbody)의 칸 → 화면 위치(행 · 화면 열 · 세로 병합 수). 표가 다시 그려지면(주 이동·새로고침) 다시 만든다.
 * 칸마다 속성을 싣지 않고 표 구조만으로 되짚는다(grid-index.ts 머리 주석).
 */
export function indexBody(tbody: HTMLTableSectionElement): Map<HTMLTableCellElement, CellPos> {
  const cells = bodyRows(tbody).map(rowCells);
  const cols = visualColumns(cells.map((row) => row.map((c) => ({ rowSpan: spanOf(c, "rowspan"), colSpan: spanOf(c, "colspan") }))));
  const out = new Map<HTMLTableCellElement, CellPos>();
  cells.forEach((row, r) => row.forEach((c, i) => out.set(c, { row: r, col: cols[r]![i]!, rowSpan: spanOf(c, "rowspan") })));
  return out;
}

/** 본문 행·칸 — 자식 요소로 읽는다(표 전용 속성 `rows`·`cells`·`rowSpan`에 기대지 않는다). */
export function bodyRows(tbody: HTMLTableSectionElement): HTMLTableRowElement[] {
  return Array.from(tbody.children).filter((el): el is HTMLTableRowElement => el.tagName === "TR");
}
export function rowCells(tr: HTMLTableRowElement): HTMLTableCellElement[] {
  return Array.from(tr.children).filter((el): el is HTMLTableCellElement => el.tagName === "TD" || el.tagName === "TH");
}
const spanOf = (c: Element, attr: "rowspan" | "colspan") => Math.max(1, Number(c.getAttribute(attr)) || 1);

/** 이벤트 대상 → 그 표 본문 칸(머리 줄·표 밖이면 null). */
export function bodyCellOf(target: EventTarget | null, root: Element): HTMLTableCellElement | null {
  if (!(target instanceof Element)) return null;
  const td = target.closest("td");
  if (!td || !root.contains(td) || td.parentElement?.parentElement?.tagName !== "TBODY") return null;
  return td;
}

export function viewport(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight };
}
