import { useCallback, useEffect, useRef, type PointerEvent, type RefObject } from 'react';
import { moveClassStudent } from './class-commands';
import type { DraftStore } from './store';
type Drag = { student: string; name: string; from: string; x: number; y: number; currentX: number; currentY: number; revision: number; moved: boolean; to: string | null };
/** Only the floating label/drop outline changes during drag; the roster board does not rerender. */
export function useRosterDrag(store: DraftStore, announce: (text: string) => void, root: RefObject<HTMLDivElement | null>, ghost: RefObject<HTMLDivElement | null>) {
  const drag = useRef<Drag | null>(null), suppressClick = useRef(false), frame = useRef<number | null>(null), highlighted = useRef<HTMLElement | null>(null);
  const cancel = useCallback(() => {
    drag.current = null; if (ghost.current) ghost.current.hidden = true;
    highlighted.current?.removeAttribute('data-student-drop'); highlighted.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null;
  }, [ghost]);
  function locate(x: number, y: number) {
    const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-class-id]');
    const el = hit && root.current?.contains(hit) ? hit : null;
    if (el !== highlighted.current) {
      highlighted.current?.removeAttribute('data-student-drop'); el?.setAttribute('data-student-drop', 'true'); highlighted.current = el;
    }
    return el?.dataset.classId ?? null;
  }
  function scroll() {
    const d = drag.current, el = root.current; if (!d?.moved || !el) { frame.current = null; return; }
    const box = el.getBoundingClientRect(), x = d.currentX, y = d.currentY;
    const dx = x > box.right - 35 ? 12 : x < box.left + 35 ? -12 : 0, dy = y > box.bottom - 30 ? 10 : y < box.top + 30 ? -10 : 0;
    if (dx || dy) { el.scrollBy(dx, dy); d.to = locate(x, y); }
    frame.current = requestAnimationFrame(scroll);
  }
  useEffect(() => {
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel(); };
    window.addEventListener('keydown', escape); window.addEventListener('blur', cancel);
    return () => { cancel(); window.removeEventListener('keydown', escape); window.removeEventListener('blur', cancel); };
  }, [cancel]);
  function down(e: PointerEvent, student: string, name: string, from: string) {
    if (e.button !== 0) return;
    suppressClick.current = false;
    drag.current = { student, name, from, x: e.clientX, y: e.clientY, currentX: e.clientX, currentY: e.clientY, revision: store.getSnapshot().revision, moved: false, to: null };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    const d = drag.current; if (!d || !d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
    d.moved = true; suppressClick.current = true; d.currentX = e.clientX; d.currentY = e.clientY; d.to = locate(e.clientX, e.clientY);
    if (ghost.current) {
      ghost.current.hidden = false; ghost.current.textContent = `${d.name} · 다른 반에 놓아 주세요`;
      ghost.current.style.left = `${e.clientX + 14}px`; ghost.current.style.top = `${e.clientY + 14}px`;
    }
    if (frame.current === null) frame.current = requestAnimationFrame(scroll);
  }
  function up() {
    const d = drag.current; cancel(); if (!d?.moved || !d.to || d.from === d.to) return;
    const current = store.getSnapshot();
    if (current.revision !== d.revision) { announce('학생을 끄는 동안 시간표가 바뀌었습니다. 다시 옮겨 주세요.'); return; }
    try { store.commit('학생을 다른 반으로 이동', moveClassStudent(current.draft, d.student, d.from, d.to)); announce(`${d.name} 학생을 옮긴 반의 모든 수업에 배정했습니다. 겹치는 수업이 있는지 확인해 주세요.`); }
    catch (error) { announce(error instanceof Error ? error.message : '옮길 반을 확인해 주세요.'); }
  }
  return { down, move, up, cancel, click: () => { const suppressed = suppressClick.current; suppressClick.current = false; return !suppressed; } };
}
