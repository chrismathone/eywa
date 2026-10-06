import { useMemo, useSyncExternalStore } from 'react';
import { classList } from './class-commands';
import type { EditorActions } from './editor-actions';
import { days, labelsOf, timeLabel } from './model';
import { removeStudentFromClass, setStudentLessons } from './roster-commands';
import type { DraftStore } from './store';
import { moveNote } from './student-marks';
import { StudentPicker } from './student-picker';

/**
 * 한 반의 명단을 고친다 — 학생 넣기·빼기와, 수업이 여럿이면 **어느 수업에 오는지**(요일)까지.
 * 표는 **학생이 열, 수업이 행**이다 — 영어 반은 한 주에 수업이 열 개를 넘어, 수업을 열로 두면 이름 칸이 한 글자 폭으로 눌린다.
 * 표는 제 상자 안에서만 스크롤한다(이름 줄·수업 칸·빼기 줄은 붙어 있다) — 명단이 길어도 확인 패널의 나머지가 밀려 내려가지 않는다.
 * 다른 반 배정은 건드리지 않는다. 반을 통째로 옮기는 것은 통합뷰에서 끌거나 아래 ‘다른 반으로 옮기기’를 쓴다.
 */
export function ClassRoster({ store, classId, actions }: { store: DraftStore; classId: string; actions: EditorActions }) {
  const { draft } = useSyncExternalStore(store.subscribe, store.getSnapshot), people = labelsOf(draft);
  const group = useMemo(() => classList(draft).find(c => c.id === classId), [draft, classId]);
  if (!group) return null;
  const order = (day: string) => days.indexOf(day), nameOf = (id: string) => people[id] ?? '이름 미확인';
  const items = [...group.items].sort((a, b) => order(a.day) - order(b.day) || a.start - b.start), students = group.students;
  const toggle = (student: string, lesson: string, on: boolean) => {
    const now = items.filter(p => p.students.includes(student)).map(p => p.id);
    actions.run('학생 수업 요일 변경', d => setStudentLessons(d, student, classId, on ? [...now, lesson] : now.filter(id => id !== lesson)));
  };
  const name = (id: string) => <button type="button" className={`roster-name ${moveNote(draft, classId, id) ? 'student-moved' : ''}`} title={moveNote(draft, classId, id) ?? '눌러서 이 학생의 주간 동선 보기'}
    onClick={() => actions.focusStudent(id)}>{nameOf(id)}</button>;
  const remove = (id: string) => <button type="button" className="mini" aria-label={`${nameOf(id)} 이 반에서 빼기`} title="이 반에서 빼기(다른 반 배정은 그대로)"
    onClick={() => actions.run('학생을 반에서 빼기', d => removeStudentFromClass(d, id, classId), `${nameOf(id)} 학생을 이 반에서 뺐습니다.`)}>빼기</button>;
  return <section className="class-roster" aria-label="반 학생 편집">
    <h3>학생 <span>{students.length}명</span></h3>
    {!students.length ? <p className="subtle">아직 학생이 없습니다. 아래에서 넣거나, 통합뷰에서 다른 반 학생을 끌어 오세요.</p>
      // 수업이 하나뿐이면 고를 요일이 없다 — 이름만 세로로 늘어놓는다.
      : items.length < 2 ? <ul className="roster-scroll roster-list">{students.map(id => <li key={id}>{name(id)}{remove(id)}</li>)}</ul>
      : <div className="roster-scroll" role="group" aria-label="학생별 수업 요일" tabIndex={0}><table>
        <thead><tr><th scope="col">수업</th>{students.map(id => <th scope="col" key={id}>{name(id)}</th>)}</tr></thead>
        <tbody>{items.map((p, i) => <tr key={p.id} className={i > 0 && items[i - 1].day !== p.day ? 'day-start' : undefined}>
          <th scope="row" title={`${p.day} ${timeLabel(p.start)}~${timeLabel(p.end)} · ${p.teacher}`}>{p.day} <small>{timeLabel(p.start)}</small></th>
          {students.map(id => <td key={id}><input type="checkbox" aria-label={`${nameOf(id)} ${p.day} ${timeLabel(p.start)} 수업`}
            checked={p.students.includes(id)} onChange={e => toggle(id, p.id, e.target.checked)} /></td>)}
        </tr>)}</tbody>
        <tfoot><tr><th scope="row">반에서</th>{students.map(id => <td key={id}>{remove(id)}</td>)}</tr></tfoot>
      </table></div>}
    {items.length > 1 && students.length > 0 && <small>체크를 풀면 그 요일 수업에는 오지 않는 학생으로 둡니다.</small>}
    <StudentPicker draft={draft} classId={classId} members={students} actions={actions} undo={store.undo} redo={store.redo} />
  </section>;
}
