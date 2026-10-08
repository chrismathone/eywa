import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { labelsOf, lessons, timeLabel } from './model';
import { schoolGradeLabel } from '@/lib/format/school-grade';
import { conflictNotes } from './insights';
import type { DraftStore } from './store';

/** 위임 이벤트 하나로 두 격자에 같은 정보 팝업을 제공한다. 네이티브 title과 겹치지 않는다. */
export function LessonTooltip({ store }: { store: DraftStore }) {
  const host = useRef<HTMLDivElement>(null), popup = useRef<HTMLDivElement>(null), id = useId();
  const [active, setActive] = useState<{ anchor: HTMLElement; box: DOMRect; root: DOMRect } | null>(null);
  const anchor = active?.anchor;
  const { draft } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const items = useMemo(() => new Map(lessons(draft).items.map(item => [item.id, item])), [draft]);
  const conflicts = useMemo(() => conflictNotes(draft), [draft]);
  const item = items.get(anchor?.dataset.blockId ?? anchor?.dataset.integratedId ?? '');
  useEffect(() => {
    const workspace = host.current?.closest('.timetable-workspace');
    if (!workspace) return;
    const block = (target: EventTarget | null) => { const element = target instanceof Element ? target.closest<HTMLElement>('[data-block-id], [data-integrated-id]') : null; return element?.dataset.tooltipDisabled ? null : element; };
    const enter = (event: Event) => { if (event instanceof PointerEvent && event.buttons) return; const anchor = block(event.target); setActive(anchor ? { anchor, box: anchor.getBoundingClientRect(), root: workspace.getBoundingClientRect() } : null); };
    const leave = (event: Event) => { const related = event instanceof PointerEvent || event instanceof FocusEvent ? event.relatedTarget : null; if (block(related) !== block(event.target)) setActive(null); };
    const hide = () => setActive(null);
    const key = (event: Event) => { if (event instanceof KeyboardEvent && event.key === 'Escape') hide(); };
    workspace.addEventListener('pointerover', enter); workspace.addEventListener('pointerout', leave);
    workspace.addEventListener('focusin', enter); workspace.addEventListener('focusout', leave);
    workspace.addEventListener('pointerdown', hide); workspace.addEventListener('scroll', hide, true); workspace.addEventListener('keydown', key);
    window.addEventListener('resize', hide);
    return () => { workspace.removeEventListener('pointerover', enter); workspace.removeEventListener('pointerout', leave); workspace.removeEventListener('focusin', enter); workspace.removeEventListener('focusout', leave); workspace.removeEventListener('pointerdown', hide); workspace.removeEventListener('scroll', hide, true); workspace.removeEventListener('keydown', key); window.removeEventListener('resize', hide); };
  }, []);
  useLayoutEffect(() => {
    const element = popup.current;
    if (!anchor || !item || !element) return;
    const previous = anchor.getAttribute('aria-describedby');
    anchor.setAttribute('aria-describedby', [previous, id].filter(Boolean).join(' '));
    element.showPopover?.();
    const bounds = element.getBoundingClientRect();
    if (bounds.bottom > window.innerHeight - 8 || bounds.top < 8) {
      element.style.bottom = 'auto';
      element.style.top = `${Math.max(8, Math.min(active!.box.top - bounds.height - 8, window.innerHeight - bounds.height - 8))}px`;
    }
    return () => { element.hidePopover?.(); if (previous) anchor.setAttribute('aria-describedby', previous); else anchor.removeAttribute('aria-describedby'); };
  }, [active, anchor, item, id]);
  const box = active?.box, root = active?.root;
  const width = Math.min(320, (root?.width ?? 336) - 16), below = (box?.bottom ?? 0) < window.innerHeight - 240;
  const left = Math.max((root?.left ?? 0) + 8, Math.min(box?.left ?? 8, window.innerWidth - width - 8));
  const names = labelsOf(draft);
  return <div ref={host}>{item && box && <div ref={popup} id={id} role="tooltip" popover="manual" className="lesson-tooltip" style={{ width, left, ...(below ? { top: box.bottom + 8 } : { bottom: window.innerHeight - box.top + 8 }) }}>
    <strong>{item.name}</strong>
    <dl><dt>수업 시간</dt><dd>{item.day} {timeLabel(item.start)}~{timeLabel(item.end)}</dd><dt>강사</dt><dd>{item.teacher}</dd><dt>강의실</dt><dd>{item.room || '미정'}{item.labSeparate ? ' · 별도 LAB' : ''}</dd><dt>학생</dt><dd>{item.students.length}명</dd></dl>
    {item.students.length > 0 && <p>{item.students.slice(0, 6).map(student => `${names[student] ?? '이름 미확인'} ${schoolGradeLabel(draft.studentDetails?.[student]?.school, draft.studentDetails?.[student]?.grade)}`).join(' · ')}{item.students.length > 6 ? ' …' : ''}</p>}
    {item.note && <p className="tooltip-note">{item.note}</p>}
    {conflicts.get(item.id)?.slice(0,3).map(note => <p key={note} className="tooltip-conflict">겹침: {note}</p>)}
    {(conflicts.get(item.id)?.length ?? 0) > 3 && <small>겹침 {conflicts.get(item.id)!.length}건 · 배치 확인에서 전체 보기</small>}
    {item.locked && <small>잠근 수업</small>}
  </div>}</div>;
}
