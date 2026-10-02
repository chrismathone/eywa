import { useRef, useState, type PointerEvent, type RefObject } from 'react';
import { reasonOf } from './reason';
import { copyBlocks, moveBlocks, type Position } from './block-commands';
import type { EditorActions } from './editor-actions';
import { freeBands, type Band } from './free-slots';
import { issueKeys, previewMove, type MovePreview } from './insights';
import { lessons, timeLabel, type Draft, type Lesson } from './model';
import { resizeLesson } from './operating-times';
import type { DraftStore } from './store';

type MoveDrag = { kind: 'move'; lesson: Lesson; ids: string[]; x: number; y: number; offset: number; displayOffset: number; revision: number; moved: boolean;
  to: Position | null; copy: boolean; seen: string; known: Set<string> | null };
type ResizeDrag = { kind: 'resize'; lesson: Lesson; edge: 'start' | 'end'; lane: HTMLElement; displayOffset: number; revision: number; start: number; end: number; moved: boolean };
/** 빈 칸에서 시작한 끌기 — 그냥 끌면 그 길이로 새 수업을 그리고, Shift를 누르고 끌면 네모로 여러 수업을 고른다. */
type AreaDrag = { kind: 'area'; lane: HTMLElement; x: number; y: number; cx: number; cy: number; marquee: boolean; add: boolean; moved: boolean; start: number; end: number };
export type Hover = Position & { duration: number; copy: boolean; preview: MovePreview };
export type Drawing = { teacher: string; day: string; start: number; end: number };
export type Box = { left: number; top: number; width: number; height: number };
type Options = { store: DraftStore; root: RefObject<HTMLDivElement | null>; grid: { min: number; step: number; unit: number; lanes: { teacher: string; day: string }[] };
  selected: string[]; select: (ids: string[]) => void; setCursor: (at: Position | null) => void; announce: (s: string) => void;
  apply: (label: string, change: (draft: Draft) => Draft, done?: string) => boolean; actions?: EditorActions; readOnly: boolean };

/** 강사뷰의 끌기 동작 — 수업 옮기기·복제, 끝을 잡아 길이 바꾸기, 빈 칸에 새 수업 그리기, 네모로 고르기. */
export function useCanvasDrag(o: Options) {
  const drag = useRef<MoveDrag | ResizeDrag | AreaDrag | null>(null), { min, step, unit } = o.grid;
  const [hover, setHover] = useState<Hover | null>(null), [resizing, setResizing] = useState<{ id: string; start: number; end: number } | null>(null);
  const [drawing, setDrawing] = useState<Drawing | null>(null), [marquee, setMarquee] = useState<Box | null>(null), [free, setFree] = useState<Map<string, Band[]> | null>(null);
  const clear = () => { drag.current = null; setHover(null); setResizing(null); setDrawing(null); setMarquee(null); setFree(null); };
  const minuteAt = (lane: HTMLElement, y: number, grab = 0) => min + Math.round((y - lane.getBoundingClientRect().top - grab) / unit) * step;
  const cellAt = (lane: HTMLElement, y: number) => Math.max(0, Math.min(1439 - step, min + Math.floor((y - lane.getBoundingClientRect().top) / unit) * step));

  /** 화면 좌표가 가리키는 칸. 끄는 중에는 잡은 자리(grab)만큼 빼고 가까운 시각으로, 그냥 누를 때는 그 칸의 시작 시각으로. */
  function locate(x: number, y: number, grab: number | null = null): Position | null {
    const hit = document.elementFromPoint(x, y), lane = hit?.closest<HTMLElement>('[data-lane]');
    if (!lane || !o.root.current?.contains(lane)) return null;
    const moving = drag.current?.kind === 'move' ? drag.current : null;
    // Morning blocks share visual coordinates with afternoon blocks. Preserve the dragged
    // block's own clock within its lane; another block carries its explicit offset on drop.
    const offset = moving && moving.lesson.teacher === lane.dataset.lane && moving.lesson.day === lane.dataset.day
      ? moving.displayOffset : Number(hit?.closest<HTMLElement>('[data-display-offset]')?.dataset.displayOffset ?? 0);
    const visual = grab === null ? cellAt(lane, y) : minuteAt(lane, y, grab);
    return { day: lane.dataset.day!, teacher: lane.dataset.lane!, start: Math.max(0, Math.min(1439 - step, visual - offset)) };
  }
  function down(event: PointerEvent<HTMLElement>, lesson: Lesson) {
    if (o.readOnly || event.button !== 0) return;
    event.preventDefault(); o.root.current?.focus();
    const { selected } = o, toggle = event.ctrlKey || event.metaKey;
    const ids = toggle ? (selected.includes(lesson.id) ? selected.filter(id => id !== lesson.id) : [...selected, lesson.id]) : selected.includes(lesson.id) ? selected : [lesson.id];
    o.select(ids); o.setCursor({ day: lesson.day, start: lesson.start, teacher: lesson.teacher });
    const lane = event.currentTarget.closest<HTMLElement>('[data-lane]')!, displayOffset = Number(event.currentTarget.dataset.displayOffset);
    drag.current = ids.includes(lesson.id) ? { kind: 'move', lesson, ids, x: event.clientX, y: event.clientY, displayOffset,
      offset: event.clientY - lane.getBoundingClientRect().top - (lesson.start + displayOffset - min) / step * unit,
      revision: o.store.getSnapshot().revision, moved: false, to: null, copy: event.altKey, seen: '', known: null } : null;
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  /** 블록의 위·아래 끝을 잡고 끌어 길이를 바꾼다. */
  function grip(event: PointerEvent<HTMLElement>, lesson: Lesson, edge: 'start' | 'end') {
    if (o.readOnly || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); o.root.current?.focus();
    if (lesson.locked) { o.announce('잠근 수업입니다. 잠금을 풀고 길이를 바꿔 주세요.'); return; }
    const block = event.currentTarget.closest<HTMLElement>('[data-block-id]')!, lane = block.closest<HTMLElement>('[data-lane]')!;
    o.select([lesson.id]);
    drag.current = { kind: 'resize', lesson, edge, lane, displayOffset: Number(block.dataset.displayOffset), revision: o.store.getSnapshot().revision,
      start: lesson.start, end: lesson.end, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function laneDown(event: PointerEvent<HTMLElement>) {
    if (o.readOnly || event.target !== event.currentTarget || event.button !== 0) return;
    o.root.current?.focus(); const at = locate(event.clientX, event.clientY); o.setCursor(at);
    // 손가락으로는 화면을 민다(스크롤) — 그리기·네모 고르기는 마우스와 펜에서만.
    if (!o.actions || !at || event.pointerType === 'touch') return;
    const start = cellAt(event.currentTarget, event.clientY);
    drag.current = { kind: 'area', lane: event.currentTarget, x: event.clientX, y: event.clientY, cx: event.clientX, cy: event.clientY,
      marquee: event.shiftKey, add: event.ctrlKey || event.metaKey, moved: false, start, end: start + step };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent) {
    const d = drag.current, root = o.root.current; if (!d || !root) return;
    // 창을 바꿨다가 버튼을 뗀 채 돌아오면 놓는 신호를 못 받는다 — 버튼이 떼어져 있으면 끌기를 끝낸다.
    if (!(event.buttons & 1)) { clear(); return; }
    if (d.kind === 'resize') {
      const at = minuteAt(d.lane, event.clientY) - d.displayOffset;
      const start = d.edge === 'start' ? Math.max(0, Math.min(at, d.lesson.end - step)) : d.lesson.start;
      const end = d.edge === 'end' ? Math.min(1439, Math.max(at, d.lesson.start + step)) : d.lesson.end;
      if (start !== d.start || end !== d.end) { d.start = start; d.end = end; d.moved = true; setResizing({ id: d.lesson.id, start, end }); }
      return;
    }
    if (Math.hypot(event.clientX - d.x, event.clientY - d.y) < 6 && !d.moved) return;
    if (d.kind === 'area') {
      d.moved = true; d.cx = event.clientX; d.cy = event.clientY;
      if (d.marquee) {
        const origin = root.querySelector('.teacher-week-grid')!.getBoundingClientRect();
        setMarquee({ left: Math.min(d.x, d.cx) - origin.left, top: Math.min(d.y, d.cy) - origin.top, width: Math.abs(d.cx - d.x), height: Math.abs(d.cy - d.y) });
      } else {
        const a = cellAt(d.lane, d.y), b = cellAt(d.lane, d.cy);
        d.start = Math.min(a, b); d.end = Math.max(a, b) + step;
        setDrawing({ teacher: d.lane.dataset.lane!, day: d.lane.dataset.day!, start: d.start, end: d.end });
      }
      return;
    }
    const current = o.store.getSnapshot().draft;
    if (!d.moved) {
      d.moved = true;
      // 하나를 끌 때는 겹침 없이 놓을 수 있는 자리를 한 번 계산해 칠해 둔다.
      if (d.ids.length === 1 && !d.lesson.locked) { setFree(freeBands(current, d.lesson.id, o.grid.lanes)); o.announce('초록으로 칠한 곳은 겹침 없이 놓을 수 있는 자리입니다. 다른 곳에도 놓을 수 있습니다.'); }
    }
    d.copy = event.altKey; d.to = locate(event.clientX, event.clientY, d.offset);
    // 같은 칸 위에서는 다시 계산하지 않는다 — 놓기 전 겹침 미리 보기는 칸이 바뀔 때만.
    const seen = d.to ? `${d.to.day}|${d.to.teacher}|${d.to.start}|${d.copy}` : '';
    if (seen !== d.seen) {
      d.seen = seen;
      setHover(d.to ? { ...d.to, duration: d.lesson.end - d.lesson.start, copy: d.copy, preview: previewMove(current, d.ids, d.lesson.id, d.to, d.copy, d.known ??= issueKeys(current)) } : null);
    }
    const rect = root.getBoundingClientRect();
    if (event.clientX > rect.right - 35) root.scrollBy(18, 0);
    if (event.clientX < rect.left + 70) root.scrollBy(-18, 0);
    if (event.clientY > rect.bottom - 30) root.scrollBy(0, 15);
    if (event.clientY < rect.top + 75) root.scrollBy(0, -15);
  }
  function up() {
    const d = drag.current; clear();
    if (!d?.moved) return;
    if (d.kind === 'area') {
      if (!d.marquee) { o.actions?.openAdd({ teacher: d.lane.dataset.lane, day: d.lane.dataset.day, start: d.start, end: d.end }); return; }
      const left = Math.min(d.x, d.cx), right = Math.max(d.x, d.cx), top = Math.min(d.y, d.cy), bottom = Math.max(d.y, d.cy);
      const hit = [...o.root.current?.querySelectorAll<HTMLElement>('[data-block-id]') ?? []].filter(el => {
        const box = el.getBoundingClientRect(); return box.left < right && left < box.right && box.top < bottom && top < box.bottom;
      }).map(el => el.dataset.blockId!);
      o.select(d.add ? [...new Set([...o.selected, ...hit])] : hit);
      o.announce(hit.length ? `네모 안의 수업 ${hit.length}개를 골랐습니다. 함께 옮기거나 아래 도구줄로 한꺼번에 바꿀 수 있습니다.` : '네모 안에 수업이 없습니다.');
      return;
    }
    if (d.revision !== o.store.getSnapshot().revision) { o.announce('끌던 중 시간표가 바뀌었습니다. 수업을 다시 선택해 주세요.'); return; }
    if (d.kind === 'resize') {
      o.apply('수업 길이 변경', current => resizeLesson(current, d.lesson.id, d.start, d.end), `${timeLabel(d.start)}~${timeLabel(d.end)}, ${d.end - d.start}분으로 바꿨습니다.`);
      return;
    }
    const to = d.to; if (!to) return;
    if (d.copy) {
      const before = new Set(o.store.getSnapshot().draft.placements.map(p => p.id));
      if (o.apply('수업 복제', current => copyBlocks(current, lessons(current).items.filter(p => d.ids.includes(p.id)), d.lesson.id, to), '수업을 복제해 놓았습니다. 원래 수업은 그대로입니다.')) {
        o.select(o.store.getSnapshot().draft.placements.filter(p => !before.has(p.id)).map(p => p.id)); o.setCursor(to);
      }
      return;
    }
    try { o.store.commit('수업 이동', moveBlocks(o.store.getSnapshot().draft, d.ids, d.lesson.id, to)); o.setCursor(to); o.announce('수업을 옮겼습니다. 통합뷰에도 함께 반영됩니다.'); }
    catch (error) { o.announce(reasonOf(error, '이동할 위치를 확인하세요.')); }
  }
  return { hover, resizing, drawing, marquee, free, locate, down, grip, laneDown, move, up, clear };
}
