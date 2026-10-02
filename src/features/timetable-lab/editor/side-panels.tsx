import { useMemo, useSyncExternalStore } from 'react';
import type { EditorActions } from './editor-actions';
import { draftStats, hoursLabel } from './insights';
import { blockMenu } from './menus';
import { days, labelsOf, lessons, timeLabel } from './model';
import { studentSchedule } from './roster-commands';
import type { DraftStore } from './store';

/** 연습본의 주간 요약. 편집할 때마다 다시 센다 — 한 강사에게 수업이 몰렸는지, 빈 강의실이 있는지 바로 보인다. */
export function StatsPanel({ store, actions, close }: { store: DraftStore; actions: EditorActions; close: () => void }) {
  const { draft } = useSyncExternalStore(store.subscribe, store.getSnapshot), stats = useMemo(() => draftStats(draft), [draft]);
  const most = Math.max(1, ...stats.teachers.map(t => t.minutes)), busiest = Math.max(1, ...stats.rooms.map(r => r.minutes));
  return <aside className="lab-inspector stats-panel" aria-label="연습본 요약"><header><h2>연습본 요약</h2><button onClick={close} aria-label="요약 닫기">×</button></header>
    <p className="stats-line">겹침 <b>{stats.issues}건</b> · 학생 <b>{stats.students.total}명</b>{stats.students.multi > 0 && ` · 두 반 이상 ${stats.students.multi}명`}
      {stats.students.unassigned > 0 && ` · 반 없는 학생 ${stats.students.unassigned}명`}{stats.noRoom > 0 && ` · 강의실 미정 ${stats.noRoom}개`}</p>
    <h3>강사별 주간 수업</h3>
    <ul className="stats-bars">{stats.teachers.map(t => <li key={t.name}><span>{t.name}</span><i style={{ width: `${Math.round(t.minutes / most * 100)}%` }} />
      <b>{t.lessons}개 · {hoursLabel(t.minutes)} · {t.days}일</b></li>)}</ul>
    <h3>강의실 사용</h3>
    {stats.rooms.length ? <ul className="stats-bars">{stats.rooms.map(r => <li key={r.room}><span>{r.room}</span><i style={{ width: `${Math.round(r.minutes / busiest * 100)}%` }} />
      <b>{r.lessons}개 · {hoursLabel(r.minutes)}</b></li>)}</ul> : <p className="subtle">강의실이 정해진 수업이 없습니다.</p>}
    <h3>반 인원</h3>
    <ul className="stats-classes">{stats.classes.map(c => <li key={c.id}><button onClick={() => { const ids = lessons(draft).items.filter(p => p.classId === c.id).map(p => p.id); actions.select(ids); }}>{c.name}</button>
      <b>{c.students}명 · 주 {c.lessons}회</b></li>)}</ul>
    <p className="subtle">반 이름을 누르면 그 반의 수업이 시간표에서 선택됩니다.</p>
  </aside>;
}

/** 한 학생의 주간 동선 — 어느 요일 몇 시에 어느 반·강사에게 가는지와, 겹치는 시간. */
export function TrailBar({ store, student, actions }: { store: DraftStore; student: string; actions: EditorActions }) {
  const { draft } = useSyncExternalStore(store.subscribe, store.getSnapshot), name = labelsOf(draft)[student] ?? '이름 미확인';
  const items = useMemo(() => studentSchedule(draft, student).flatMap(c => c.items).sort((a, b) => days.indexOf(a.day) - days.indexOf(b.day) || a.start - b.start), [draft, student]);
  const outside = (draft.outside ?? []).filter(p => p.students.includes(student)).length;
  return <div className="trail-bar" role="status" aria-label={`${name} 주간 동선`}>
    <b>{name} 학생의 주간 동선</b>
    <span>{items.length ? items.map(p => `${p.day} ${timeLabel(p.start)} ${p.name}`).join(' → ') : '이 연습본에 배정된 수업이 없습니다.'}{outside > 0 && ` · 다른 과목 ${outside}개`}</span>
    <button onClick={() => actions.select(items.map(p => p.id))}>이 수업들 고르기</button><button onClick={() => actions.focusStudent(null)}>강조 끄기</button>
  </div>;
}

/** 수업을 고르면 나타나는 도구줄 — 우클릭 메뉴와 같은 동작을 버튼으로. */
export function SelectionBar({ store, selected, actions }: { store: DraftStore; selected: string[]; actions: EditorActions }) {
  const { draft } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const first = useMemo(() => lessons(draft).items.find(p => selected.includes(p.id)), [draft, selected]);
  if (!first) return null;
  const items = blockMenu(draft, first, selected, actions).filter(item => item !== null && !/요일에도 놓기$/.test(item.label));
  return <div className="selection-bar" role="toolbar" aria-label="고른 수업 도구">
    <b>{selected.length}개 선택</b>
    {items.map(item => item && <button key={item.label} disabled={item.disabled} className={item.danger ? 'danger-text' : undefined} title={item.hint} onClick={item.run}>{item.label}</button>)}
    <button onClick={e => actions.openMenu(e, '다른 요일에도 놓기', blockMenu(draft, first, selected, actions).filter(item => item !== null && /요일에도 놓기$/.test(item.label)))}>다른 요일에도 놓기 ▾</button>
    <button onClick={() => actions.select([])}>선택 해제</button>
  </div>;
}
