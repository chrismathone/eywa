import { useEffect, useMemo, useRef, useState } from 'react';
import { DraftStore } from './store';
import { IntegratedView } from './integrated-view';
import { ScheduleCanvas } from './schedule-canvas';
import { compareDrafts } from './draft-comparison';
import { validate } from './constraints';
import type { Draft } from './model';
export type ComparedDraft = { name: string; draft: Draft };
const noop = () => {};
export function ComparisonView({ left, right, close }: { left: ComparedDraft; right: ComparedDraft; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), [view, setView] = useState<'teacher' | 'integrated'>('integrated'), [onlyChanges, setOnlyChanges] = useState(true);
  const changes = useMemo(() => compareDrafts(left.draft, right.draft), [left.draft, right.draft]);
  const stores = useMemo(() => [new DraftStore(left.draft), new DraftStore(right.draft)], [left.draft, right.draft]);
  const checks = useMemo(() => stores.map(s => validate(s.getSnapshot().draft)), [stores]);
  const changedIds = useMemo(() => changes.map(c => c.id), [changes]);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog className="lab-modal comparison-dialog" ref={dialog} aria-labelledby="comparison-title" onCancel={e => { e.preventDefault(); close(); }}>
    <header><h2 id="comparison-title">연습본 비교</h2><div className="view-switch"><button aria-pressed={view === 'teacher'} onClick={() => setView('teacher')}>강사뷰로 비교</button><button aria-pressed={view === 'integrated'} onClick={() => setView('integrated')}>통합뷰로 비교</button></div><button onClick={close}>비교 닫기</button></header>
    <div className="comparison-summary">수업 추가 {changes.filter(c => c.kind === '추가').length}개 · 삭제 {changes.filter(c => c.kind === '삭제').length}개 · 변경 {changes.filter(c => c.kind === '변경').length}개
      <span>파란 테두리 = 달라진 수업 · 비교 화면은 읽기 전용입니다.</span></div>
    <div className="comparison-panes">{[left, right].map((entry, index) => <section key={index} aria-label={`${index === 0 ? '왼쪽' : '오른쪽'} 연습본`}>
      <h3>{entry.name}<small>겹침 {checks[index].issues.length}건{checks[index].incomplete.length ? ` · 확인 필요 ${checks[index].incomplete.length}건` : ''}</small></h3>
      {view === 'teacher' ? <ScheduleCanvas store={stores[index]} selected={changedIds} select={noop} details={noop} announce={noop} zoom={.8} search="" readOnly />
        : <IntegratedView store={stores[index]} selected={changedIds} select={noop} details={noop} announce={noop} zoom={.8} search="" readOnly />}
    </section>)}</div>
    <details className="comparison-details" open={onlyChanges} onToggle={e => setOnlyChanges(e.currentTarget.open)}><summary>달라진 내용 {changes.length}건</summary>
      {!changes.length ? <p>수업 배치·학생 배정·반 이름·표시색이 같습니다.</p> : <table><thead><tr><th>구분</th><th>{left.name}</th><th>{right.name}</th><th>바뀐 내용</th></tr></thead><tbody>{changes.map(c => <tr key={c.id}><td>{c.kind}</td><td>{c.before}</td><td>{c.after}</td><td>{c.details.map((text, i) => <div key={i}>{text}</div>)}</td></tr>)}</tbody></table>}
    </details>
  </dialog>;
}
