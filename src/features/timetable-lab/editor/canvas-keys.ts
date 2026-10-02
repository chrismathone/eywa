import type { KeyboardEvent } from 'react';
import { moveBlocks, removeBlocks, type Position } from './block-commands';
import type { EditorActions } from './editor-actions';
import { duplicateBelow, shiftBlocks } from './item-commands';
import type { Draft, Lesson } from './model';
import { resizeLesson } from './operating-times';
import type { DraftStore } from './store';

type Lane = { teacher: string; day: string; offset: number };
export type KeyContext = { store: DraftStore; all: Lesson[]; lanes: Lane[]; min: number; max: number; step: number;
  selected: string[]; visible: Set<string>; cursor: Position | null; setCursor: (at: Position) => void;
  select: (ids: string[]) => void; details: () => void; actions?: EditorActions;
  apply: (label: string, change: (draft: Draft) => Draft, done?: string) => boolean; /** Esc: 끌기·선택·강조를 모두 푼다. */ reset: () => void };

/**
 * 강사뷰의 단축키. 복사·잘라내기·붙여넣기는 브라우저의 클립보드 이벤트가 맡는다.
 * Alt+↑↓ 시간 밀기 · Alt+←→ 옆 칸으로 · Shift+↑↓ 길이 · Ctrl+D 복제 · Insert 추가 · Enter/F2 자세히 · Delete 지우기.
 */
export function canvasKey(event: KeyboardEvent, c: KeyContext) {
  if (event.nativeEvent.isComposing || event.keyCode === 229) return;
  const mod = event.ctrlKey || event.metaKey, k = event.key.toLowerCase(), { selected, lanes, step } = c;
  if (mod && ['c', 'v', 'x'].includes(k)) return;
  if (mod && ['z', 'y'].includes(k)) { event.preventDefault(); (k === 'y' || event.shiftKey ? c.store.redo : c.store.undo)(); return; }
  if (mod && k === 'a') { event.preventDefault(); c.select([...c.visible]); return; }
  if (mod && k === 'd' && selected.length) { event.preventDefault(); c.apply('수업 복제', current => duplicateBelow(current, selected), '바로 아래에 복제했습니다.'); return; }
  if (k === 'escape') { c.reset(); return; }
  if ((k === 'delete' || k === 'backspace') && selected.length) { event.preventDefault(); if (c.apply('수업 배치 지우기', current => removeBlocks(current, selected))) c.select([]); return; }
  if ((k === 'enter' || k === 'f2') && selected.length) { event.preventDefault(); c.details(); return; }
  if (k === 'insert' && c.actions) { event.preventDefault(); c.actions.openAdd(c.cursor ?? {}); return; }
  if (!k.startsWith('arrow')) return;
  if (selected.length && (event.altKey || event.shiftKey)) {
    event.preventDefault();
    const first = c.all.find(p => p.id === selected[0]); if (!first) return;
    const vertical = k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0;
    if (event.shiftKey && vertical && selected.length === 1) c.apply('수업 길이 변경', current => resizeLesson(current, first.id, first.start, first.end + vertical));
    else if (event.altKey && vertical) c.apply('수업 시간 밀기', current => shiftBlocks(current, selected, vertical));
    else if (event.altKey && !vertical) {
      const index = lanes.findIndex(l => l.teacher === first.teacher && l.day === first.day), lane = lanes[index + (k === 'arrowright' ? 1 : -1)];
      if (lane) c.apply('수업 이동', current => moveBlocks(current, selected, first.id, { day: lane.day, teacher: lane.teacher, start: first.start }));
    }
    return;
  }
  if (!lanes.length) return;
  event.preventDefault(); const at = c.cursor ?? { day: lanes[0].day, teacher: lanes[0].teacher, start: c.min - lanes[0].offset };
  const index = Math.max(0, lanes.findIndex(l => l.teacher === at.teacher && l.day === at.day));
  const lane = lanes[Math.max(0, Math.min(lanes.length - 1, index + (k === 'arrowright' ? 1 : k === 'arrowleft' ? -1 : 0)))];
  c.setCursor({ day: lane.day, teacher: lane.teacher, start: Math.max(0, Math.min(c.max - step - lane.offset,
    at.start + (k === 'arrowdown' ? step : k === 'arrowup' ? -step : 0))) });
}
