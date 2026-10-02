import { makeFixture, type Draft } from './model';

type Entry = { label: string; before: Draft; after: Draft };
export type StoreSnapshot = { draft: Draft; revision: number; undos: number; redos: number; label: string };
export class DraftStore {
  private past: Entry[] = [];
  private future: Entry[] = [];
  private listeners = new Set<() => void>();
  private snapshot: StoreSnapshot;
  constructor(draft = makeFixture()) {
    this.snapshot = { draft: structuredClone(draft), revision: 0, undos: 0, redos: 0, label: '연습안 시작' };
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  commit(label: string, next: Draft) {
    if (JSON.stringify(next) === JSON.stringify(this.snapshot.draft)) return false;
    this.past.push({ label, before: structuredClone(this.snapshot.draft), after: structuredClone(next) });
    this.future = [];
    this.update(next, label);
    return true;
  }
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
    this.snapshot = { draft: structuredClone(draft), revision: this.snapshot.revision + 1, undos: this.past.length, redos: this.future.length, label };
    for (const listener of this.listeners) listener();
  }
}
