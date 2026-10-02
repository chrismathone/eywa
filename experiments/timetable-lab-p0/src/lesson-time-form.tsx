import { useState } from 'react';
import { days, lessons, timeLabel, timeMinutes, type Lesson } from './model';
import { moveBlocks } from './block-commands';
import { isAllowedTime, operatingLabel, resizeLesson } from './operating-times';
import type { DraftStore } from './store';
export function LessonTimeForm({ store, item, announce }: { store: DraftStore; item: Lesson; announce: (s: string) => void }) {
  const { draft, revision } = store.getSnapshot(), all = lessons(draft).items;
  const [day, setDay] = useState(item.day), [teacher, setTeacher] = useState(item.teacher);
  const [start, setStart] = useState(timeLabel(item.start)), [end, setEnd] = useState(timeLabel(item.end)), [error, setError] = useState('');
  // 회의 등 비수업 일정은 끌어 옮길 때와 같이 수업 운영시간에 묶이지 않는다.
  const meeting = item.kind === 'block', fits = (from: number, to: number) => isAllowedTime(draft, item.kind, day, from, to);
  const a = timeMinutes(start), b = timeMinutes(end), allowed = a !== null && b !== null && fits(a, b);
  return <form aria-label="수업 시간 변경" onSubmit={e => {
    e.preventDefault(); if (a === null || b === null) return;
    try {
      if (store.getSnapshot().revision !== revision) throw new Error('시간표가 바뀌었습니다. 수업을 다시 선택해 주세요.');
      const resized = structuredClone(draft);
      resized.cells[item.row][1] = { ...resized.cells[item.row][1], text: day, formula: undefined, richText: undefined };
      const next = moveBlocks(resizeLesson(resized, item.id, a, b), [item.id], item.id, { day, teacher, start: a });
      store.commit('수업 시간·강사 변경', next); setError(''); announce(`${meeting ? '일정을' : '수업을'} ${day} ${start}~${end}, ${b - a}분으로 바꿨습니다. 겹침 표시를 확인해 주세요.`);
    } catch (e) { setError(e instanceof Error ? e.message : '수업 시간을 확인해 주세요.'); }
  }}><label>수업 요일<select name="day" value={day} onChange={e => setDay(e.target.value)}>{days.map(d => <option key={d}>{d}</option>)}</select></label>
    <label>수업 강사<select name="teacher" value={teacher} onChange={e => setTeacher(e.target.value)}>{[...new Set(all.map(p => p.teacher))].map(t => <option key={t}>{t}</option>)}</select></label>
    <label>수업 시작<input name="start" type="time" value={start} onChange={e => setStart(e.target.value)} required /></label>
    <label>수업 종료<input name="end" type="time" value={end} onChange={e => setEnd(e.target.value)} required /></label>
    <div className="duration-presets">{[40, 50, 60, 80, 90].map(n => <button type="button" key={n} disabled={a === null || !fits(a, a + n)} onClick={() => setEnd(timeLabel(a! + n))}>{n}분</button>)}</div>
    <small>{a !== null && b !== null && b > a ? `${b - a}분 ${meeting ? '일정' : '수업'} · ` : ''}{meeting ? '회의 같은 비수업 일정은 수업 운영시간 밖에도 둘 수 있습니다.' : `${day}요일 운영시간: ${operatingLabel(draft, day)}`}</small>
    {!meeting && <small>불러온 시간표의 교시 설정과 실제 수업 시간 범위 안에서 바꿀 수 있습니다.</small>}
    {(!allowed || error) && <p role="alert" className="load-error">{error || (meeting ? '하루 안에서 시작보다 늦은 종료 시간을 골라 주세요.' : '운영시간 안에서 시작보다 늦은 종료 시간을 골라 주세요.')}</p>}
    <button type="submit" disabled={!allowed}>수업 시간·강사 바꾸기</button>
  </form>;
}
