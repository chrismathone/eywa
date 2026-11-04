import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { reasonOf } from './reason';
import type { DraftStore } from './store';
import { lessons, type Draft } from './model';
import { makeNativeFixture as makeFixture } from './native-fixture';
import { validate } from './constraints';
import { ScheduleCanvas } from './schedule-canvas';
import { SourceDialog } from './source-dialog';
import { Inspector } from './inspector';
import { IntegratedView } from './integrated-view';
import { appearanceOf } from './appearance';
import { ContextMenu, type MenuState } from './context-menu';
import type { AddSeed, EditorActions, ManageTab, MenuItem } from './editor-actions';
import { SelectionBar, StatsPanel, TrailBar } from './side-panels';
import { AddDialog } from './add-dialog';
import { ManageDialog } from './manage-dialog';
import './workspace.css';
import './timetable-views.css';
import './class-tools.css';
import './draft-library.css';
import './editor-tools.css';
// 보관함·비교 창도 함께 묶는다 — 따로 내려받다 실패하면 저장하려던 순간에 편집기가 통째로 내려간다.
import { ComparisonView, type ComparedDraft } from './comparison-view';
import { DraftLibrary } from './draft-library';
import { LessonTooltip } from './lesson-tooltip';

/** 연습본 저장소는 밖에서 만든다 — 앱 화면과 시험용 화면이 같은 편집기를 쓴다. */
export type EditorProps = { store: DraftStore; onDirtyChange?: (dirty: boolean) => void; loginHref?: string; fontScale?: number; applyControls?: (saved: (draft: Draft, name: string) => void) => ReactNode; pendingApplies?: (load: (name: string, draft: Draft) => void) => ReactNode };
export function App({ store, onDirtyChange, loginHref = '/login', applyControls, pendingApplies, fontScale = 1 }: EditorProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot), { draft, undos, redos } = snapshot;
  const [view, setView] = useState<'teacher' | 'integrated'>('teacher');
  const [picked, select] = useState<string[]>([]), [panel, setPanel] = useState<'inspect' | 'stats' | null>(null), [loading, showLoad] = useState(false);
  const [message, setMessage] = useState('수업을 잡아 옮겨 보세요. 충돌이 있어도 배치할 수 있습니다.');
  const scale = draft.appearance?.scale ?? 1, zoom = scale * fontScale;
  const [search, setSearch] = useState('');
  const [library, showLibrary] = useState(false), [comparison, setComparison] = useState<[ComparedDraft, ComparedDraft] | null>(null);
  const [savedDraft, setSavedDraft] = useState(draft), [savedName, setSavedName] = useState(''), [savedId, setSavedId] = useState<string | null>(null);
  const markSaved = useCallback((draft: Draft, name: string) => { setSavedDraft(draft); setSavedName(name); }, []);
  const [adding, setAdding] = useState<AddSeed | null>(null), [managing, setManaging] = useState<ManageTab | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null), [focus, setFocus] = useState<string | null>(null);
  const announce = useCallback((s: string) => setMessage(s), []), items = useMemo(() => lessons(draft).items, [draft]), checks = useMemo(() => validate(draft), [draft]);
  const closeMenu = useCallback(() => setMenu(null), []);
  // 되돌리기·반 합치기·반 지우기로 사라진 수업은 선택에서도 빠진다 — 없는 수업을 붙든 선택은 다음 조작을 엉뚱한 이유로 막는다.
  const selected = useMemo(() => { const live = new Set(draft.placements.map(p => p.id)); return picked.every(id => live.has(id)) ? picked : picked.filter(id => live.has(id)); }, [draft, picked]);
  const actions = useMemo<EditorActions>(() => ({
    announce,
    run: (label, change, done) => {
      try { store.commit(label, change(store.getSnapshot().draft)); if (done) announce(done); return true; }
      catch (error) { announce(reasonOf(error, '바꿀 수 없습니다. 선택을 확인해 주세요.')); return false; }
    },
    openAdd: (seed = {}) => setAdding(seed),
    openManage: tab => setManaging(tab),
    openMenu: (at, title, list) => { at.preventDefault(); setMenu({ x: at.clientX, y: at.clientY, title, items: list }); },
    focusStudent: id => { setFocus(id); if (id) announce('이 학생이 오는 수업만 진하게 보입니다. Esc 또는 ‘강조 끄기’로 풉니다.'); },
    select, details: () => setPanel('inspect'),
  }), [announce, store]);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => { if (store.getSnapshot().draft !== savedDraft) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, [savedDraft, store]);
  const dirty = draft !== savedDraft;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    const save = (e: KeyboardEvent) => { if (!e.isComposing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault(); if (loading || comparison || library) return;
      // 반 합치기·나누기 같은 창이 열려 있으면 그 위에 보관함을 겹쳐 띄우지 않는다.
      if (document.querySelector('dialog[open]')) announce('열려 있는 창을 먼저 닫은 뒤 저장해 주세요.'); else showLibrary(true);
    } };
    window.addEventListener('keydown', save); return () => window.removeEventListener('keydown', save);
  }, [loading, comparison, library, announce]);
  useEffect(() => {
    // 창을 닫거나 버튼을 누른 뒤처럼 초점이 시간표 밖에 있어도 되돌리기가 듣게 한다. 시간표가 이미 처리했거나 글자를 치는 중이면 건드리지 않는다.
    const undo = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase(), target = e.target instanceof HTMLElement ? e.target : null;
      if (e.defaultPrevented || e.isComposing || !(e.ctrlKey || e.metaKey) || (k !== 'z' && k !== 'y')) return;
      const open = document.querySelector('dialog[open]');
      // 관리 창은 바꾼 것이 바로 적용되므로 그 안에서도 되돌릴 수 있다. 다른 창(추가·불러오기·보관함) 뒤에서는 보이지 않는 되돌리기를 하지 않는다.
      if (target?.closest('input, textarea, select, [contenteditable=true]') || (open && !open.classList.contains('manage-dialog'))) return;
      e.preventDefault(); (k === 'y' || e.shiftKey ? store.redo : store.undo)();
    };
    window.addEventListener('keydown', undo); return () => window.removeEventListener('keydown', undo);
  }, [store]);
  function loaded(next: Draft) {
    store.commit('기존 시간표 불러오기', next); setSavedId(null); select([]); setFocus(null);
    showLoad(false); announce('기존 시간표를 연습안으로 복사했습니다. 원본과 별개로 자유롭게 옮겨 보세요.');
  }
  /** 되돌릴 수 있는 변경의 목록 — 고른 지점까지 한꺼번에 되돌린다. */
  function historyMenu(): MenuItem[] {
    const labels = store.history();
    if (!labels.length) return [{ label: '아직 되돌릴 변경이 없습니다', disabled: true, run: () => {} }];
    return labels.slice(-12).reverse().map((label, i) => ({ label: `${i + 1}단계 전 · ${label}`, run: () => { store.undoMany(i + 1); announce(`‘${label}’까지 ${i + 1}단계를 되돌렸습니다. 다시 실행으로 복구할 수 있습니다.`); } }));
  }
  const started = items.length > 0 || (draft.teachers?.length ?? 0) > 0, look = appearanceOf(draft);
  /** 강사뷰의 주말 칸 — 토요일은 기본으로 보이고, 일요일은 기본으로 접혀 있다. */
  const weekend = ([['hideSaturday', '토요일', !look.hideSaturday], ['showSunday', '일요일', !!look.showSunday]] as const).map(([field, day, shown]) => ({ field, day, shown,
    done: shown ? `${day} 칸을 숨겼습니다. 수업이 있는 ${day} 칸은 그대로 보입니다.` : `${day} 칸을 폈습니다. 수업이 하나도 없는 새 강사 열은 평일만 보입니다.` }));
  /** 보기 설정은 연습본에 함께 저장된다(되돌리기도 된다). */
  function toggleView(field: 'hideEmptyDays' | 'hideStudents' | 'hideSaturday' | 'showSunday' | 'hidePeriods', done?: string) {
    const next = structuredClone(draft); next.appearance ??= structuredClone(look);
    next.appearance[field] = !next.appearance[field]; store.commit('보기 설정', next); if (done) announce(done);
  }
  return <div className="timetable-workspace">
    <header className="lab-topbar"><h1>시간표 편집기 <span>영어 · 연습본</span></h1>
      <span className="source-name">{draft.source ? `${draft.source.academy} · ${draft.source.date} 주` : items.length ? '예제 시간표' : '기존 시간표로 시작하세요'}</span>
      <button onClick={() => showLibrary(true)}>연습본 저장·불러오기·비교</button><button onClick={() => showLoad(true)}>기존 시간표 불러오기</button>{applyControls?.(markSaved)}</header>
    <div className="lab-controls"><div className="view-switch" role="tablist" aria-label="시간표 보기">
      <button role="tab" aria-selected={view === 'teacher'} onClick={() => { if (view !== 'teacher') { setView('teacher'); select([]); setPanel(null); setMenu(null); } }}>강사뷰</button>
      <button role="tab" aria-selected={view === 'integrated'} onClick={() => { if (view !== 'integrated') { setView('integrated'); select([]); setPanel(null); setMenu(null); } }}>통합뷰</button></div>
      <button className="add-button" onClick={() => actions.openAdd()} title="수업·반·회의 일정·강사·학생을 새로 만듭니다 (Insert)">＋ 추가</button>
      <button onClick={() => setManaging('teachers')} title="강사·학생·반·강의실을 목록으로 고칩니다">관리</button>
      <button className="view-option" aria-pressed={view === 'teacher' ? look.hideEmptyDays : look.hideStudents} onClick={() => toggleView(view === 'teacher' ? 'hideEmptyDays' : 'hideStudents')}>{view === 'teacher' ? '빈 요일 접기' : '학생 명단 접기'}</button>
      {view === 'integrated' && <button className="view-option" aria-pressed={!!look.hidePeriods} onClick={() => toggleView('hidePeriods')}>교시 접기</button>}
      {view === 'teacher' && weekend.map(w => <button className="view-option" key={w.field} disabled={look.hideEmptyDays} onClick={() => toggleView(w.field, w.done)}
        title={look.hideEmptyDays ? '‘빈 요일 접기’를 켠 동안에는 수업이 있는 요일만 보입니다.' : `${w.day} 칸을 ${w.shown ? '숨깁니다' : '폅니다'}. 수업이 있는 ${w.day} 칸은 숨겨도 그대로 보이고, 수업이 하나도 없는 새 강사 열은 평일만 보입니다.`}>{w.day} {w.shown ? '숨기기' : '보이기'}</button>)}
      <input className="schedule-search" aria-label="수업 강사 학생 검색" placeholder="수업 · 강사 · 학생 찾기" value={search} onChange={e => setSearch(e.target.value)} />
      <div className="history-buttons"><button disabled={!undos} onClick={store.undo} aria-label="되돌리기" title="Ctrl+Z">↶</button><button disabled={!redos} onClick={store.redo} aria-label="다시 실행" title="Ctrl+Shift+Z">↷</button>
        <button className="history-list" disabled={!undos} aria-haspopup="menu" title="지금까지의 변경을 보고 원하는 지점까지 되돌립니다" onClick={e => actions.openMenu(e, '변경 기록', historyMenu())}>기록</button></div>
      <label className="zoom-label">크기<select aria-label="시간표 크기" value={scale} onChange={e => { const scale = Number(e.target.value); actions.run('시간표 크기', draft => ({ ...draft, appearance: { ...appearanceOf(draft), scale } })); }}><option value="0.65">작게</option><option value="0.8">조밀하게</option><option value="1">기본</option><option value="1.25">크게</option></select></label>
      <button aria-pressed={panel === 'stats'} onClick={() => setPanel(panel === 'stats' ? null : 'stats')} title="강사별 시수·강의실 사용·반 인원">요약</button>
      <button className={`check-toggle ${checks.issues.length || checks.incomplete.length ? 'warning' : ''}`} aria-expanded={panel === 'inspect' && !selected.length} onClick={() => { if (panel === 'inspect' && !selected.length) setPanel(null); else { select([]); setPanel('inspect'); } }}>배치 확인 {checks.issues.length ? `· 겹침 ${checks.issues.length}` : ''}{checks.incomplete.length ? ` · 미확정 ${checks.incomplete.length}` : ''}</button>
    </div>
    {focus && <TrailBar store={store} student={focus} actions={actions} />}
    {/* 격자가 짧으면 그 아래 흰 곳은 상자 밖이다 — 거기를 눌러도 시간표에 초점을 둬 키보드(Delete·화살표·Esc·붙여넣기)가 그대로 듣게 한다.
        preventDefault를 먼저 — 안 그러면 뒤따르는 mousedown 기본 동작이 초점을 body로 되가져간다(재리뷰 실측). 바깥 누름으로 닫히는 메뉴·툴팁은 pointerdown을 들어 그대로 닫힌다. */}
    <div className="lab-workarea" onPointerDown={e => {
      if (e.target !== e.currentTarget) return;
      const box = e.currentTarget.querySelector<HTMLElement>('.schedule-scroll');
      if (box) { e.preventDefault(); box.focus({ preventScroll: true }); }
    }}>
      {started ? view === 'teacher' ? <ScheduleCanvas store={store} selected={selected} select={select} details={actions.details} announce={announce} zoom={zoom} search={search} actions={actions} focus={focus} />
        : <IntegratedView store={store} selected={selected} select={select} details={actions.details} zoom={zoom} search={search} announce={announce} actions={actions} focus={focus} /> : <section className="lab-empty">
        <div className="empty-schedule" aria-hidden="true"><i /><i /><i /></div><h2>지금 쓰는 시간표를 펼쳐 보세요</h2><p>수업을 옮겨 보고, 겹치는 이유를 확인하며<br />다음 시간표를 연습할 수 있습니다.</p>
        <button className="primary" onClick={() => showLoad(true)}>기존 시간표 불러오기</button><button className="sample-button" onClick={() => { store.commit('예제 열기', makeFixture()); }}>예제로 먼저 연습</button>
        <button className="sample-button" onClick={() => actions.openAdd({ kind: 'teacher' })}>빈 시간표에서 직접 만들기</button>
      </section>}
      {panel === 'inspect' && <Inspector key={selected[0] ?? 'all'} store={store} selected={selected} close={() => setPanel(null)} announce={announce} actions={actions} view={view} />}
      {panel === 'stats' && <StatsPanel store={store} actions={actions} close={() => setPanel(null)} />}
    </div>
    {selected.length > 0 && <SelectionBar store={store} selected={selected} actions={actions} view={view} />}
    <footer className="lab-status"><span role="status">{message}</span>
      <span>{selected.length > 0 ? `${selected.length}개 선택 · ` : ''}빈 칸을 끌어 새 수업 · Shift+끌기 여러 개 고르기 · 끝을 끌어 길이 · Alt+끌기 복제 · 우클릭 메뉴 · Ctrl+C / X / V · Ctrl+Z</span>
      <b>{dirty ? '저장하지 않은 변경 있음' : savedName ? `저장됨 · ${savedName}` : '이름을 붙여 연습본을 저장하세요'}</b></footer>
    {loading && <SourceDialog close={() => showLoad(false)} apply={loaded} loginHref={loginHref} />}
    {library && <DraftLibrary store={store} close={() => showLibrary(false)} currentId={savedId} saved={(name, value, id) => { setSavedDraft(value); setSavedName(name); setSavedId(id); announce(`“${name}”을 저장했습니다.`); }}
        removed={id => { if (id === savedId) { setSavedId(null); setSavedName(''); } }}
        pending={pendingApplies?.((name, value) => { store.commit('예약 연습본 불러오기', value); setSavedDraft(store.getSnapshot().draft); setSavedName(name); setSavedId(null); select([]); setFocus(null); setPanel(null); showLibrary(false); announce(`“${name}”을 불러왔습니다.`); })}
        loaded={(name, value, id) => { store.commit('저장한 연습본 불러오기', value); setSavedDraft(store.getSnapshot().draft); setSavedName(name); setSavedId(id); select([]); setFocus(null); setPanel(null); showLibrary(false); announce(`“${name}”을 불러왔습니다. 이어서 편집한 뒤 덮어쓰거나 새 연습본으로 저장할 수 있습니다.`); }}
        compare={(a, b) => { setComparison([a, b]); showLibrary(false); }} />}
    {comparison && <ComparisonView left={comparison[0]} right={comparison[1]} close={() => setComparison(null)} />}
    {managing && <ManageDialog store={store} initial={managing} actions={actions} close={() => setManaging(null)} />}
    {adding && <AddDialog store={store} seed={adding} actions={actions} close={() => setAdding(null)} />}
    {menu && <ContextMenu menu={menu} close={closeMenu} />}
    <LessonTooltip store={store} />
  </div>;
}
