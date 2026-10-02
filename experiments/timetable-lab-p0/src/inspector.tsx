import { useState, useSyncExternalStore } from 'react';
import { days, labelsOf, lessons, timeLabel, timeMinutes } from './model';
import { moveBlocks } from './block-commands';
import { moveStudent } from './student-command';
import { suggest, validate, type Candidate } from './constraints';
import type { DraftStore } from './store';
import { ColorSettings } from './color-settings';
export function Inspector({ store, selected, close, announce }: { store: DraftStore; selected: string[]; close: () => void; announce: (s: string) => void }) {
  const { draft, revision } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const all = lessons(draft).items, item = all.find(p => p.id === selected[0]), checks = validate(draft);
  const people = labelsOf(draft), [candidates, setCandidates] = useState<Candidate[]>([]), [searched, setSearched] = useState(false);
  const relevant = item ? checks.issues.filter(i => i.placementIds.includes(item.id)) : checks.issues;
  return <aside className="lab-inspector"><header><h2>{item?.name || '배치 확인'}</h2><button onClick={close} aria-label="확인 패널 닫기">×</button></header>
    {item && <>
      <p>{item.teacher} · {item.day} {timeLabel(item.start)}–{timeLabel(item.end)} {item.room && `· ${item.room}호`}</p>
      <form key={`${item.id}-${revision}`} onSubmit={e => {
        e.preventDefault(); const data = new FormData(e.currentTarget), start = timeMinutes(String(data.get('start')));
        if (start === null) return;
        try { store.commit('선택 수업 이동', moveBlocks(draft, [item.id], item.id, { day: String(data.get('day')), teacher: String(data.get('teacher')), start })); announce('선택한 위치로 옮겼습니다.'); }
        catch (error) { announce(error instanceof Error ? error.message : '위치를 확인하세요.'); }
      }}><label>요일<select name="day" defaultValue={item.day}>{days.map(d => <option key={d}>{d}</option>)}</select></label>
        <label>강사<select name="teacher" defaultValue={item.teacher}>{[...new Set(all.map(p => p.teacher))].map(t => <option key={t}>{t}</option>)}</select></label>
        <label>시작<input name="start" type="time" defaultValue={timeLabel(item.start)} required /></label>
        <button type="submit">이 위치로 옮기기</button></form>
      <ColorSettings store={store} item={item} announce={announce} />
      <h3>배정 학생 <span>{item.students.length}명</span></h3><div className="student-chips">{item.students.map(id => <span key={id}>{people[id] ?? '이름 미확인'}</span>)}</div>
      {item.students.length > 0 && <form aria-label="학생 배정 이동" key={`student-${item.id}-${revision}`} onSubmit={e => {
        e.preventDefault(); const values = new FormData(e.currentTarget);
        try { store.commit('학생 배정 이동', moveStudent(draft, String(values.get('student')), item.id, String(values.get('target')))); announce('이 교시의 학생 배정을 옮겼습니다. 다른 요일의 배정은 유지됩니다.'); }
        catch (error) { announce(error instanceof Error ? error.message : '배정을 확인하세요.'); }
      }}><label>학생<select name="student">{item.students.map(id => <option key={id} value={id}>{people[id]}</option>)}</select></label>
        <label>도착 수업<select name="target" required defaultValue=""><option value="" disabled>수업 선택</option>{all.filter(p => p.id !== item.id && p.kind !== 'block').map(p => <option key={p.id} value={p.id}>{p.name} · {p.day} {timeLabel(p.start)}</option>)}</select></label>
        <button type="submit">이 교시의 배정 옮기기</button><small>선택한 교시만 이동합니다. 다른 요일의 배정은 유지됩니다.</small></form>}
    </>}
    <h3>겹치는 이유 <span>{relevant.length}건</span></h3>
    <div data-testid="issues">{relevant.map(i => <p className="lab-conflict" key={i.key}>{i.message}</p>)}</div>
    {checks.incomplete.map(text => <p className="lab-conflict" key={text}>{text}</p>)}
    {!relevant.length && !checks.incomplete.length && <p className="clear-check">불러온 시간표 범위에서 겹침 없음</p>}
    <p className="subtle">겹침이 있어도 자유롭게 놓을 수 있습니다. 불러온 주의 학생·강사·방을 검사합니다. 출결·교시 고정 등 전체 운영 조건을 확인한 결과는 아닙니다.</p>
    {draft.source?.notices.map(note => <p className="subtle" key={note}>{note}</p>)}
    {item && <button className="primary" onClick={() => { setCandidates(suggest(draft, item.id, revision)); setSearched(true); }}>겹치지 않는 시간 찾기</button>}
    {searched && !candidates.length && <p>확인한 시간 범위에서 대안을 찾지 못했습니다. 미확정 항목이나 다른 수업의 겹침을 확인하세요.</p>}
    {candidates.map(c => <div className="lab-candidate" key={`${c.placementId}-${c.start}`}><strong>{c.label}</strong><p>수업 길이 유지 · 새 겹침 없음</p>
      <button disabled={revision !== c.revision} onClick={() => { if (store.getSnapshot().revision === c.revision) store.commit('추천 시간으로 이동', c.draft); }}>{revision === c.revision ? '이 시간으로 옮겨 보기' : '시간표 변경됨 · 다시 검색'}</button></div>)}
  </aside>;
}
