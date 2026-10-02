import { useState, useSyncExternalStore } from 'react';
import { reasonOf } from './reason';
import { labelsOf, lessons, timeLabel } from './model';
import { moveStudent } from './student-command';
import { suggest, validate, type Candidate } from './constraints';
import type { DraftStore } from './store';
import { ColorSettings } from './color-settings';
import { ClassTools } from './class-tools';
import { LessonTimeForm } from './lesson-time-form';
import { moveNote } from './student-marks';
import { ClassRoster } from './class-roster';
import type { EditorActions } from './editor-actions';
export function Inspector({ store, selected, close, announce, actions }: { store: DraftStore; selected: string[]; close: () => void; announce: (s: string) => void; actions: EditorActions }) {
  const { draft, revision } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const all = lessons(draft).items, item = all.find(p => p.id === selected[0]), checks = validate(draft);
  const people = labelsOf(draft), [candidates, setCandidates] = useState<Candidate[]>([]), [searched, setSearched] = useState(false);
  const relevant = item ? checks.issues.filter(i => i.placementIds.includes(item.id)) : checks.issues;
  return <aside className="lab-inspector"><header><h2>{item?.name || '배치 확인'}</h2><button onClick={close} aria-label="확인 패널 닫기">×</button></header>
    {item && <>
      <p>{item.teacher} · {item.day} {timeLabel(item.start)}–{timeLabel(item.end)} {item.room && `· ${item.room}호`}</p>
      {/* 이 수업의 값이 바뀔 때만 다시 만든다 — 다른 곳(명단·색)을 고쳐도 적던 메모·강의실이 지워지지 않는다. */}
      <LessonTimeForm key={[item.id, item.name, item.day, item.start, item.end, item.teacher, item.room, item.locked, item.note].join('|')} store={store} item={item} announce={announce} />
      <ColorSettings store={store} item={item} announce={announce} />
      {item.kind !== 'block' && <ClassTools store={store} classId={item.classId} announce={announce} cleared={() => actions.select([])} />}
      {item.kind !== 'block' && <ClassRoster store={store} classId={item.classId} actions={actions} />}
      <h3>이 시간에 오는 학생 <span>{item.students.length}명</span></h3><div className="student-chips">{item.students.map(id => <span key={id} className={moveNote(draft, item.classId, id) ? 'student-moved' : ''} title={moveNote(draft, item.classId, id)}>{people[id] ?? '이름 미확인'}{moveNote(draft, item.classId, id) && ' ↗'}</span>)}</div>
      {item.students.length > 0 && <form aria-label="학생 배정 이동" key={`student-${item.id}-${revision}`} onSubmit={e => {
        e.preventDefault(); const values = new FormData(e.currentTarget);
        try { store.commit('학생 배정 이동', moveStudent(draft, String(values.get('student')), item.id, String(values.get('target')))); announce('이 교시의 학생 배정을 옮겼습니다. 다른 요일의 배정은 유지됩니다.'); }
        catch (error) { announce(reasonOf(error, '배정을 확인하세요.')); }
      }}><label>학생<select name="student">{item.students.map(id => <option key={id} value={id}>{people[id]}</option>)}</select></label>
        <label>옮길 수업<select name="target" required defaultValue=""><option value="" disabled>반과 시간 선택</option>{all.filter(p => p.id !== item.id && p.kind !== 'block').map(p => <option key={p.id} value={p.id}>{p.name} · {p.day} {timeLabel(p.start)}</option>)}</select></label>
        <button type="submit">이 시간의 학생만 옮기기</button><small>지금 선택한 수업 시간의 배정만 바뀝니다. 반 전체를 옮기려면 위의 ‘학생을 다른 반으로 옮기기’를 사용하세요.</small></form>}
    </>}
    <h3>겹치는 이유 <span>{relevant.length}건</span></h3>
    <div data-testid="issues">{relevant.map(i => <p className="lab-conflict" key={i.key}>{i.message}</p>)}</div>
    {checks.incomplete.map(text => <p className="lab-conflict" key={text}>{text}</p>)}
    {!relevant.length && !checks.incomplete.length && <p className="clear-check">불러온 시간표 범위에서 겹침 없음</p>}
    <p className="subtle">겹침이 있어도 자유롭게 놓을 수 있습니다. 불러온 주의 학생·강사·방을 검사합니다. 출결·교시 고정 등 전체 운영 조건을 확인한 결과는 아닙니다.</p>
    {draft.source?.notices.map(note => <p className="subtle" key={note}>{note}</p>)}
    {item && !item.locked && <button className="primary" onClick={() => { setCandidates(suggest(draft, item.id, revision)); setSearched(true); }}>겹치지 않는 시간 찾기</button>}
    {item?.locked && <p className="subtle">잠근 수업이라 다른 시간을 찾지 않습니다. 옮기려면 잠금을 먼저 풀어 주세요.</p>}
    {searched && !candidates.length && !item?.locked && <p>확인한 시간 범위에서 대안을 찾지 못했습니다. 미확정 항목이나 다른 수업의 겹침을 확인하세요.</p>}
    {candidates.map(c => <div className="lab-candidate" key={`${c.placementId}-${c.start}`}><strong>{c.label}</strong><p>수업 길이 유지 · 새 겹침 없음</p>
      <button disabled={revision !== c.revision} onClick={() => { if (store.getSnapshot().revision === c.revision) store.commit('추천 시간으로 이동', c.draft); }}>{revision === c.revision ? '이 시간으로 옮겨 보기' : '시간표 변경됨 · 다시 검색'}</button></div>)}
  </aside>;
}
