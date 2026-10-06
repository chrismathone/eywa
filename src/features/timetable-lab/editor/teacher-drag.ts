import { useCallback, useEffect, useRef, type PointerEvent, type RefObject } from 'react';
import type { Draft } from './model';
import { placeTeacher } from './teachers';

type Drag = { teacher: string; x: number; y: number; cx: number; moved: boolean; before: string | null; /** 잡을 때의 연습본 — 끄는 동안 바뀌면(되돌리기 등) 그만둔다. */ origin: Draft };
type Options = { root: RefObject<HTMLDivElement | null>; line: RefObject<HTMLDivElement | null>; ghost: RefObject<HTMLDivElement | null>;
  draft: () => Draft; apply: (label: string, change: (draft: Draft) => Draft, done?: string) => boolean; /** 다시 그려도 같은 함수여야 한다(바뀌면 끌기가 끊긴다). */ announce: (text: string) => void };
/** 화면 가장자리에서 저절로 미는 구역의 폭(왼쪽은 붙어 있는 시간 열만큼 더 넓다)과, 그쪽으로 이만큼 움직인 뒤에야 민다는 거리. */
const EDGE = { left: 96, right: 40, travel: 24, speed: 14 };

/**
 * 강사 머리를 끌어 그 강사 열을 통째로 옮긴다(요일 칸과 수업이 모두 따라간다).
 * 끄는 동안에는 놓일 자리의 세로선과 따라다니는 이름표만 움직인다 — 시간표는 놓을 때 한 번만 다시 그린다.
 */
export function useTeacherDrag(o: Options) {
  const drag = useRef<Drag | null>(null), suppressClick = useRef(false), frame = useRef<number | null>(null);
  const { root, line, ghost, announce } = o;
  /** 끄는 열(머리와 요일 칸)을 흐리게 하거나 되돌린다. */
  const mark = useCallback((teacher: string | null) => {
    for (const el of root.current?.querySelectorAll<HTMLElement>('[data-teacher-column], [data-lane]') ?? []) {
      if (teacher !== null && (el.dataset.teacherColumn ?? el.dataset.lane) === teacher) el.dataset.columnDrag = 'true'; else delete el.dataset.columnDrag;
    }
  }, [root]);
  /** 끌기를 끝내고 표시를 걷는다. 끌던 것을 돌려준다(없었으면 null). */
  const stop = useCallback(() => {
    const d = drag.current; drag.current = null;
    if (d?.moved) mark(null);
    if (line.current) line.current.hidden = true;
    if (ghost.current) ghost.current.hidden = true;
    if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null;
    return d;
  }, [ghost, line, mark]);
  /** 놓지 않고 그만둔다(Esc · 창을 떠남 · 머리가 포인터를 놓침). */
  const cancel = useCallback(() => { const d = stop(); if (d?.moved) announce(`${d.teacher} 열을 옮기지 않았습니다.`); }, [announce, stop]);
  const STALE = '끄는 동안 시간표가 바뀌어 열을 옮기지 않았습니다. 다시 끌어 주세요.';
  /** 포인터에서 가장 가까운 열 경계를 찾아 세로선을 놓는다. */
  function place(d: Drag) {
    const el = root.current, grid = el?.querySelector('.teacher-week-grid');
    const heads = [...el?.querySelectorAll<HTMLElement>('[data-teacher-column]') ?? []];
    if (!grid || !heads.length) return;
    const boxes = heads.map(h => h.getBoundingClientRect()), at = boxes.findIndex(b => d.cx < b.left + b.width / 2);
    d.before = at < 0 ? null : heads[at].dataset.teacherColumn!;
    if (line.current) { line.current.hidden = false; line.current.style.left = `${(at < 0 ? boxes.at(-1)!.right : boxes[at].left) - grid.getBoundingClientRect().left - 2}px`; }
  }
  function scroll() {
    const d = drag.current, el = root.current; if (!d?.moved || !el) { frame.current = null; return; }
    // 되돌리기로 머리가 사라지거나 자리를 옮기면 머리가 포인터를 놓쳐 ‘놓았다’는 신호가 오지 않는다 — 연습본이 바뀐 것을 여기서 알아채고 걷는다.
    if (o.draft() !== d.origin) { stop(); announce(STALE); return; }
    // 🔴 가장자리 구역 **안에서 잡은** 머리는 그쪽으로 더 움직인 뒤에만 민다 — 잡자마자 밀면 화면이 혼자 달려 열이 엉뚱한 자리에 놓인다.
    const box = el.getBoundingClientRect(), toward = d.cx - d.x;
    //    포인터가 화면 끝에 닿아 있으면 더 움직일 자리가 없으니 거리 조건을 면제한다.
    const dx = d.cx > box.right - EDGE.right && (toward > EDGE.travel || d.cx >= box.right - 2) ? EDGE.speed : d.cx < box.left + EDGE.left && -toward > EDGE.travel ? -EDGE.speed : 0;
    if (dx) { el.scrollBy(dx, 0); place(d); }
    frame.current = requestAnimationFrame(scroll);
  }
  useEffect(() => {
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel(); };
    // 머리가 받는 ‘놓았다’ 신호가 먼저 처리된다 — 여기까지 끌기가 남아 있으면 머리가 포인터를 놓친 것이다.
    // 머리가 사라졌으면 뒤따르는 클릭도 오지 않는다 — 클릭 차례가 지난 뒤 ‘다음 클릭 삼키기’를 내려 둔다.
    const release = () => { cancel(); setTimeout(() => { suppressClick.current = false; }); };
    window.addEventListener('keydown', escape); window.addEventListener('blur', cancel); window.addEventListener('pointerup', release);
    return () => { stop(); window.removeEventListener('keydown', escape); window.removeEventListener('blur', cancel); window.removeEventListener('pointerup', release); };
  }, [cancel, stop]);
  function down(e: PointerEvent<HTMLElement>, teacher: string) {
    suppressClick.current = false;
    // 손가락으로는 화면을 민다(스크롤) — 열 옮기기는 마우스와 펜에서만. 손가락은 열 메뉴의 ‘왼쪽·오른쪽으로 옮기기’를 쓴다.
    if (e.button !== 0 || e.pointerType === 'touch') return;
    drag.current = { teacher, x: e.clientX, y: e.clientY, cx: e.clientX, moved: false, before: teacher, origin: o.draft() };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    const d = drag.current; if (!d) return;
    if (!(e.buttons & 1)) { cancel(); return; }
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
    if (!d.moved) { d.moved = true; suppressClick.current = true; mark(d.teacher); announce(`${d.teacher} 열 옮기는 중 · 파란 선이 놓일 자리 · Esc 취소`); }
    d.cx = e.clientX; place(d);
    if (ghost.current) {
      ghost.current.hidden = false; ghost.current.textContent = `${d.teacher} 열 옮기기`;
      ghost.current.style.left = `${e.clientX + 14}px`; ghost.current.style.top = `${e.clientY + 14}px`;
    }
    if (frame.current === null) frame.current = requestAnimationFrame(scroll);
  }
  function up() {
    const d = stop(); if (!d?.moved) return;
    if (o.draft() !== d.origin) { announce(STALE); return; }
    let same = false;
    try { same = placeTeacher(o.draft(), d.teacher, d.before) === o.draft(); } catch { /* 끄는 동안 열이 사라졌다 — 아래 apply가 이유를 알린다. */ }
    if (same) announce(`${d.teacher} 열을 옮기지 않았습니다.`);
    else o.apply('강사 순서 변경', draft => placeTeacher(draft, d.teacher, d.before), `${d.teacher} 열을 옮겼습니다. Ctrl+Z로 되돌릴 수 있습니다.`);
  }
  /** 끌고 난 직후의 클릭은 열 메뉴를 열지 않는다. */
  const click = () => { const suppressed = suppressClick.current; suppressClick.current = false; return !suppressed; };
  return { down, move, up, cancel, click };
}
