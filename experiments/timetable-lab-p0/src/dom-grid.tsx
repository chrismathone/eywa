import { useRef, useState, useSyncExternalStore, type ClipboardEvent, type KeyboardEvent } from 'react';
import { bounds, decodeTsv, encodeTsv, pasteCells, selectionCells, valuesOnly, type Point, type Selection } from './clipboard';
import { patchCells, type Cell } from './model';
import type { DraftStore } from './store';

type PendingCut = { token: string; revision: number; selection: Selection; cells: Cell[][]; isCut: boolean };
const mime = 'application/x-eywa-p0-cut';
export function DomGrid({ store, announce }: { store: DraftStore; announce: (message: string) => void }) {
  const { draft, revision } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [selection, select] = useState<Selection>({ anchor: { row: 1, col: 1 }, focus: { row: 1, col: 1 } });
  const [editing, edit] = useState<{ point: Point; value: string } | null>(null);
  const grid = useRef<HTMLDivElement>(null), composing = useRef(false), cut = useRef<PendingCut | null>(null);
  const pasteWithoutFormat = useRef(false);
  const b = bounds(selection);
  function commitEdit() {
    if (!editing || composing.current) return;
    const previous = store.getSnapshot().draft.cells[editing.point.row][editing.point.col];
    const cell = editing.value.startsWith('=') ? { ...previous, formula: editing.value, richText: undefined } : { ...previous, text: editing.value, formula: undefined, richText: undefined };
    store.commit('셀 입력', patchCells(store.getSnapshot().draft, [{ ...editing.point, cell }]));
    edit(null); grid.current?.focus();
  }
  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.isPropagationStopped() || composing.current || event.nativeEvent.isComposing || event.keyCode === 229 || editing) return;
    const mod = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
    const move: Record<string, [number, number]> = { arrowup: [-1, 0], arrowdown: [1, 0], arrowleft: [0, -1], arrowright: [0, 1], tab: [0, event.shiftKey ? -1 : 1], enter: [event.shiftKey ? -1 : 1, 0] };
    if (mod && ['c', 'x', 'v'].includes(key)) { pasteWithoutFormat.current = key === 'v' && event.shiftKey; return; }
    if (mod && (key === 'z' || key === 'y')) { event.preventDefault(); event.stopPropagation(); (key === 'y' || event.shiftKey ? store.redo : store.undo)(); return; }
    if (mod && key === 'a') { event.preventDefault(); select({ anchor: { row: 0, col: 0 }, focus: { row: draft.cells.length - 1, col: 5 } }); return; }
    if (mod && key === 'b') {
      event.preventDefault(); event.stopPropagation();
      const bold = !draft.cells[selection.focus.row][selection.focus.col].bold;
      store.commit('굵게', patchCells(draft, selectionCells(draft, selection).flatMap((row, r) => row.map((cell, c) => ({ row: b.top + r, col: b.left + c, cell: { ...cell, bold } })))));
      return;
    }
    if (move[key]) {
      event.preventDefault();
      const [r, c] = move[key], point = { row: Math.max(0, Math.min(draft.cells.length - 1, selection.focus.row + r)), col: Math.max(0, Math.min(5, selection.focus.col + c)) };
      select({ anchor: event.shiftKey && key.startsWith('arrow') ? selection.anchor : point, focus: point }); return;
    }
    if (key === 'escape') { cut.current = null; announce('잘라내기를 취소했습니다.'); return; }
    if (key === 'delete' || key === 'backspace') {
      event.preventDefault(); store.commit('범위 지우기', patchCells(draft, selectionCells(draft, selection).flatMap((row, r) => row.map((cell, c) => ({ row: b.top + r, col: b.left + c, cell: { ...cell, text: '', formula: undefined, richText: undefined } }))))); return;
    }
    if (key === 'f2' || (!mod && !event.altKey && event.key.length === 1)) {
      event.preventDefault(); const cell = draft.cells[selection.focus.row][selection.focus.col];
      edit({ point: selection.focus, value: key === 'f2' ? cell.formula ?? cell.text : event.key });
    }
  }
  function copy(event: ClipboardEvent, isCut: boolean) {
    if (editing) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', encodeTsv(selectionCells(draft, selection).map(row => row.map(c => c.formula ?? c.text))));
    cut.current = { token: crypto.randomUUID(), revision, selection: structuredClone(selection), cells: structuredClone(selectionCells(draft, selection)), isCut };
    event.clipboardData.setData(mime, cut.current.token);
    announce(isCut ? '잘라내기 준비. 붙여넣기가 성공하면 원본을 지웁니다.' : '범위를 복사했습니다.');
  }
  function paste(event: ClipboardEvent) {
    if (editing) return;
    event.preventDefault();
    try {
      const pending = cut.current;
      const isInternal = pending && event.clipboardData.getData(mime) === pending.token;
      const isMove = isInternal && pending.isCut;
      if (isMove && pasteWithoutFormat.current) throw new Error('잘라낸 범위는 일반 붙여넣기로 이동하세요. 원본은 유지됩니다.');
      if (isMove && pending.revision !== revision) throw new Error('잘라낸 뒤 내용이 바뀌었습니다. 다시 선택하세요.');
      const at = { row: b.top, col: b.left };
      const cells = isInternal ? pending.cells : decodeTsv(event.clipboardData.getData('text/plain')).map((row, r) => row.map((text, c) => text.startsWith('=') ? { text: draft.cells[at.row + r]?.[at.col + c]?.text ?? '', formula: text } : { text }));
      store.commit(isMove ? '범위 이동' : '범위 붙여넣기', pasteCells(draft, at,
        pasteWithoutFormat.current ? valuesOnly(draft, at, cells) : cells, isMove ? pending.selection : undefined));
      if (isMove) cut.current = null;
      announce('연습안에 붙여넣었습니다.');
    } catch (error) { announce(error instanceof Error ? error.message : '붙여넣기를 확인하세요.'); }
    finally { pasteWithoutFormat.current = false; }
  }
  return <div ref={grid} role="grid" aria-label="자체 격자 강사 배치" aria-rowcount={draft.cells.length} aria-colcount={6}
    aria-activedescendant={`cell-${selection.focus.row}-${selection.focus.col}`} tabIndex={0} className="dom-grid"
    onKeyDown={onKey} onKeyUp={e => { if (e.key.toLowerCase() === 'v') pasteWithoutFormat.current = false; }}
    onCopy={e => copy(e, false)} onCut={e => copy(e, true)} onPaste={paste}>
    {draft.cells.map((row, r) => <div role="row" key={r}>{row.map((cell, c) => {
      const selected = r >= b.top && r <= b.bottom && c >= b.left && c <= b.right;
      return <div role="gridcell" id={`cell-${r}-${c}`} key={c} data-row={r} data-col={c} aria-selected={selected}
        className={`${selected ? 'selected' : ''} ${cell.bold ? 'bold' : ''}`} onPointerDown={e => {
          if (editing) return; grid.current?.focus(); const point = { row: r, col: c }; select({ anchor: e.shiftKey ? selection.anchor : point, focus: point });
        }} onDoubleClick={() => edit({ point: { row: r, col: c }, value: cell.formula ?? cell.text })}>
        {editing?.point.row === r && editing.point.col === c ? <input autoFocus aria-label={`셀 편집 ${r + 1}행 ${c + 1}열`}
          value={editing.value} onChange={e => edit({ ...editing, value: e.target.value })} onBlur={commitEdit}
          onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={e => {
            e.stopPropagation(); if (composing.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
            if (e.key === 'Escape') { e.preventDefault(); edit(null); grid.current?.focus(); }
          }} /> : cell.formula ?? cell.text}
      </div>;
    })}</div>)}
  </div>;
}
