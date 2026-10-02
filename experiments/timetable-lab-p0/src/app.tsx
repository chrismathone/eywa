import { lazy, Suspense, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { DraftStore } from './store';
import { emptyDraft, lessons, type Draft } from './model';
import { makeNativeFixture as makeFixture } from './native-fixture';
import { validate } from './constraints';
import { ScheduleCanvas } from './schedule-canvas';
import { SourceDialog } from './source-dialog';
import { Inspector } from './inspector';
import { IntegratedView } from './integrated-view';
import { appearanceOf } from './appearance';
import './workspace.css';
import './timetable-views.css';
import './class-tools.css';
import './draft-library.css';
import type { ComparedDraft } from './comparison-view';
const DraftLibrary = lazy(() => import('./draft-library').then(m => ({ default: m.DraftLibrary })));
const ComparisonView = lazy(() => import('./comparison-view').then(m => ({ default: m.ComparisonView })));

const store = new DraftStore(new URLSearchParams(location.search).has('sample') ? makeFixture() : emptyDraft());
window.labProbe = store;
export function App() {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot), { draft, undos, redos } = snapshot;
  const [view, setView] = useState<'teacher' | 'integrated'>('teacher');
  const [selected, select] = useState<string[]>([]), [panel, showPanel] = useState(false), [loading, showLoad] = useState(false);
  const [message, setMessage] = useState('수업을 잡아 옮겨 보세요. 충돌이 있어도 배치할 수 있습니다.');
  const [zoom, setZoom] = useState(1), [search, setSearch] = useState('');
  const [library, showLibrary] = useState(false), [comparison, setComparison] = useState<[ComparedDraft, ComparedDraft] | null>(null);
  const [savedDraft, setSavedDraft] = useState(draft), [savedName, setSavedName] = useState('');
  const announce = useCallback((s: string) => setMessage(s), []), items = useMemo(() => lessons(draft).items, [draft]), checks = useMemo(() => validate(draft), [draft]);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => { if (store.getSnapshot().draft !== savedDraft) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, [savedDraft]);
  useEffect(() => {
    const save = (e: KeyboardEvent) => { if (!e.isComposing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault(); if (!loading && !comparison) showLibrary(true);
    } };
    window.addEventListener('keydown', save); return () => window.removeEventListener('keydown', save);
  }, [loading, comparison]);
  function loaded(next: Draft) {
    store.commit('기존 시간표 불러오기', next); select([]);
    showLoad(false); announce('기존 시간표를 연습안으로 복사했습니다. 원본과 별개로 자유롭게 옮겨 보세요.');
  }
  return <main className="timetable-workspace">
    <header className="lab-topbar"><h1>영어 시간표 <span>연습실</span></h1>
      <span className="source-name">{draft.source ? `${draft.source.academy} · ${draft.source.date} 주` : items.length ? '예제 시간표' : '기존 시간표로 시작하세요'}</span>
      <button onClick={() => showLibrary(true)}>연습본 저장·불러오기·비교</button><button className="primary" onClick={() => showLoad(true)}>기존 시간표 불러오기</button></header>
    <div className="lab-controls"><div className="view-switch" role="tablist" aria-label="시간표 보기">
      <button role="tab" aria-selected={view === 'teacher'} onClick={() => setView('teacher')}>강사뷰</button>
      <button role="tab" aria-selected={view === 'integrated'} onClick={() => setView('integrated')}>통합뷰</button></div>
      <button className="view-option" aria-pressed={view === 'teacher' ? appearanceOf(draft).hideEmptyDays : appearanceOf(draft).hideStudents} onClick={() => {
        const next = structuredClone(draft); next.appearance ??= structuredClone(appearanceOf(draft));
        const field = view === 'teacher' ? 'hideEmptyDays' : 'hideStudents'; next.appearance[field] = !next.appearance[field]; store.commit('보기 설정', next);
      }}>{view === 'teacher' ? '빈 요일 접기' : '학생 명단 접기'}</button>
      <input className="schedule-search" aria-label="수업 강사 학생 검색" placeholder="수업 · 강사 · 학생 찾기" value={search} onChange={e => setSearch(e.target.value)} />
      <div className="history-buttons"><button disabled={!undos} onClick={store.undo} aria-label="되돌리기" title="Ctrl+Z">↶</button><button disabled={!redos} onClick={store.redo} aria-label="다시 실행" title="Ctrl+Shift+Z">↷</button></div>
      <label className="zoom-label">크기<select aria-label="시간표 크기" value={zoom} onChange={e => setZoom(Number(e.target.value))}><option value="0.65">작게</option><option value="0.8">조밀하게</option><option value="1">기본</option><option value="1.25">크게</option></select></label>
      <button className={`check-toggle ${checks.issues.length || checks.incomplete.length ? 'warning' : ''}`} aria-expanded={panel} onClick={() => showPanel(!panel)}>배치 확인 {checks.issues.length ? `· 겹침 ${checks.issues.length}` : ''}{checks.incomplete.length ? ` · 미확정 ${checks.incomplete.length}` : ''}</button>
    </div>
    <div className="lab-workarea">
      {items.length ? view === 'teacher' ? <ScheduleCanvas store={store} selected={selected} select={select} details={() => showPanel(true)} announce={announce} zoom={zoom} search={search} />
        : <IntegratedView store={store} selected={selected} select={select} details={() => showPanel(true)} zoom={zoom} search={search} announce={announce} /> : <section className="lab-empty">
        <div className="empty-schedule" aria-hidden="true"><i /><i /><i /></div><h2>지금 쓰는 시간표를 펼쳐 보세요</h2><p>수업을 옮겨 보고, 겹치는 이유를 확인하며<br />다음 시간표를 연습할 수 있습니다.</p>
        <button className="primary" onClick={() => showLoad(true)}>기존 시간표 불러오기</button><button className="sample-button" onClick={() => { store.commit('예제 열기', makeFixture()); }}>예제로 먼저 연습</button>
      </section>}
      {panel && <Inspector key={selected[0] ?? 'all'} store={store} selected={selected} close={() => showPanel(false)} announce={announce} />}
    </div>
    <footer className="lab-status"><span role="status">{message}</span><span>{selected.length > 0 ? `${selected.length}개 선택 · ` : ''}Ctrl+C / X / V · Ctrl+Z</span><b>{draft !== savedDraft ? '저장하지 않은 변경 있음' : savedName ? `저장됨 · ${savedName}` : '이름을 붙여 연습본을 저장하세요'}</b></footer>
    {loading && <SourceDialog close={() => showLoad(false)} apply={loaded} />}
    <Suspense fallback={<div role="status" className="lab-modal-backdrop">연습본 보관함을 여는 중…</div>}>
      {library && <DraftLibrary store={store} close={() => showLibrary(false)} saved={(name, value) => { setSavedDraft(value); setSavedName(name); announce(`“${name}”을 저장했습니다.`); }}
        loaded={(name, value) => { store.commit('저장한 연습본 불러오기', value); setSavedDraft(store.getSnapshot().draft); setSavedName(name); select([]); showPanel(false); showLibrary(false); announce(`“${name}”을 불러왔습니다. 이어서 편집하고 새 연습본으로 저장할 수 있습니다.`); }}
        compare={(a, b) => { setComparison([a, b]); showLibrary(false); }} />}
      {comparison && <ComparisonView left={comparison[0]} right={comparison[1]} close={() => setComparison(null)} />}
    </Suspense>
  </main>;
}
