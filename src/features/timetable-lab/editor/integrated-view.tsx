import { useId, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { padCardDays, type GridCell, type RichCardGroup, type RichClassCard } from '@/features/timetable/lib/class-grid';
import { enumDayToKo } from '@/features/timetable/lib/periods';
import { movedByTarget, movedCellBox, visibleSpanRows } from '@/features/timetable/lib/row-span';
import { appearanceOf, paint, subjectTone, teacherTone } from './appearance';
import { integratedProjection } from './integrated-projection';
import { conflictNotes } from './insights';
import { timeLabel, type Draft, type Lesson } from './model';
import type { DraftStore } from './store';
import { useRosterDrag } from './roster-drag';
import { moveNote, outgoingStudents } from './student-marks';
import { schoolGradeLabel } from '@/lib/format/school-grade';
import type { EditorActions } from './editor-actions';
import { classMenu, studentMenu } from './menus';
import { placeClass } from './class-order';
type Selection = { selected: string[]; select: (ids: string[]) => void; details: () => void };
type ViewData = { draft: Draft; byClass: Map<string, Lesson[]>; byId: Map<string, Lesson>; conflicts: Map<string, string[]>; selection: Selection; roster: ReturnType<typeof useRosterDrag>; readOnly: boolean;
  actions?: EditorActions; focus: string | null; dragScope: string };
export function IntegratedView({ store, selected, select, details, zoom, search, announce, readOnly = false, actions, focus = null }: Selection & { store: DraftStore; zoom: number; search: string; announce: (s: string) => void; readOnly?: boolean;
  actions?: EditorActions; focus?: string | null }) {
  const { draft } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const projection = useMemo(() => integratedProjection(draft), [draft]), appearance = appearanceOf(draft);
  const conflicts = useMemo(() => conflictNotes(draft), [draft]);
  const root = useRef<HTMLDivElement>(null), ghost = useRef<HTMLDivElement>(null), roster = useRosterDrag(store, announce, root, ghost);
  const dragScope = useId();
  const data: ViewData = { draft, byClass: projection.byClass, byId: projection.byId, conflicts, selection: { selected, select, details }, roster, readOnly, actions, focus, dragScope };
  return <div ref={root} className="schedule-scroll integrated-scroll" role="region" aria-label="통합뷰 학생 배정" tabIndex={0}
    onPointerMove={roster.move} onPointerUp={roster.up} onPointerCancel={roster.cancel} onKeyDown={e => {
    if (!readOnly && (e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) { e.preventDefault(); (e.shiftKey || e.key.toLowerCase() === 'y' ? store.redo : store.undo)(); }
    if (e.key === 'Escape') actions?.focusStudent(null);
  }}><div className="integrated-board" data-periods-hidden={appearance.hidePeriods || undefined} style={{ zoom }}>
    {projection.groups.map(group => {
      const cards = group.cards.filter(c => !search || `${c.className} ${c.teacherName} ${c.active.map(s => s.name).join(' ')} ${projection.byClass.get(c.classId)?.map(p => p.teacher).join(' ')}`.includes(search));
      if (!cards.length) return null;
      return <section key={group.key} className="integrated-group" aria-label={group.label}>
        <div className="period-rail"><div className="class-name-row">수업명</div><div className="homeroom-row">담임</div><div className="class-day-row">교시</div>
          {visibleSpanRows(group.periodRows, group.rowPlan).map(p => <div key={p.order} className="class-period-row"><b>{p.label || p.time}</b>{p.label && p.label !== p.time && <small>{p.time}</small>}</div>)}
          {!appearance.hideStudents && <div className="roster-label" style={{ height: group.rosterRows.active * 22 + 6 }}>재원</div>}</div>
        {cards.map(card => <ClassCard key={card.classId} card={card} group={group} data={data} />)}
      </section>;
    })}
    {projection.hiddenClasses.length > 0 && <p className="subtle">기존 그룹 설정으로 {projection.hiddenClasses.length}개 반이 숨겨져 있습니다. 강사뷰에서 모든 배치를 확인할 수 있습니다.</p>}
  </div><div ref={ghost} className="roster-drag-ghost" hidden aria-hidden="true" /></div>;
}
function ClassCard({ card, group, data }: { card: RichClassCard; group: RichCardGroup; data: ViewData }) {
  const [over, setOver] = useState<'before' | 'after' | null>(null), dragged = useRef(false);
  const { draft, selection } = data, appearance = appearanceOf(draft), days = padCardDays(card.days);
  const gridColumns: CSSProperties = { gridTemplateColumns: `repeat(${days.length}, 1fr)` };
  const moved = movedByTarget(group.rowPlan), placements = data.byClass.get(card.classId) ?? [];
  const choose = () => { selection.select(placements.map(p => p.id)); selection.details(); };
  const mime = `application/x-eywa-lab-class-${data.dragScope.replace(/[^a-z0-9]/gi, '')}`;
  return <article className="integrated-class" data-class-id={card.classId} data-class-drop={over ?? undefined} style={{ width: Math.max(3, days.length) * 55 }}>
    <button className="class-name-row" draggable={!!data.actions && !data.readOnly} onClick={() => { if (!dragged.current) choose(); dragged.current = false; }} style={paint(draft.classes?.[card.classId]?.color ?? subjectTone(draft))}
      onDragStart={event => { dragged.current = true; event.dataTransfer.setData(mime, card.classId); event.dataTransfer.effectAllowed = 'move'; }}
      onDragEnd={() => { setOver(null); window.setTimeout(() => { dragged.current = false; }, 0); }}
      onDragOver={event => { if (!Array.from(event.dataTransfer.types).includes(mime)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; const box = event.currentTarget.getBoundingClientRect(); setOver(event.clientX < box.left + box.width / 2 ? 'before' : 'after'); }}
      onDragLeave={() => setOver(null)}
      onDrop={event => { if (!Array.from(event.dataTransfer.types).includes(mime)) return; event.preventDefault(); const from = event.dataTransfer.getData(mime); const box = event.currentTarget.getBoundingClientRect(); const side = event.clientX < box.left + box.width / 2 ? 'before' : 'after'; setOver(null); data.actions?.run('통합뷰 반 순서 변경', draft => placeClass(draft, from, card.classId, side), '반 위치를 옮겼습니다. Ctrl+Z로 되돌릴 수 있습니다.'); }}
      onContextMenu={e => { if (data.actions && !data.readOnly) { e.preventDefault(); data.actions.openMenu(e, `${card.className} 반`, classMenu(draft, card.classId, data.actions)); } }}><strong>{card.className}</strong><small>{card.classroomLabel}</small></button>
    <div className="homeroom-row" style={card.teacherName ? paint(teacherTone(draft, card.teacherName, true)) : undefined}>{card.teacherName}{card.teacherName && appearance.teacherNicknames[card.teacherName] && `(${appearance.teacherNicknames[card.teacherName]})`}</div>
    <div className="class-day-row" style={gridColumns}>{days.map(d => <span key={d}>{enumDayToKo(d)}</span>)}</div>
    {visibleSpanRows(group.periodRows, group.rowPlan).map(row => <div className="class-period-grid" key={row.order} style={gridColumns}>
      {days.map(day => <div key={day} className="mini-cell-shell">
        <MiniCell cell={card.cells[`${row.order}:${day}`]} data={data} rowTime={row.time} />
        {(moved.get(row.order) ?? []).map(m => card.cells[`${m.from}:${day}`] && <div className="moved-mini-cell" key={m.from} style={movedCellBox(m, 32)}>
          <MiniCell cell={card.cells[`${m.from}:${day}`]} data={data} rowTime={group.periodRows.find(p => p.order === m.from)?.time} />
        </div>)}
      </div>)}
    </div>)}
    {!appearance.hideStudents && <div className="integrated-roster">
      {[false, true].map(incoming => <div key={String(incoming)} className={incoming ? 'roster-transfers' : 'roster-current'}>
      {incoming && card.active.some(student => student.isTransferredIn) && <h3>IN</h3>}
      {card.active.filter(student => !!student.isTransferredIn === incoming).sort((a, b) => incoming ? a.name.localeCompare(b.name, 'ko') : 0).map(student => <button key={student.studentId} className={`student-drag ${incoming ? 'student-moved' : ''} ${data.focus ? data.focus === student.studentId ? 'is-trail' : 'is-dim' : ''}`} data-student-id={student.studentId}
        onContextMenu={e => { if (data.actions && !data.readOnly) { e.preventDefault(); data.actions.openMenu(e, student.name, studentMenu(draft, student.studentId!, card.classId, data.actions)); } }}
        onDoubleClick={() => data.actions?.focusStudent(student.studentId!)}
        title={`${student.name} · ${(student.attendanceDays ?? []).map(d => enumDayToKo(d as Parameters<typeof enumDayToKo>[0])).join('·')} · ${moveNote(draft, card.classId, student.studentId!) ?? '끌어서 다른 반으로 이동 · Ctrl+끌기는 그 반에도 넣기 · 두 번 눌러 동선 보기'}`}
        onPointerDown={e => { if (!data.readOnly) data.roster.down(e, student.studentId!, student.name, card.classId); }}
        onClick={() => { if (!data.roster.click()) return; selection.select(placements.filter(p => p.students.includes(student.studentId!)).map(p => p.id)); selection.details(); }}><span>{student.name}{incoming && <b className="transfer-tag"> IN</b>}</span><small>{schoolGradeLabel(student.school, student.grade)}</small></button>)}
      </div>)}
      {!card.active.length && <span className="subtle">배정 학생 없음</span>}
      {outgoingStudents(draft, card.classId).length > 0 && <div className="roster-transfers"><h3>OUT</h3>
        {outgoingStudents(draft, card.classId).map(student => <div key={student.id} className="student-out"><span>{student.name}<b className="transfer-tag"> OUT</b></span><small>{schoolGradeLabel(draft.studentDetails?.[student.id]?.school, draft.studentDetails?.[student.id]?.grade)}</small></div>)}
      </div>}
    </div>}
  </article>;
}
function MiniCell({ cell, data, rowTime }: { cell?: GridCell; data: ViewData; rowTime?: string }) {
  if (!cell) return null;
  const { draft, byId, selection, conflicts } = data;
  const items = (cell.sourceIds ?? []).map(id => byId.get(id)).filter((p): p is Lesson => !!p);
  return <div className="mini-cell-items">{items.map(item => {
    const color = item.kind === 'seat' ? item.teacher === 'LAB' ? { bg: 'var(--blue-soft)', text: 'var(--blue)' } : { bg: 'var(--purple-soft)', text: 'var(--purple)' } : teacherTone(draft, item.teacher, true);
    const offAxis = rowTime && rowTime.split('~')[0] !== timeLabel(item.start);
    const trail = data.focus ? item.students.includes(data.focus) ? 'is-trail' : 'is-dim' : '';
    return <button key={item.id} data-integrated-id={item.id} data-tooltip-disabled={data.readOnly || undefined} title={data.readOnly ? `${item.name} · ${item.day} ${timeLabel(item.start)}~${timeLabel(item.end)} · ${item.teacher} · ${item.room}${item.note ? `\n${item.note}` : ''}` : undefined} className={`${selection.selected.includes(item.id) ? 'is-selected' : ''} ${conflicts.has(item.id) ? 'has-conflict' : ''} ${trail}`}
      style={paint(color)}
      aria-label={`${item.name} ${item.day} ${timeLabel(item.start)} ${item.teacher}`}
      onClick={() => { selection.select([item.id]); selection.details(); }}>{item.labSeparate ? '*LAB' : item.teacher}
      {offAxis && <i className="off-axis" aria-label={`실제 시작 ${timeLabel(item.start)}`} />}{conflicts.has(item.id) && <b className="conflict-dot" aria-label="겹침 있음">!</b>}
    </button>;
  })}</div>;
}
