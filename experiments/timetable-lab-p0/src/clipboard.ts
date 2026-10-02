import { patchCells, type Cell, type Draft, type Patch } from './model';

export type Point = { row: number; col: number };
export type Selection = { anchor: Point; focus: Point };
export function bounds(selection: Selection) {
  return { top: Math.min(selection.anchor.row, selection.focus.row), bottom: Math.max(selection.anchor.row, selection.focus.row),
    left: Math.min(selection.anchor.col, selection.focus.col), right: Math.max(selection.anchor.col, selection.focus.col) };
}
export function encodeTsv(rows: string[][]) {
  return rows.map(row => row.map(value => /[\t\r\n"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value).join('\t')).join('\r\n');
}
export function decodeTsv(text: string): string[][] {
  if (text.length > 100_000) throw new Error('실험에서는 10만 자 이하만 붙여넣을 수 있습니다.');
  const rows: string[][] = [[]];
  let value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && (quoted || value === '')) {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted;
    } else if (!quoted && (char === '\t' || char === '\n' || char === '\r')) {
      rows.at(-1)!.push(value); value = '';
      if (char !== '\t') { if (char === '\r' && text[i + 1] === '\n') i++; rows.push([]); }
    } else value += char;
  }
  if (quoted) throw new Error('따옴표가 닫히지 않은 붙여넣기입니다.');
  if (value !== '' || rows.at(-1)!.length || rows.length === 1) rows.at(-1)!.push(value);
  else rows.pop();
  return rows;
}
export function selectionCells(draft: Draft, selection: Selection): Cell[][] {
  const b = bounds(selection);
  return draft.cells.slice(b.top, b.bottom + 1).map(row => row.slice(b.left, b.right + 1));
}
export function pasteCells(draft: Draft, at: Point, cells: Cell[][], cut?: Selection): Draft {
  if (!cells.length || !cells[0].length || cells.some(row => row.length !== cells[0].length)) throw new Error('직사각형 범위를 선택하세요.');
  if (at.row < 0 || at.col < 0 || at.row + cells.length > draft.cells.length || at.col + cells[0].length > draft.cells[0].length) {
    throw new Error('붙여넣을 공간이 부족합니다. 원본은 그대로입니다.');
  }
  const patches: Patch[] = [];
  if (cut) {
    const b = bounds(cut);
    for (let row = b.top; row <= b.bottom; row++) for (let col = b.left; col <= b.right; col++) patches.push({ row, col, cell: { text: '' } });
  }
  cells.forEach((row, r) => row.forEach((cell, c) => patches.push({ row: at.row + r, col: at.col + c,
    // Copying a formula is not confirmation of its result as a schedule value.
    cell: cell.formula ? { ...cell, text: draft.cells[at.row + r][at.col + c].text } : cell })));
  return patchCells(draft, patches);
}
export function valuesOnly(draft: Draft, at: Point, cells: Cell[][]): Cell[][] {
  if (cells.some(row => row.some(cell => cell.formula))) throw new Error('수식 결과의 값만 붙여넣기는 아직 검증 중입니다. 원본은 유지됩니다.');
  return cells.map((row, r) => row.map((cell, c) => ({ ...draft.cells[at.row + r]?.[at.col + c],
    text: cell.text, formula: undefined, richText: undefined })));
}
