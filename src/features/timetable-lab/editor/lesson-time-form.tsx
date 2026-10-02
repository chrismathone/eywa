import { useMemo, useState } from 'react';
import { reasonOf } from './reason';
import { days, lessons, timeLabel, timeMinutes, type Lesson } from './model';
import { moveBlocks } from './block-commands';
import { renameBlock, setLocked, setNote, setRoom } from './item-commands';
import { isAllowedTime, operatingLabel, resizeLesson } from './operating-times';
import type { DraftStore } from './store';
import { teacherColumns } from './teachers';

/** 고른 수업(또는 회의 일정) 하나의 요일·강사·시간·강의실·잠금·메모를 고친다. 한 번 저장 = 되돌리기 한 번. */
export function LessonTimeForm({ store, item, announce }: { store: DraftStore; item: Lesson; announce: (s: string) => void }) {
  const { draft, revision } = store.getSnapshot(), all = useMemo(() => lessons(draft).items, [draft]);
  const teachers = useMemo(() => teacherColumns(draft, all), [draft, all]);
  const rooms = useMemo(() => [...new Set(all.map(p => p.room).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko', { numeric: true })), [all]);
  const [day, setDay] = useState(item.day), [teacher, setTeacher] = useState(item.teacher);
  const [start, setStart] = useState(timeLabel(item.start)), [end, setEnd] = useState(timeLabel(item.end)), [error, setError] = useState('');
  const [room, setRoomText] = useState(item.room), [label, setLabel] = useState(item.name);
  const [locked, setLock] = useState(!!item.locked), [note, setNoteText] = useState(item.note ?? '');
  // 회의 등 비수업 일정은 끌어 옮길 때와 같이 수업 운영시간에 묶이지 않는다.
  const meeting = item.kind === 'block', fits = (from: number, to: number) => isAllowedTime(draft, item.kind, day, from, to);
  const a = timeMinutes(start), b = timeMinutes(end), allowed = a !== null && b !== null && fits(a, b);
  const placedChanged = day !== item.day || teacher !== item.teacher || a !== item.start || b !== item.end;
  return <form aria-label="수업 시간 변경" onSubmit={e => {
    e.preventDefault(); if (a === null || b === null) return;
    try {
      if (store.getSnapshot().revision !== revision) throw new Error('시간표가 바뀌었습니다. 수업을 다시 선택해 주세요.');
      // 잠근 수업은 자리·강의실을 바꾸지 못한다. 잠금을 푸는 저장은 먼저 풀고 나머지를 적용한다.
      let next = item.locked && !locked ? setLocked(draft, [item.id], false) : draft;
      if (placedChanged) {
        const moved = structuredClone(next);
        moved.cells[item.row][1] = { ...moved.cells[item.row][1], text: day, formula: undefined, richText: undefined };
        next = moveBlocks(resizeLesson(moved, item.id, a, b), [item.id], item.id, { day, teacher, start: a });
      }
      if (meeting) next = renameBlock(next, item.id, label);
      else if (room.trim() !== item.room) next = setRoom(next, [item.id], room);
      next = setNote(next, item.id, note);
      if (!item.locked && locked) next = setLocked(next, [item.id], true);
      store.commit(meeting ? '일정 변경' : '수업 변경', next); setError('');
      announce(`${meeting ? '일정을' : '수업을'} ${day} ${start}~${end}, ${b - a}분으로 저장했습니다. 겹침 표시를 확인해 주세요.`);
    } catch (e) { setError(reasonOf(e, '수업 시간을 확인해 주세요.')); }
  }}>
    {meeting && <label>일정 이름<input name="label" value={label} maxLength={80} onChange={e => setLabel(e.target.value)} required /></label>}
    <label>수업 요일<select name="day" value={day} onChange={e => setDay(e.target.value)}>{days.map(d => <option key={d}>{d}</option>)}</select></label>
    <label>수업 강사<select name="teacher" value={teacher} onChange={e => setTeacher(e.target.value)}>{teachers.map(t => <option key={t}>{t}</option>)}</select></label>
    <label>수업 시작<input name="start" type="time" value={start} onChange={e => setStart(e.target.value)} required /></label>
    <label>수업 종료<input name="end" type="time" value={end} onChange={e => setEnd(e.target.value)} required /></label>
    <div className="duration-presets">{[40, 50, 60, 80, 90].map(n => <button type="button" key={n} disabled={a === null || !fits(a, a + n)} onClick={() => setEnd(timeLabel(a! + n))}>{n}분</button>)}</div>
    {!meeting && <label>강의실<input name="room" list={`rooms-${item.id}`} value={room} maxLength={40} onChange={e => setRoomText(e.target.value)} placeholder="미정" />
      <datalist id={`rooms-${item.id}`}>{rooms.map(r => <option key={r} value={r} />)}</datalist></label>}
    <small>{a !== null && b !== null && b > a ? `${b - a}분 ${meeting ? '일정' : '수업'} · ` : ''}{meeting ? '회의 같은 비수업 일정은 수업 운영시간 밖에도 둘 수 있습니다.' : `${day}요일 운영시간: ${operatingLabel(draft, day)}`}</small>
    {!meeting && <small>불러온 시간표의 교시 설정과 실제 수업 시간 범위 안에서 바꿀 수 있습니다.</small>}
    <label className="lock-row"><span><input type="checkbox" name="locked" checked={locked} onChange={e => setLock(e.target.checked)} /> 잠그기</span><small>잠그면 실수로 옮기거나 지울 수 없습니다.</small></label>
    <label className="note-row">메모<textarea name="note" value={note} maxLength={300} rows={2} onChange={e => setNoteText(e.target.value)} placeholder="연습본에만 남는 메모" /></label>
    {(!allowed || error) && <p role="alert" className="load-error">{error || (meeting ? '하루 안에서 시작보다 늦은 종료 시간을 골라 주세요.' : '운영시간 안에서 시작보다 늦은 종료 시간을 골라 주세요.')}</p>}
    <button type="submit" disabled={!allowed}>수업 시간·강사 바꾸기</button>
  </form>;
}
