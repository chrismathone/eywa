import { useMemo, useRef, useState, useSyncExternalStore, type PointerEvent, type KeyboardEvent } from 'react';
import { labelsOf, lessons, timeLabel, type Lesson } from './model';
import { moveBlocks, removeBlocks, type Position } from './block-commands';
import { useBlockClipboard } from './block-clipboard';
import { validate } from './constraints';
import { overlapLayout } from './overlap-layout';
import type { DraftStore } from './store';
type Props = { store: DraftStore; day: string; setDay: (day: string) => void; view: 'teacher' | 'integrated';
  selected: string[]; select: (ids: string[]) => void; details: () => void; announce: (s: string) => void; zoom: number; search: string };
type Drag = { lesson: Lesson; ids: string[]; x: number; y: number; offset: number; revision: number; moved: boolean; to: Position | null };
export function ScheduleCanvas({ store, day, setDay, view, selected, select, details, announce, zoom, search }: Props) {
  const { draft } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const root = useRef<HTMLDivElement>(null), drag = useRef<Drag | null>(null);
  const [hover, setHover] = useState<(Position & { duration: number }) | null>(null), [cursor, setCursor] = useState<Position | null>(null);
  const all = useMemo(() => lessons(draft).items, [draft]), people = labelsOf(draft), checks = useMemo(() => validate(draft), [draft]);
  const conflicted = new Set(checks.issues.flatMap(i => i.placementIds));
  const teachers = useMemo(() => [...new Set([...draft.source?.teacherOrder ?? [], ...all.map(p => p.teacher)])].filter(t => all.some(p => p.teacher === t)), [all, draft.source?.teacherOrder]);
  const step = draft.source?.step ?? 10, unit = 18 * zoom, min = Math.max(0, Math.floor(Math.min(900, ...all.map(p => p.start)) / 60) * 60);
  const max = Math.min(1439, Math.ceil(Math.max(1260, ...all.map(p => p.end)) / 60) * 60), height = (max - min) / step * unit;
  const visible = useMemo(() => all.filter(p => p.day === day && (!search || `${p.name} ${p.teacher} ${p.students.map(id => people[id]).join(' ')}`.includes(search))), [all, day, people, search]);
  const clipboard = useBlockClipboard(store, selected, cursor, announce);
  const layouts = useMemo(() => new Map(teachers.flatMap(t => [...overlapLayout(visible.filter(p => p.teacher === t))])), [teachers, visible]);
  function locate(x: number, y: number): Position | null {
    const lane = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-lane]');
    if (!lane) return null;
    return { day, teacher: lane.dataset.lane!, start: Math.max(min, Math.min(max - step, min + Math.floor((y - lane.getBoundingClientRect().top) / unit) * step)) };
  }
  function down(event: PointerEvent, lesson: Lesson) {
    if (event.button !== 0) return;
    event.preventDefault(); root.current?.focus();
    const ids = event.ctrlKey || event.metaKey ? (selected.includes(lesson.id) ? selected.filter(id => id !== lesson.id) : [...selected, lesson.id]) : selected.includes(lesson.id) ? selected : [lesson.id];
    select(ids); setCursor({ day: lesson.day, start: lesson.start, teacher: lesson.teacher });
    const laneTop = event.currentTarget.closest('[data-lane]')!.getBoundingClientRect().top;
    drag.current = ids.includes(lesson.id) ? { lesson, ids, x: event.clientX, y: event.clientY,
      offset: event.clientY - laneTop - (lesson.start - min) / step * unit, revision: store.getSnapshot().revision, moved: false, to: null } : null;
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent) {
    const d = drag.current; if (!d) return;
    if (Math.hypot(event.clientX - d.x, event.clientY - d.y) < 6 && !d.moved) return;
    d.moved = true;
    const lane = locate(event.clientX, event.clientY);
    const dayTarget = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-drop-day]')?.dataset.dropDay;
    const laneTop = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-lane]')?.getBoundingClientRect().top;
    d.to = dayTarget ? { day: dayTarget, teacher: d.lesson.teacher, start: d.lesson.start } : lane && laneTop !== undefined ? { ...lane, start: min + Math.round((event.clientY - laneTop - d.offset) / unit) * step } : null;
    setHover(d.to ? { ...d.to, duration: d.lesson.end - d.lesson.start } : null);
  }
  function up(event: PointerEvent) {
    const d = drag.current; drag.current = null; setHover(null);
    if (root.current?.hasPointerCapture(event.pointerId)) root.current.releasePointerCapture(event.pointerId);
    if (!d?.moved || !d.to) return;
    if (d.revision !== store.getSnapshot().revision) { announce('끌던 중 시간표가 바뀌었습니다. 수업을 다시 선택해 주세요.'); return; }
    try { store.commit('수업 이동', moveBlocks(store.getSnapshot().draft, d.ids, d.lesson.id, d.to)); setDay(d.to.day); setCursor(d.to); announce('수업을 옮겼습니다. 겹침이 있어도 연습할 수 있습니다.'); }
    catch (error) { announce(error instanceof Error ? error.message : '이동할 위치를 확인하세요.'); }
  }
  function key(event: KeyboardEvent) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const mod = event.ctrlKey || event.metaKey, k = event.key.toLowerCase();
    if (mod && ['c', 'v', 'x'].includes(k)) return;
    if (mod && ['z', 'y'].includes(k)) { event.preventDefault(); (k === 'y' || event.shiftKey ? store.redo : store.undo)(); return; }
    if (mod && k === 'a') { event.preventDefault(); select(visible.map(p => p.id)); return; }
    if (k === 'escape') { clipboard.cancel(); drag.current = null; setHover(null); select([]); return; }
    if ((k === 'delete' || k === 'backspace') && selected.length) { event.preventDefault(); store.commit('수업 배치 지우기', removeBlocks(draft, selected)); select([]); return; }
    if (k === 'enter' && selected.length) { event.preventDefault(); details(); return; }
    if (k.startsWith('arrow') && teachers.length) {
      event.preventDefault(); const at = cursor ?? { day, teacher: teachers[0], start: min };
      const index = Math.max(0, teachers.indexOf(at.teacher));
      setCursor({ day, teacher: teachers[Math.max(0, Math.min(teachers.length - 1, index + (k === 'arrowright' ? 1 : k === 'arrowleft' ? -1 : 0)))],
        start: Math.max(min, Math.min(max - step, at.start + (k === 'arrowdown' ? step : k === 'arrowup' ? -step : 0))) });
    }
  }
  return <div className="schedule-scroll" ref={root} tabIndex={0} role="region" aria-label="시간표 편집 영역"
    onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; setHover(null); }}
    onKeyDown={key} onCopy={e => clipboard.copy(e, false)} onCut={e => clipboard.copy(e, true)} onPaste={clipboard.paste}>
    <div className="schedule-grid" style={{ gridTemplateColumns: `56px repeat(${Math.max(teachers.length, 1)}, minmax(${160 * zoom}px, 1fr))` }}>
      <div className="time-heading">{day}요일</div>{teachers.map(t => <div className="teacher-heading" key={t}>{t}<small>{visible.filter(p => p.teacher === t && p.kind !== 'block').length}개 수업</small></div>)}
      <div className="time-axis" style={{ height }}>{Array.from({ length: Math.ceil((max - min) / 60) }, (_, n) => <span key={n} style={{ top: n * 60 / step * unit }}>{timeLabel(min + n * 60)}</span>)}</div>
      {teachers.map(teacher => <div key={teacher} className="schedule-lane" data-lane={teacher} style={{ height, backgroundSize: `100% ${unit}px` }}
        onPointerDown={e => { if (e.target === e.currentTarget) { root.current?.focus(); setCursor(locate(e.clientX, e.clientY)); } }}>
        {cursor?.teacher === teacher && cursor.day === day && <div className="slot-cursor" style={{ top: (cursor.start - min) / step * unit, height: unit }}><span>{timeLabel(cursor.start)}</span></div>}
        {visible.filter(p => p.teacher === teacher).map(p => {
          const { width, left } = layouts.get(p.id)!;
          return <button key={p.id} type="button" data-block-id={p.id} aria-pressed={selected.includes(p.id)} aria-label={`${p.name} ${p.day} ${timeLabel(p.start)} ${p.teacher}`}
            className={`lesson-block ${selected.includes(p.id) ? 'is-selected' : ''} ${conflicted.has(p.id) ? 'has-conflict' : ''} ${p.kind === 'block' ? 'nonlesson' : ''}`}
            style={{ top: (p.start - min) / step * unit + 2, height: Math.max(22, (p.end - p.start) / step * unit - 4), left: `calc(${left}% + 3px)`, width: `calc(${width}% - 6px)` }}
            onPointerDown={e => down(e, p)} onDoubleClick={details} onClick={e => { if (e.detail === 0) { select([p.id]); details(); } }}>
            <strong>{p.name}{conflicted.has(p.id) && <span className="conflict-dot" aria-label="겹침 있음">!</span>}</strong>
            <span>{timeLabel(p.start)}–{timeLabel(p.end)} {p.room && `· ${p.room}`}</span>
            <small>{view === 'integrated' ? p.students.map(id => people[id] ?? '이름 미확인').join(' · ') || '배정 학생 없음' : `${p.students.length}명`}</small>
          </button>;
        })}
        {hover?.teacher === teacher && hover.day === day && <div className="drag-preview" style={{ top: (hover.start - min) / step * unit, height: hover.duration / step * unit }}>{timeLabel(hover.start)}에 놓기</div>}
      </div>)}
    </div>
  </div>;
}
