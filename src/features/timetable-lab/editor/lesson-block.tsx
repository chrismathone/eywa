import type { CSSProperties, MouseEvent, PointerEvent } from 'react';
import { timeLabel, type Lesson } from './model';

type View = { style: CSSProperties; displayOffset: number; start: number; end: number };
type State = { selected: boolean; /** 무엇과 왜 겹치는지 — 겹침이 없으면 비어 있다. */ conflicts?: string[]; blocked: boolean; resizing: boolean; trail: string };
type Handlers = { down: (e: PointerEvent<HTMLElement>, p: Lesson) => void; grip: (e: PointerEvent<HTMLElement>, p: Lesson, edge: 'start' | 'end') => void;
  context: (e: MouseEvent, p: Lesson) => void; details: () => void; choose: (p: Lesson) => void };

/** 겹친 수업의 설명 뒤에 붙이는 줄 — 마우스를 올리면 무엇과 왜 겹치는지 보인다. */
export const conflictLines = (notes?: string[]) => (notes ?? []).map(note => `\n겹침: ${note}`).join('');
/** 강사뷰의 수업 한 칸. 몸통을 잡으면 옮기고, 위·아래 끝을 잡으면 길이를 바꾼다. */
export function LessonBlock({ p, view, state, on, readOnly }: { p: Lesson; view: View; state: State; on: Handlers; readOnly: boolean }) {
  const conflicted = !!state.conflicts?.length;
  return <button type="button" data-block-id={p.id} data-display-offset={view.displayOffset} aria-pressed={state.selected} aria-label={`${p.name} ${p.day} ${timeLabel(p.start)} ${p.teacher}`}
    title={`${p.name} · ${p.day} ${timeLabel(view.start)}–${timeLabel(view.end)} · ${p.room || '강의실 미정'} · ${p.students.length}명${p.locked ? ' · 잠금' : ''}${p.note ? ` · 메모: ${p.note}` : ''}${conflictLines(state.conflicts)}`}
    className={`lesson-block ${state.selected ? 'is-selected' : ''} ${conflicted ? 'has-conflict' : ''} ${state.blocked ? 'is-blocked' : ''} ${state.trail}`} style={view.style}
    onPointerDown={e => on.down(e, p)} onDoubleClick={on.details} onContextMenu={e => on.context(e, p)} onClick={e => { if (e.detail === 0) on.choose(p); }}>
    {!readOnly && <i className="grip grip-start" aria-hidden="true" onPointerDown={e => on.grip(e, p, 'start')} />}
    {view.displayOffset > 0 && <i className="off-axis" aria-label={`실제 시작 ${timeLabel(p.start)}`} />}
    <strong>{p.name}</strong><span>{p.labSeparate ? '*LAB' : p.room}</span>
    {state.resizing && <em className="resize-time">{timeLabel(view.start)}~{timeLabel(view.end)}</em>}
    {p.locked && <i className="lock-mark" aria-label="잠근 수업" />}{p.note && <i className="note-mark" aria-label="메모 있음" />}
    {conflicted && <b className="conflict-dot" aria-label="겹침 있음">!</b>}
    {!readOnly && <i className="grip grip-end" aria-hidden="true" onPointerDown={e => on.grip(e, p, 'end')} />}
  </button>;
}
