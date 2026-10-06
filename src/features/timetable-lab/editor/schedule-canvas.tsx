import { useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react';
import { reasonOf } from './reason';
import { labelsOf, lessons, timeLabel, type Draft, type Lesson } from './model';
import type { Position } from './block-commands';
import { useBlockClipboard } from './block-clipboard';
import { appearanceOf, lessonTone, teacherTone, paint } from './appearance';
import { teacherLayout } from './teacher-layout';
import type { DraftStore } from './store';
import type { EditorActions } from './editor-actions';
import { blockMenu, slotMenu, teacherMenu } from './menus';
import { isAllowedTime } from './operating-times';
import { useCanvasDrag } from './canvas-drag';
import { canvasKey } from './canvas-keys';
import { laneKey } from './free-slots';
import { LessonBlock } from './lesson-block';
import { conflictNotes } from './insights';
import { useTeacherDrag } from './teacher-drag';

type Props = { store: DraftStore; selected: string[]; select: (ids: string[]) => void;
  details: () => void; announce: (s: string) => void; zoom: number; search: string; readOnly?: boolean;
  /** 추가 창·우클릭 메뉴 같은 편집 동작. 읽기 전용 비교 화면에서는 주지 않는다. */ actions?: EditorActions;
  /** 동선을 강조할 학생. */ focus?: string | null };

export function ScheduleCanvas({ store, selected, select, details, announce, zoom, search, readOnly = false, actions, focus = null }: Props) {
  const { draft } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const root = useRef<HTMLDivElement>(null), dropLine = useRef<HTMLDivElement>(null), columnGhost = useRef<HTMLDivElement>(null), [cursor, setCursor] = useState<Position | null>(null);
  const all = useMemo(() => lessons(draft).items, [draft]), people = labelsOf(draft), appearance = appearanceOf(draft);
  const conflicts = useMemo(() => conflictNotes(draft), [draft]);
  const grid = useMemo(() => teacherLayout(draft, all, zoom), [draft, all, zoom]);
  const { teachers, lanes, min, max, step, unit, height } = grid;
  const visible = useMemo(() => new Set(all.filter(p => !search || `${p.name} ${p.teacher} ${p.students.map(id => people[id]).join(' ')}`.includes(search)).map(p => p.id)), [all, people, search]);
  const clipboard = useBlockClipboard(store, selected, cursor, announce);

  /** 변경을 적용하고 결과를 알린다. 실패하면 이유를 알리고 연습본은 그대로 둔다. */
  function apply(label: string, change: (draft: Draft) => Draft, done?: string) {
    try { store.commit(label, change(store.getSnapshot().draft)); if (done) announce(done); return true; }
    catch (error) { announce(reasonOf(error, '바꿀 수 없습니다. 선택을 확인해 주세요.')); return false; }
  }
  const drag = useCanvasDrag({ store, root, grid, selected, select, setCursor, announce, apply, actions, readOnly });
  const { hover, resizing, drawing, marquee, free } = drag;
  const columns = useTeacherDrag({ root, line: dropLine, ghost: columnGhost, draft: () => store.getSnapshot().draft, apply, announce });
  const reset = () => { clipboard.cancel(); drag.clear(); select([]); actions?.focusStudent(null); };
  function blockContext(event: MouseEvent, p: Lesson) {
    if (!actions) return;
    event.preventDefault(); event.stopPropagation(); root.current?.focus();
    const ids = selected.includes(p.id) ? selected : [p.id];
    select(ids); actions.openMenu(event, ids.length > 1 ? `수업 ${ids.length}개` : `${p.name} · ${p.day} ${timeLabel(p.start)}`, blockMenu(draft, p, ids, actions));
  }
  function slotContext(event: MouseEvent) {
    if (!actions || event.target !== event.currentTarget) return;
    const at = drag.locate(event.clientX, event.clientY); if (!at) return;
    event.preventDefault(); root.current?.focus(); setCursor(at);
    actions.openMenu(event, `${at.teacher} · ${at.day} ${timeLabel(at.start)}`, slotMenu(at, actions));
  }
  const top = (minute: number) => (minute - min) / step * unit;
  const handlers = { down: drag.down, grip: drag.grip, context: blockContext, details, choose: (p: Lesson) => { select([p.id]); details(); } };
  const hoverTone = hover ? !hover.preview.ok ? 'is-blocked' : hover.preview.added ? 'has-clash' : 'is-clear' : '';
  return <div className="schedule-scroll" ref={root} tabIndex={0} role="region" aria-label="시간표 편집 영역"
    onPointerMove={drag.move} onPointerUp={drag.up} onPointerCancel={drag.clear}
    onKeyDown={e => { if (!readOnly) canvasKey(e, { store, all, lanes, min, max, step, selected, visible, cursor, setCursor, select, details, actions, apply, reset }); }}
    onCopy={e => { if (!readOnly) clipboard.copy(e, false); }} onCut={e => { if (!readOnly) clipboard.copy(e, true); }} onPaste={e => { if (!readOnly) clipboard.paste(e); }}>
    <div className="teacher-week-grid" style={{ gridTemplateColumns: `56px ${lanes.map(l => `${l.width}px`).join(' ')}` }}>
      <div className="week-time-heading">시간</div>{teachers.map(t => {
        const label = <>{t}{appearance.teacherNicknames[t] && `(${appearance.teacherNicknames[t]})`}</>;
        const style = { gridColumn: `span ${lanes.filter(l => l.teacher === t).length}`, ...paint(teacherTone(draft, t)) };
        return actions && !readOnly ? <button type="button" className="week-teacher-heading" key={t} style={style} title={`${t} · 눌러서 열 메뉴 열기 · 끌어서 열을 통째로 옮기기`} aria-haspopup="menu"
          data-teacher-column={t} onPointerDown={e => columns.down(e, t)} onPointerMove={columns.move} onPointerUp={columns.up} onPointerCancel={columns.cancel} onLostPointerCapture={columns.cancel}
          onClick={e => { if (columns.click()) actions.openMenu(e, `${t} 강사 열`, teacherMenu(draft, t, actions)); }}
          onContextMenu={e => { e.preventDefault(); actions.openMenu(e, `${t} 강사 열`, teacherMenu(draft, t, actions)); }}>{label}</button>
          : <div className="week-teacher-heading" key={t} style={style}>{label}</div>;
      })}
      {lanes.map((l, i) => <div className={`week-day-heading ${i === 0 || lanes[i - 1].teacher !== l.teacher ? 'teacher-start' : ''}`} key={`${l.teacher}-${l.day}`} style={{ gridRow: 2, gridColumn: i + 2 }}>{l.day}</div>)}
      {/* 눈금은 두 칸마다, 그리고 맨 끝(마지막 수업이 끝나는 시각)에 하나 더 — 끝 눈금에 글자가 닿을 만큼 가까운 눈금(16px 안)만 뺀다. */}
      <div className="time-axis" style={{ height, gridRow: 3 }}>{[...grid.rows.filter((r, i) => i % 2 === 0 && top(max) - top(r.startMin) >= 16).map(r => r.startMin), max].map(m => <span key={m} style={{ top: top(m) }}>{timeLabel(m)}</span>)}</div>
      {lanes.map((lane, index) => <div key={`${lane.teacher}-${lane.day}`} className={`schedule-lane ${index === 0 || lanes[index - 1].teacher !== lane.teacher ? 'teacher-start' : ''}`}
        data-lane={lane.teacher} data-day={lane.day} style={{ height, gridRow: 3, backgroundSize: `100% ${unit}px` }} onPointerDown={drag.laneDown}
        onDoubleClick={e => { if (actions && !readOnly && e.target === e.currentTarget) { const at = drag.locate(e.clientX, e.clientY); if (at) actions.openAdd(at); } }}
        onContextMenu={slotContext}>
        {free?.get(laneKey(lane.teacher, lane.day))?.filter(b => b.end > min && b.start < max).map(b => <i key={b.start} className="free-band"
          style={{ top: top(Math.max(min, b.start)), height: top(Math.min(max, b.end)) - top(Math.max(min, b.start)) }} />)}
        {!appearance.excludedTeachers.includes(lane.teacher) && appearance.sectionLines.filter(m => m >= min && m < max).map(m => <i key={m} className="period-rule" style={{ top: top(m) }} />)}
        {lane.breaks.map(b => <div className="teacher-break" key={b.startMin} style={{ top: b.index * unit, height: b.span * unit }}>쉬는 시간</div>)}
        {cursor?.teacher === lane.teacher && cursor.day === lane.day && <div className="slot-cursor" style={{ top: top(cursor.start + (cursor.start < min ? lane.offset : 0)), height: unit }}><span>{timeLabel(cursor.start)}</span></div>}
        {lane.items.filter(p => visible.has(p.id)).map(p => {
          const { width, left } = lane.layout.get(p.id)!, displayOffset = lane.offsets.get(p.id)!, sized = resizing?.id === p.id ? resizing : p;
          return <LessonBlock key={p.id} p={p} readOnly={readOnly} on={handlers}
            view={{ displayOffset, start: sized.start, end: sized.end, style: { ...paint(lessonTone(draft, p)), top: top(sized.start + displayOffset),
              height: Math.max(unit, (sized.end - sized.start) / step * unit), left: `${left}%`, width: `${width}%` } }}
            state={{ selected: selected.includes(p.id), conflicts: conflicts.get(p.id), resizing: resizing?.id === p.id,
              blocked: resizing?.id === p.id && !isAllowedTime(draft, p.kind, p.day, sized.start, sized.end), trail: focus ? p.students.includes(focus) ? 'is-trail' : 'is-dim' : '' }} />;
        })}
        {drawing?.teacher === lane.teacher && drawing.day === lane.day && <div className="drag-preview draw-preview" style={{ top: top(drawing.start), height: (drawing.end - drawing.start) / step * unit }}>
          새 수업 · {timeLabel(drawing.start)}~{timeLabel(drawing.end)} · {drawing.end - drawing.start}분</div>}
        {hover?.teacher === lane.teacher && hover.day === lane.day && <div className={`drag-preview ${hoverTone}`} title={hover.preview.reason}
          style={{ top: top(hover.start + (hover.start < min ? lane.offset : 0)), height: hover.duration / step * unit }}>
          {hover.copy ? '복제 · ' : ''}{timeLabel(hover.start)}{!hover.preview.ok ? ' · 놓을 수 없음' : hover.preview.added ? ` · 겹침 ${hover.preview.added}` : ''}</div>}
      </div>)}
      {marquee && <div className="marquee" style={marquee} />}
      <div ref={dropLine} className="column-drop-line" hidden aria-hidden="true" />
    </div>
    <div ref={columnGhost} className="roster-drag-ghost" hidden aria-hidden="true" />
    {hover && hover.preview.reason && <div className="drag-reason" role="status">{hover.preview.reason}</div>}
  </div>;
}
