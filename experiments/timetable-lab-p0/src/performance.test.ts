import { describe, expect, it, vi } from 'vitest';
import { suggest, validate } from './constraints';
import { referenceSuggest, referenceValidate } from './constraints-reference.test-support';
import { largeDraft, ReferenceStore, variedDraft } from './performance.test-support';
import { lessons, makeFixture, type Draft } from './model';
import { DraftStore } from './store';

describe('indexed conflicts and recommendations', () => {
  it('matches the full pair scan, including warning order, mixed IDs and seat exceptions', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const draft = variedDraft(seed);
      expect(validate(draft), `seed ${seed}`).toEqual(referenceValidate(draft));
    }
  });

  it('matches full final-state validation for recommendations, shared rows and duplicate outside IDs', () => {
    for (let seed = 1; seed <= 24; seed++) {
      const draft = variedDraft(seed);
      expect(suggest(draft, 'placement-0', seed), `seed ${seed}`).toEqual(referenceSuggest(draft, 'placement-0', seed));
    }
  });

  it('matches labels only when at least one identity is missing; never skips an outside row sharing the ID', () => {
    const draft = makeFixture(); draft.outside = [];
    draft.placements[0].teacherId = 'teacher-a'; draft.placements[0].roomId = 'room-a';
    const source = lessons(draft).items[0];
    draft.outside = [{ ...source, teacherId: 'teacher-b', roomId: 'room-b', students: [] }];
    expect(validate(draft).issues).toEqual([]); // Same labels, distinct known identities.
    draft.outside[0].teacherId = null;
    expect(validate(draft).issues[0].key).toBe('placement-1/placement-1/강사');
    draft.outside[0] = { ...source, teacher: 'another label', room: 'another room', students: [] };
    expect(validate(draft).issues[0].key).toBe('placement-1/placement-1/강사,강의실');
    draft.outside[0].kind = 'seat';
    expect(validate(draft).issues).toEqual([]);
    draft.outside[0].students = ['s1'];
    expect(validate(draft).issues[0].key).toBe('placement-1/placement-1/학생');
    for (const candidate of suggest(draft, 'placement-1', 0)) {
      expect(validate(candidate.draft).issues.some(p => p.placementIds.includes('placement-1'))).toBe(false);
    }
  });

  it('respects operating gaps and builds at most three full candidate drafts', () => {
    const draft = largeDraft(20);
    draft.operatingHours!.월 = [{ start: 540, end: 600 }, { start: 630, end: 720 }];
    const clone = vi.spyOn(globalThis, 'structuredClone');
    try {
      const result = suggest(draft, 'placement-1', 8);
      expect(result.length).toBe(3);
      expect(clone.mock.calls.filter(([arg]) => arg === draft)).toHaveLength(result.length);
      for (const p of result) expect((p.start >= 540 && p.end <= 600) || (p.start >= 630 && p.end <= 720)).toBe(true);
    } finally { clone.mockRestore(); }
  });
});

describe('shared immutable history', () => {
  it('retains unchanged rosters, placements and rows across edits; input and returned snapshots cannot corrupt undo', () => {
    const input = largeDraft(80), store = new DraftStore(input), original = store.getSnapshot().draft;
    const next = structuredClone(original); next.cells[1][0].text = 'changed';
    store.commit('rename', next);
    const renamed = store.getSnapshot().draft;
    expect(renamed.students).toBe(original.students);
    expect(renamed.placements).toBe(original.placements);
    expect(renamed.cells[2]).toBe(original.cells[2]);
    expect(renamed.cells[1][1]).toBe(original.cells[1][1]);
    next.cells[1][0].text = 'external'; input.students['class-0'].length = 0;
    expect(() => { renamed.cells[1][0].text = 'illegal'; }).toThrow();
    expect(() => { renamed.students['class-0'].push('illegal'); }).toThrow();
    store.undo(); expect(store.getSnapshot().draft).toBe(original);
    store.redo(); expect(store.getSnapshot().draft).toBe(renamed);
  });

  it('treats deep-equal commits as no-ops, handles deleted/added keys and array length changes, and loads in one undo', () => {
    const store = new DraftStore(), initial = store.getSnapshot();
    expect(store.commit('same', structuredClone(initial.draft))).toBe(false);
    const cleared = structuredClone(initial.draft); cleared.cells[1][2].formula = undefined;
    expect(store.commit('clear absent formula', cleared)).toBe(false);
    expect(store.getSnapshot()).toBe(initial);
    const next = structuredClone(initial.draft);
    delete next.students['class-1']; next.students.renamed = ['new']; next.placements.pop();
    store.commit('change', next); expect(store.getSnapshot().draft).toEqual(next);
    store.commit('load', largeDraft(20)); expect(store.getSnapshot().undos).toBe(2);
    store.undo(); expect(store.getSnapshot().draft).toEqual(next);
    store.undo(); expect(store.getSnapshot().draft).toBe(initial.draft);
    store.commit('branch', largeDraft(10)); expect(store.redo()).toBe(false);
  });

  it('does not lose a deleted defined key when an undefined key replaces it', () => {
    const input = makeFixture(); input.cells[1][0].format = { x: 1 };
    const store = new DraftStore(input), before = store.getSnapshot().draft;
    const next = structuredClone(before); next.cells[1][0].format = { y: undefined };
    expect(store.commit('clear format', next)).toBe(true);
    expect(store.getSnapshot().draft.cells[1][0].format).toStrictEqual({ y: undefined });
    store.undo(); expect(store.getSnapshot().draft).toBe(before);
    store.redo(); expect(store.getSnapshot().draft.cells[1][0].format).toStrictEqual({ y: undefined });
    const unchanged = structuredClone(store.getSnapshot().draft); unchanged.cells[1][0].format = { z: undefined };
    expect(store.commit('empty format', unchanged)).toBe(false);
  });
});

it('benchmarks synthetic 1,200 placements and 4,800 students without timing-dependent pass criteria', () => {
  const draft = largeDraft();
  const measure = <T,>(run: () => T) => { const start = performance.now(), result = run(); return { result, ms: performance.now() - start }; };
  const oldValidation = measure(() => referenceValidate(draft)), validation = measure(() => validate(draft));
  expect(validation.result).toEqual(oldValidation.result);
  const oldSuggestions = measure(() => referenceSuggest(draft, 'placement-1', 0)), suggestions = measure(() => suggest(draft, 'placement-1', 0));
  expect(suggestions.result).toEqual(oldSuggestions.result);
  const commands = Array.from({ length: 20 }, (_, i) => {
    const next = structuredClone(draft); next.cells[1][0].text = `name-${i}`; return next;
  });
  const oldStore = new ReferenceStore(draft), store = new DraftStore(draft), snapshots: Draft[] = [store.getSnapshot().draft];
  const oldHistory = measure(() => commands.forEach(next => oldStore.commit(next)));
  const history = measure(() => commands.forEach(next => { store.commit('rename', next); snapshots.push(store.getSnapshot().draft); }));
  expect(new Set(snapshots.map(p => p.students)).size).toBe(1);
  expect(new Set(snapshots.map(p => p.placements)).size).toBe(1);
  const oldRosters = new Set(oldStore.past.flatMap(p => [p.before.students, p.after.students]));
  expect(oldRosters.size).toBe(40);
  console.info(JSON.stringify({ placements: draft.placements.length, students: 4800,
    validateMs: { before: oldValidation.ms, after: validation.ms }, suggestMs: { before: oldSuggestions.ms, after: suggestions.ms },
    commit20Ms: { before: oldHistory.ms, after: history.ms }, retainedRosterCopies: { before: oldRosters.size, after: 1 } }));
}, 30_000);
