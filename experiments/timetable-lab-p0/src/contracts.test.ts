import { describe, it, expect } from 'vitest';
import { makeFixture, patchCells, assignStudent, lessons } from '@/features/timetable-lab/editor/model';
import { DraftStore } from '@/features/timetable-lab/editor/store';
import { decodeTsv, encodeTsv, pasteCells, valuesOnly } from './clipboard';
import { suggest, validate } from '@/features/timetable-lab/editor/constraints';

describe('one domain history', () => {
  it('undoes format, placement and student changes in user order without losing source IDs', () => {
    const store = new DraftStore(), initial = structuredClone(store.getSnapshot().draft);
    store.commit('format', patchCells(initial, [{ row: 1, col: 0, cell: { text: '영어 A', bold: true } }]));
    const formatted = structuredClone(store.getSnapshot().draft);
    store.commit('move', patchCells(formatted, [{ row: 1, col: 1, cell: { text: '화' } }]));
    const moved = structuredClone(store.getSnapshot().draft);
    store.commit('assign', assignStudent(moved, 's1', 'class-2'));
    expect(store.getSnapshot().draft.placements).toEqual(initial.placements);
    store.undo(); expect(store.getSnapshot().draft).toEqual(moved);
    store.undo(); expect(store.getSnapshot().draft).toEqual(formatted);
    store.undo(); expect(store.getSnapshot().draft).toEqual(initial);
    store.redo(); expect(store.getSnapshot().draft).toEqual(formatted);
    store.commit('new branch', assignStudent(formatted, 's2', 'class-1'));
    expect(store.redo()).toBe(false);
    expect(store.getSnapshot().revision).toBe(8);
  });
  it('does not let an incoming command mutate its saved history after commit', () => {
    const store = new DraftStore(), next = assignStudent(store.getSnapshot().draft, 's1', 'class-2');
    store.commit('assign', next); next.students['class-2'] = [];
    expect(store.getSnapshot().draft.students['class-2']).toEqual(['s2', 's1']);
    store.undo(); store.redo(); expect(store.getSnapshot().draft.students['class-2']).toEqual(['s2', 's1']);
  });
});
describe('clipboard boundaries', () => {
  it('round trips Korean, embedded tabs/newlines/quotes and empty trailing cells', () => {
    const rows = [['한글', '첫 줄\n둘째 줄', 'a\tb'], ['"인용"', '', '']];
    expect(decodeTsv(encodeTsv(rows))).toEqual(rows);
    expect(decodeTsv('a\tb\r\n')).toEqual([['a', 'b']]);
    expect(decodeTsv('')).toEqual([['']]);
  });
  it('leaves source untouched when cut paste cannot fit', () => {
    const draft = makeFixture(), before = structuredClone(draft);
    expect(() => pasteCells(draft, { row: 9, col: 5 }, [[{ text: 'a' }, { text: 'b' }]], { anchor: { row: 1, col: 0 }, focus: { row: 1, col: 1 } })).toThrow('공간');
    expect(draft).toEqual(before);
  });
  it('moves overlapping ranges atomically and restores the entire operation with one undo', () => {
    const store = new DraftStore(), before = structuredClone(store.getSnapshot().draft);
    const cells = before.cells[1].slice(0, 2);
    store.commit('cut', pasteCells(before, { row: 1, col: 1 }, [cells], { anchor: { row: 1, col: 0 }, focus: { row: 1, col: 1 } }));
    expect(store.getSnapshot().draft.cells[1].slice(0, 3).map(c => c.text)).toEqual(['', '영어 A', '월']);
    store.undo(); expect(store.getSnapshot().draft).toEqual(before);
  });
  it('rejects malformed TSV without partial changes', () => { expect(() => decodeTsv('"not closed')).toThrow(); });
  it('formula copy retains the destination confirmed value and values-only rejects unconfirmed formula results', () => {
    const draft = makeFixture(), formula = [[{ text: '20:00', formula: '=1+1' }]];
    const next = pasteCells(draft, { row: 1, col: 2 }, formula);
    expect(next.cells[1][2]).toEqual({ text: '18:00', formula: '=1+1' });
    expect(lessons(next)).toEqual(lessons(draft));
    expect(() => valuesOnly(draft, { row: 1, col: 2 }, formula)).toThrow('수식 결과');
  });
  it('values-only keeps destination style and clears stale rich text and formula', () => {
    const draft = patchCells(makeFixture(), [{ row: 5, col: 0, cell: { text: 'old', formula: '=1', bold: true,
      format: { bg: { rgb: '#ff0000' } }, richText: { body: { dataStream: 'old\r\n' } } } }]);
    const next = pasteCells(draft, { row: 5, col: 0 }, valuesOnly(draft, { row: 5, col: 0 }, [[{ text: 'new' }]]));
    expect(next.cells[5][0]).toEqual({ text: 'new', bold: true, format: { bg: { rgb: '#ff0000' } }, formula: undefined, richText: undefined });
  });
});
describe('synthetic conflict recommendations', () => {
  it('sees math conflicts from the current draft roster and responds to reassignment', () => {
    const draft = makeFixture();
    expect(validate(draft).issues).toHaveLength(1);
    expect(validate(assignStudent(draft, 's1', 'class-2')).issues).toHaveLength(0);
  });
  it('produces deterministic final-state candidates, keeps length and IDs, and handles adjacent times', () => {
    const draft = makeFixture(), result = suggest(draft, 'placement-1', 7);
    expect(result).toHaveLength(3); expect(result).toEqual(suggest(draft, 'placement-1', 7));
    expect(result[0].start).toBe(1020); // 17:00 ends at math start, no false overlap.
    for (const candidate of result) {
      expect(validate(candidate.draft).issues).toHaveLength(0);
      expect(candidate.end - candidate.start).toBe(60);
      expect(candidate.draft.placements).toEqual(draft.placements);
      expect(candidate.revision).toBe(7);
    }
  });
  it('never treats missing room/time as conflict-free', () => {
    const draft = patchCells(makeFixture(), [{ row: 1, col: 5, cell: { text: '' } }]);
    expect(validate(draft).incomplete).toHaveLength(1);
    expect(suggest(draft, 'placement-1', 0)).toHaveLength(0);
  });
  it('formula edits do not change confirmed semantic time', () => {
    const initial = makeFixture(), draft = patchCells(initial, [{ row: 1, col: 2, cell: { text: '18:00', formula: '=1+1' } }]);
    expect(lessons(draft)).toEqual(lessons(initial));
    expect(validate(draft)).toEqual(validate(initial));
    expect(suggest(draft, 'placement-1', 0)).toEqual([]);
  });
  it('suggestion keeps cell formatting while replacing outdated rich text', () => {
    const draft = patchCells(makeFixture(), [{ row: 1, col: 2, cell: { text: '18:00', bold: true,
      format: { bg: { rgb: '#ff0000' } }, richText: { body: { dataStream: '18:00\r\n' } } } }]);
    const candidate = suggest(draft, 'placement-1', 0)[0].draft.cells[1][2];
    expect(candidate).toEqual({ text: '17:00', bold: true, format: { bg: { rgb: '#ff0000' } }, richText: undefined });
  });
});
