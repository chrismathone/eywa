import { makeFixture, type Draft } from './model';

type Entry = { label: string; before: Draft; after: Draft };
export type StoreSnapshot = { draft: Draft; revision: number; undos: number; redos: number; label: string };
/** Detached immutable snapshots share unchanged branches, including large rosters and source metadata. */
function retain(previous: unknown, next: unknown): unknown {
  if (Object.is(previous, next)) return previous;
  if (!next || typeof next !== 'object') return next;
  if (Array.isArray(next)) {
    const before = Array.isArray(previous) ? previous : undefined;
    let copy: unknown[] | undefined = before?.length === next.length ? undefined : new Array(next.length);
    for (let i = 0; i < next.length; i++) {
      const value = retain(before?.[i], next[i]);
      if (!copy && !Object.is(value, before?.[i])) copy = before!.slice();
      if (copy) copy[i] = value;
    }
    return copy ? Object.freeze(copy) : before;
  }
  const before = previous && typeof previous === 'object' && !Array.isArray(previous) ? previous as Record<string, unknown> : undefined;
  const after = next as Record<string, unknown>, keys = Object.keys(after);
  // Clearing an absent optional field to undefined remains a no-op, as with the previous JSON comparison.
  const beforeKeys = before ? Object.keys(before) : [];
  const sameSize = beforeKeys.length === keys.length || beforeKeys.filter(key => before![key] !== undefined).length === keys.filter(key => after[key] !== undefined).length;
  const removedValue = beforeKeys.some(key => before![key] !== undefined && !Object.hasOwn(after, key));
  let copy: Record<string, unknown> | undefined = before && sameSize && !removedValue ? undefined : {};
  for (const key of keys) {
    const old = before && Object.hasOwn(before, key) ? before[key] : undefined;
    const value = retain(old, after[key]);
    if (!copy && !Object.is(value, old)) copy = { ...before };
    if (copy) Object.defineProperty(copy, key, { value, enumerable: true, configurable: true, writable: true });
  }
  // Equal key counts can still hide a deleted key and a new key with the same value.
  if (copy) for (const key of Object.keys(copy)) if (!Object.hasOwn(after, key)) delete copy[key];
  return copy ? Object.freeze(copy) : before;
}
export class DraftStore {
  private past: Entry[] = [];
  private future: Entry[] = [];
  private listeners = new Set<() => void>();
  private snapshot: StoreSnapshot;
  constructor(draft = makeFixture()) {
    this.snapshot = Object.freeze({ draft: retain(undefined, draft) as Draft, revision: 0, undos: 0, redos: 0, label: '연습안 시작' });
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  commit(label: string, next: Draft) {
    const after = retain(this.snapshot.draft, next) as Draft;
    if (after === this.snapshot.draft) return false;
    this.past.push({ label, before: this.snapshot.draft, after });
    this.future = [];
    this.update(after, label);
    return true;
  }
  /** 되돌릴 수 있는 변경의 이름(오래된 것부터). 기록 메뉴가 쓴다. */
  history = () => this.past.map(entry => entry.label);
  /** 여러 단계를 한꺼번에 되돌린다. */
  undoMany = (steps: number) => { for (let i = 0; i < steps && this.undo(); i++); };
  undo = () => {
    const entry = this.past.pop();
    if (!entry) return false;
    this.future.push(entry); this.update(entry.before, `되돌림: ${entry.label}`); return true;
  };
  redo = () => {
    const entry = this.future.pop();
    if (!entry) return false;
    this.past.push(entry); this.update(entry.after, `다시 실행: ${entry.label}`); return true;
  };
  private update(draft: Draft, label: string) {
    this.snapshot = Object.freeze({ draft, revision: this.snapshot.revision + 1, undos: this.past.length, redos: this.future.length, label });
    for (const listener of this.listeners) listener();
  }
}
