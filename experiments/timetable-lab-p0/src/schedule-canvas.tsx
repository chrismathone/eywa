import { useMemo, useRef, useState, useSyncExternalStore, type PointerEvent, type KeyboardEvent } from 'react';
import { labelsOf, lessons, timeLabel, type Lesson } from './model';
import { moveBlocks, removeBlocks, type Position } from './block-commands';
import { useBlockClipboard } from './block-clipboard';
import { validate } from './constraints';
import { appearanceOf, lessonTone, teacherTone, paint } from './appearance';
import { teacherLayout } from './teacher-layout';
import type { DraftStore } from './store';
type Props = { store: DraftStore; selected: string[]; select: (ids: string[]) => void;
  details: () => void; announce: (s: string) => void; zoom: number; search: string; readOnly?: boolean };
type Drag = { lesson: Lesson; ids: string[]; x: number; y: number; offset: number; displayOffset: number; revision: number; moved: boolean; to: Position | null };
export function ScheduleCanvas({ store, selected, select, details, announce, zoom, search, readOnly = false }: Props) {
  const { draft } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const root = useRef<HTMLDivElement>(null), drag = useRef<Drag | null>(null);
  const [hover, setHover] = useState<(Position & { duration: number }) | null>(null), [cursor, setCursor] = useState<Position | null>(null);
  const all = useMemo(() => lessons(draft).items, [draft]), people = labelsOf(draft), appearance = appearanceOf(draft);
  const conflicted = useMemo(() => new Set(validate(draft).issues.flatMap(i => i.placementIds)), [draft]);
  const grid = useMemo(() => teacherLayout(draft, all, zoom), [draft, all, zoom]);
  const { teachers, lanes, min, max, step, unit, height } = grid;
  const visible = useMemo(() => new Set(all.filter(p => !search || `${p.name} ${p.teacher} ${p.students.map(id => people[id]).join(' ')}`.includes(search)).map(p => p.id)), [all, people, search]);
  const clipboard = useBlockClipboard(store, selected, cursor, announce);
  function locate(x: number, y: number, grab = 0): Position | null {
    const hit = document.elementFromPoint(x, y), lane = hit?.closest<HTMLElement>('[data-lane]');
    if (!lane || !root.current?.contains(lane)) return null;
    const visualStart = min + Math.round((y - lane.getBoundingClientRect().top - grab) / unit) * step;
    const moving = drag.current;
    // Morning blocks share visual coordinates with afternoon blocks. Preserve the dragged
    // block's own clock within its lane; another block carries its explicit offset on drop.
    const offset = moving && moving.lesson.teacher === lane.dataset.lane && moving.lesson.day === lane.dataset.day
      ? moving.displayOffset : Number(hit?.closest<HTMLElement>('[data-display-offset]')?.dataset.displayOffset ?? 0);
    return { day: lane.dataset.day!, teacher: lane.dataset.lane!, start: Math.max(0, Math.min(1439 - step, visualStart - offset)) };
  }
  function down(event: PointerEvent, lesson: Lesson) {
    if (readOnly || event.button !== 0) return;
    event.preventDefault(); root.current?.focus();
    const ids = event.ctrlKey || event.metaKey ? (selected.includes(lesson.id) ? selected.filter(id => id !== lesson.id) : [...selected, lesson.id]) : selected.includes(lesson.id) ? selected : [lesson.id];
    select(ids); setCursor({ day: lesson.day, start: lesson.start, teacher: lesson.teacher });
    const lane = event.currentTarget.closest<HTMLElement>('[data-lane]')!;
    drag.current = ids.includes(lesson.id) ? { lesson, ids, x: event.clientX, y: event.clientY,
      displayOffset: Number((event.currentTarget as HTMLElement).dataset.displayOffset),
      offset: event.clientY - lane.getBoundingClientRect().top - (lesson.start + Number((event.currentTarget as HTMLElement).dataset.displayOffset) - min) / step * unit,
      revision: store.getSnapshot().revision, moved: false, to: null } : null;
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent) {
    const d = drag.current; if (!d || (Math.hypot(event.clientX - d.x, event.clientY - d.y) < 6 && !d.moved)) return;
    d.moved = true; d.to = locate(event.clientX, event.clientY, d.offset);
    setHover(d.to ? { ...d.to, duration: d.lesson.end - d.lesson.start } : null);
    const rect = root.current!.getBoundingClientRect();
    if (event.clientX > rect.right - 35) root.current!.scrollLeft += 18;
    if (event.clientX < rect.left + 70) root.current!.scrollLeft -= 18;
    if (event.clientY > rect.bottom - 30) root.current!.scrollTop += 15;
    if (event.clientY < rect.top + 75) root.current!.scrollTop -= 15;
  }
  function up() {
    const d = drag.current; drag.current = null; setHover(null);
    if (!d?.moved || !d.to) return;
    if (d.revision !== store.getSnapshot().revision) { announce('끌던 중 시간표가 바뀌었습니다. 수업을 다시 선택해 주세요.'); return; }
    try { store.commit('수업 이동', moveBlocks(store.getSnapshot().draft, d.ids, d.lesson.id, d.to)); setCursor(d.to); announce('수업을 옮겼습니다. 통합뷰에도 함께 반영됩니다.'); }
    catch (error) { announce(error instanceof Error ? error.message : '이동할 위치를 확인하세요.'); }
  }
  function key(event: KeyboardEvent) {
    if (readOnly) return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const mod = event.ctrlKey || event.metaKey, k = event.key.toLowerCase();
    if (mod && ['c', 'v', 'x'].includes(k)) return;
    if (mod && ['z', 'y'].includes(k)) { event.preventDefault(); (k === 'y' || event.shiftKey ? store.redo : store.undo)(); return; }
    if (mod && k === 'a') { event.preventDefault(); select([...visible]); return; }
    if (k === 'escape') { clipboard.cancel(); drag.current = null; setHover(null); select([]); return; }
    if ((k === 'delete' || k === 'backspace') && selected.length) { event.preventDefault(); store.commit('수업 배치 지우기', removeBlocks(draft, selected)); select([]); return; }
    if (k === 'enter' && selected.length) { event.preventDefault(); details(); return; }
    if (k.startsWith('arrow') && lanes.length) {
      event.preventDefault(); const at = cursor ?? { day: lanes[0].day, teacher: lanes[0].teacher, start: min - lanes[0].offset };
      const index = Math.max(0, lanes.findIndex(l => l.teacher === at.teacher && l.day === at.day));
      const lane = lanes[Math.max(0, Math.min(lanes.length - 1, index + (k === 'arrowright' ? 1 : k === 'arrowleft' ? -1 : 0)))];
      setCursor({ day: lane.day, teacher: lane.teacher, start: Math.max(0, Math.min(max - step - lane.offset,
        at.start + (k === 'arrowdown' ? step : k === 'arrowup' ? -step : 0))) });
    }
  }
  return <div className="schedule-scroll" ref={root} tabIndex={0} role="region" aria-label="시간표 편집 영역"
    onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; setHover(null); }}
    onKeyDown={key} onCopy={e => { if (!readOnly) clipboard.copy(e, false); }} onCut={e => { if (!readOnly) clipboard.copy(e, true); }} onPaste={e => { if (!readOnly) clipboard.paste(e); }}>
    <div className="teacher-week-grid" style={{ gridTemplateColumns: `56px ${lanes.map(l => `${l.width}px`).join(' ')}` }}>
      <div className="week-time-heading">시간</div>{teachers.map(t => <div className="week-teacher-heading" key={t}
        style={{ gridColumn: `span ${lanes.filter(l => l.teacher === t).length}`, ...paint(teacherTone(draft, t)) }}>{t}{appearance.teacherNicknames[t] && `(${appearance.teacherNicknames[t]})`}</div>)}
      {lanes.map((l, i) => <div className={`week-day-heading ${i === 0 || lanes[i - 1].teacher !== l.teacher ? 'teacher-start' : ''}`} key={`${l.teacher}-${l.day}`} style={{ gridRow: 2, gridColumn: i + 2 }}>{l.day}</div>)}
      <div className="time-axis" style={{ height, gridRow: 3 }}>{grid.rows.filter((_, i) => i % 2 === 0).map(r => <span key={r.startMin} style={{ top: (r.startMin - min) / step * unit }}>{timeLabel(r.startMin)}</span>)}</div>
      {lanes.map((lane, index) => <div key={`${lane.teacher}-${lane.day}`} className={`schedule-lane ${index === 0 || lanes[index - 1].teacher !== lane.teacher ? 'teacher-start' : ''}`}
        data-lane={lane.teacher} data-day={lane.day} style={{ height, gridRow: 3, backgroundSize: `100% ${unit}px` }}
        onPointerDown={e => { if (!readOnly && e.target === e.currentTarget) { root.current?.focus(); setCursor(locate(e.clientX, e.clientY)); } }}>
        {!appearance.excludedTeachers.includes(lane.teacher) && appearance.sectionLines.filter(m => m >= min && m < max).map(m => <i key={m} className="period-rule" style={{ top: (m - min) / step * unit }} />)}
        {lane.breaks.map(b => <div className="teacher-break" key={b.startMin} style={{ top: b.index * unit, height: b.span * unit }}>쉬는 시간</div>)}
        {cursor?.teacher === lane.teacher && cursor.day === lane.day && <div className="slot-cursor" style={{ top: (cursor.start + (cursor.start < min ? lane.offset : 0) - min) / step * unit, height: unit }}><span>{timeLabel(cursor.start)}</span></div>}
        {lane.items.filter(p => visible.has(p.id)).map(p => {
          const { width, left } = lane.layout.get(p.id)!;
          const displayOffset = lane.offsets.get(p.id)!;
          return <button key={p.id} type="button" data-block-id={p.id} data-display-offset={displayOffset} aria-pressed={selected.includes(p.id)} aria-label={`${p.name} ${p.day} ${timeLabel(p.start)} ${p.teacher}`}
            title={`${p.name} · ${p.day} ${timeLabel(p.start)}–${timeLabel(p.end)} · ${p.room || '강의실 미정'} · ${p.students.length}명`}
            className={`lesson-block ${selected.includes(p.id) ? 'is-selected' : ''} ${conflicted.has(p.id) ? 'has-conflict' : ''}`}
            style={{ ...paint(lessonTone(draft, p)), top: (p.start + displayOffset - min) / step * unit, height: Math.max(unit, (p.end - p.start) / step * unit), left: `${left}%`, width: `${width}%` }}
            onPointerDown={e => down(e, p)} onDoubleClick={details} onClick={e => { if (e.detail === 0) { select([p.id]); details(); } }}>
            {displayOffset > 0 && <i className="off-axis" aria-label={`실제 시작 ${timeLabel(p.start)}`} />}
            <strong>{p.name}</strong><span>{p.labSeparate ? '*LAB' : p.room}</span>
            {conflicted.has(p.id) && <b className="conflict-dot" aria-label="겹침 있음">!</b>}
          </button>;
        })}
        {hover?.teacher === lane.teacher && hover.day === lane.day && <div className="drag-preview" style={{ top: (hover.start + (hover.start < min ? lane.offset : 0) - min) / step * unit, height: hover.duration / step * unit }}>{timeLabel(hover.start)}</div>}
      </div>)}
    </div>
  </div>;
}
