import { lazy, Suspense, useCallback, useState, useSyncExternalStore } from 'react';
import { DomGrid } from './dom-grid';
import { DraftStore } from '@/features/timetable-lab/editor/store';
import { assignStudent, lessons, studentLabels, timeLabel } from '@/features/timetable-lab/editor/model';
import { suggest, validate, type Candidate } from '@/features/timetable-lab/editor/constraints';
const UniverGrid = lazy(() => import('./univer-grid'));

const store = new DraftStore();
declare global { interface Window { labProbe?: typeof store } }
// Test-only local page; never imported by the production app.
window.labProbe = store;
export function App() {
  const [engine, setEngine] = useState<'dom' | 'univer'>('dom');
  const [message, setMessage] = useState('셀을 선택하고 입력하세요. 여러 칸은 Shift+방향키로 선택할 수 있습니다.');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [searched, setSearched] = useState(false);
  const [student, setStudent] = useState('s1'), [classId, setClassId] = useState('class-2');
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { draft, revision, undos, redos, label } = snapshot;
  const checks = validate(draft), preview = lessons(draft);
  const formulaCount = draft.cells.flat().filter(c => c.formula).length;
  const announce = useCallback((text: string) => setMessage(text), []);
  function apply(candidate: Candidate) {
    if (candidate.revision !== store.getSnapshot().revision) { announce('시간표가 바뀌었습니다. 대안을 다시 찾아주세요.'); return; }
    store.commit('추천 시간으로 이동', candidate.draft); setCandidates([]); setSearched(false);
  }
  return <main className="lab-app">
    <header><div><p className="eyebrow">INJAEWON · 편집 연결 검증</p><h1>영어 시간표 연습실</h1>
      <p>강사 배치를 고치고, 통합표에서 학생을 배정해 보세요.</p></div><span className="badge">합성 자료 · 운영 반영 없음</span></header>
    <section className="notice">개발용 비교 화면입니다. 이력과 편집 연결을 먼저 시험하며, 실제 시간표 자료·저장·운영 반영은 아직 연결하지 않았습니다.</section>
    <div className="toolbar"><div className="tabs" role="tablist" aria-label="편집 엔진 비교">
      <button role="tab" aria-selected={engine === 'dom'} onClick={() => setEngine('dom')}>자체 격자</button>
      <button role="tab" aria-selected={engine === 'univer'} onClick={() => setEngine('univer')}>Univer</button></div>
      <button disabled={!undos} onClick={store.undo}>되돌리기 ({undos})</button>
      <button disabled={!redos} onClick={store.redo}>다시 실행 ({redos})</button>
      <span className="history" data-testid="history">{label} · 변경 {revision}</span>
    </div>
    <div className="workspace"><section className="editor-panel"><div className="panel-heading"><h2>강사 배치</h2><span>입력 · 범위 선택 · 복사 · 붙여넣기</span></div>
      <Suspense fallback={<p className="loading">편집기를 불러오는 중…</p>}>
        {engine === 'dom' ? <DomGrid store={store} announce={announce} /> : <UniverGrid store={store} announce={announce} />}
      </Suspense>
      <p role="status" className="status">{message}</p>
      {formulaCount > 0 && <p className="notice">수식은 실험 입력으로 보관합니다. 시간표와 충돌 검사는 마지막 확정값을 유지합니다. 수식 결과 확정은 아직 연결하지 않았습니다.</p>}
      <p className="footnote">첫 3개 수업의 행과 ID를 고정한 비교용 표입니다. 자유 배치 화면과 전체 단축키 호환은 후속 검증 대상입니다.</p>
    </section><aside><section className="panel"><h2>통합표 · 학생 배정</h2>
      <div data-testid="integrated">{preview.items.map(item => <article className="lesson" key={item.id} data-placement-id={item.id}>
        <div><strong>{item.name}</strong><span>{item.day} {timeLabel(item.start)}–{timeLabel(item.end)}</span></div>
        <p>{item.teacher} · {item.room}호</p><p>{item.students.map(id => studentLabels[id]).join(' · ') || '배정된 학생 없음'}</p>
      </article>)}</div>
      <div className="assignment"><label>학생<select value={student} onChange={e => setStudent(e.target.value)}>{Object.entries(studentLabels).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label>배정할 수업<select value={classId} onChange={e => setClassId(e.target.value)}>{draft.placements.map(p => <option key={p.classId} value={p.classId}>{draft.cells[p.row][0].text || '미확정 수업'}</option>)}</select></label>
        <button className="primary" onClick={() => store.commit('학생 배정', assignStudent(draft, student, classId))}>학생 배정</button></div>
    </section><section className="panel"><h2>충돌 확인</h2>
      <p className="footnote">합성 자료의 학생·강사·방 검사입니다. 실제 날짜 이력·분리등원 검사는 아직 연결하지 않았습니다.</p>
      <div data-testid="issues">{checks.issues.map(issue => <p className="issue" key={issue.key}>{issue.message}</p>)}</div>
      {checks.incomplete.map(text => <p className="issue" key={text}>{text}</p>)}
      {!checks.issues.length && !checks.incomplete.length && <p className="success">현재 합성 자료의 검사 범위에서 겹침 없음</p>}
      <button onClick={() => { setCandidates(suggest(draft, 'placement-1', revision)); setSearched(true); }}>영어 A의 가능한 시간 찾기</button>
      {searched && !candidates.length && <p>현재 시험 범위에서 대안을 찾지 못했습니다. 입력값을 확인하세요.</p>}
      {candidates.map(c => <div className="candidate" key={c.start}><strong>{c.label}</strong><p>해당 수업 겹침 해소 · 다른 수업에 새 충돌 없음 · 수업 길이 유지</p>
        <button disabled={c.revision !== revision} onClick={() => apply(c)}>{c.revision === revision ? '이 시간으로 연습' : '시간표 변경됨 · 다시 검색'}</button></div>)}
    </section></aside></div>
  </main>;
}
