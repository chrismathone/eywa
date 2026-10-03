import { useMemo, useState, useSyncExternalStore } from 'react';
import { classList } from './class-commands';
import type { EditorActions } from './editor-actions';
import { days, labelsOf, timeLabel } from './model';
import { addStudentToClass, removeStudentFromClass, setStudentLessons } from './roster-commands';
import type { DraftStore } from './store';
import { moveNote } from './student-marks';

/**
 * 한 반의 명단을 고친다 — 학생 넣기·빼기와, 수업이 여럿이면 **어느 수업에 오는지**(요일)까지.
 * 다른 반 배정은 건드리지 않는다. 반을 통째로 옮기는 것은 통합뷰에서 끌거나 아래 ‘다른 반으로 옮기기’를 쓴다.
 */
export function ClassRoster({ store, classId, actions }: { store: DraftStore; classId: string; actions: EditorActions }) {
  const { draft } = useSyncExternalStore(store.subscribe, store.getSnapshot), people = labelsOf(draft);
  const group = useMemo(() => classList(draft).find(c => c.id === classId), [draft, classId]);
  const [pick, setPick] = useState('');
  if (!group) return null;
  const order = (day: string) => days.indexOf(day);
  const items = [...group.items].sort((a, b) => order(a.day) - order(b.day) || a.start - b.start);
  const outside = Object.keys(people).filter(id => !group.students.includes(id)).sort((a, b) => people[a].localeCompare(people[b], 'ko'));
  const toggle = (student: string, lesson: string, on: boolean) => {
    const now = items.filter(p => p.students.includes(student)).map(p => p.id);
    actions.run('학생 수업 요일 변경', d => setStudentLessons(d, student, classId, on ? [...now, lesson] : now.filter(id => id !== lesson)));
  };
  return <section className="class-roster" aria-label="반 학생 편집">
    <h3>학생 <span>{group.students.length}명</span></h3>
    {group.students.length > 0 ? <table><thead><tr><th scope="col">이름</th>
      {items.length > 1 && items.map(p => <th scope="col" key={p.id} title={`${p.day} ${timeLabel(p.start)}~${timeLabel(p.end)} · ${p.teacher}`}>{p.day}<small>{timeLabel(p.start)}</small></th>)}
      <th scope="col"><span className="sr-only">빼기</span></th></tr></thead>
      <tbody>{group.students.map(id => <tr key={id}>
        <th scope="row"><button type="button" className={`roster-name ${moveNote(draft, classId, id) ? 'student-moved' : ''}`} title={moveNote(draft, classId, id) ?? '눌러서 이 학생의 주간 동선 보기'}
          onClick={() => actions.focusStudent(id)}>{people[id] ?? '이름 미확인'}</button></th>
        {items.length > 1 && items.map(p => <td key={p.id}><input type="checkbox" aria-label={`${people[id]} ${p.day} ${timeLabel(p.start)} 수업`}
          checked={p.students.includes(id)} onChange={e => toggle(id, p.id, e.target.checked)} /></td>)}
        <td><button type="button" className="mini" aria-label={`${people[id]} 이 반에서 빼기`} title="이 반에서 빼기(다른 반 배정은 그대로)"
          onClick={() => actions.run('학생을 반에서 빼기', d => removeStudentFromClass(d, id, classId), `${people[id]} 학생을 이 반에서 뺐습니다.`)}>빼기</button></td>
      </tr>)}</tbody></table> : <p className="subtle">아직 학생이 없습니다. 아래에서 넣거나, 통합뷰에서 다른 반 학생을 끌어 오세요.</p>}
    {items.length > 1 && group.students.length > 0 && <small>체크를 풀면 그 요일 수업에는 오지 않는 학생으로 둡니다.</small>}
    <form aria-label="반에 학생 넣기" onSubmit={e => {
      e.preventDefault(); if (!pick) return;
      if (actions.run('학생을 반에 추가', d => addStudentToClass(d, pick, classId), `${people[pick]} 학생을 이 반에 넣었습니다. 다른 반 배정은 그대로입니다.`)) setPick('');
    }}><label>학생 넣기<select aria-label="넣을 학생" value={pick} onChange={e => setPick(e.target.value)}>
        <option value="">학생 선택</option>{outside.map(id => <option key={id} value={id}>{people[id]}</option>)}</select></label>
      <div className="class-actions"><button disabled={!pick}>이 반에 넣기</button>
        <button type="button" onClick={() => actions.openAdd({ kind: 'student', classId })}>새 학생 만들기</button></div>
    </form>
  </section>;
}
