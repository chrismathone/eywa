import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { reasonOf } from './reason';
import { classList, mergeClasses, moveClassStudent, renameClass, splitClass } from './class-commands';
import { labelsOf, timeLabel, type Draft } from './model';
import type { DraftStore } from './store';
import { deleteClass, setHomeroom } from './item-commands';
import { teacherColumns } from './teachers';

export function ClassTools({ store, classId, announce, cleared }: { store: DraftStore; classId: string; announce: (s: string) => void;
  /** 반을 지운 뒤 선택을 비운다. */ cleared?: () => void }) {
  const { draft, revision } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const classes = classList(draft), current = classes.find(c => c.id === classId), people = labelsOf(draft);
  const [mode, setMode] = useState<'merge' | 'split' | null>(null), [removing, setRemoving] = useState(false);
  if (!current) return null;
  function commit(label: string, change: () => Draft) {
    try { store.commit(label, change()); announce(`${label}했습니다. 두 화면에 함께 반영됩니다.`); }
    catch (error) { announce(reasonOf(error, '선택한 반을 확인해 주세요.')); }
  }
  return <section className="class-tools" aria-label="반 편집">
    <form key={`name-${current.name}`} aria-label="반 이름 변경" onSubmit={e => {
      e.preventDefault(); const name = String(new FormData(e.currentTarget).get('name'));
      commit('반 이름을 변경', () => renameClass(draft, classId, name));
    }}><label>반 이름<input name="name" defaultValue={current.name} required maxLength={80} /></label><button>반 이름 바꾸기</button></form>
    <label>담임<select aria-label="담임" value={draft.classes?.[classId]?.homeroomTeacher ?? ''} onChange={e => commit('담임을 변경', () => setHomeroom(draft, classId, e.target.value))}>
      <option value="">없음</option>{teacherColumns(draft).map(t => <option key={t}>{t}</option>)}</select></label>
    <div className="class-actions"><button onClick={() => setMode('merge')} disabled={classes.length < 2}>다른 반과 합치기</button>
      <button onClick={() => setMode('split')} disabled={current.students.length < 2} title={current.students.length < 2 ? '학생이 2명 이상인 반을 나눌 수 있습니다.' : undefined}>두 반으로 나누기</button></div>
    {current.students.length > 0 && <details><summary>학생을 다른 반으로 옮기기</summary>
      <form key={`roster-${revision}`} aria-label="다른 반으로 학생 이동" onSubmit={e => {
        e.preventDefault(); const values = new FormData(e.currentTarget);
        commit('학생을 다른 반으로 이동', () => moveClassStudent(draft, String(values.get('student')), classId, String(values.get('target'))));
      }}><label>옮길 학생<select name="student">{current.students.map(id => <option key={id} value={id}>{people[id] ?? '이름 미확인'}</option>)}</select></label>
        <label>옮길 반<select name="target" required defaultValue=""><option value="" disabled>반 선택</option>{classes.filter(c => c.id !== classId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <p className="subtle">현재 반에서 빼고, 선택한 반의 모든 수업에 배정합니다. 통합뷰에서 학생 이름을 끌어 옮겨도 됩니다.</p><button>선택한 반으로 학생 옮기기</button></form></details>}
    {removing ? <div className="confirm-row" role="alert"><span>{current.name} 반과 수업 {current.items.length}개를 연습본에서 지울까요?</span>
      <button className="danger" onClick={() => { try { store.commit('반 지우기', deleteClass(draft, classId)); announce(`${current.name} 반을 지웠습니다. Ctrl+Z로 되돌릴 수 있습니다.`); cleared?.(); } catch (error) { announce(reasonOf(error, '반을 지우지 못했습니다.')); setRemoving(false); } }}>지우기</button>
      <button onClick={() => setRemoving(false)}>취소</button></div>
      : <button className="danger-text" onClick={() => setRemoving(true)}>이 반 지우기</button>}
    {mode && <ClassDialog store={store} classId={classId} mode={mode} close={() => setMode(null)} announce={announce} />}
  </section>;
}
function ClassDialog({ store, classId, mode, close, announce }: { store: DraftStore; classId: string; mode: 'merge' | 'split'; close: () => void; announce: (s: string) => void }) {
  const [base] = useState(() => store.getSnapshot()), live = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const classes = classList(base.draft), current = classes.find(c => c.id === classId)!;
  const [target, setTarget] = useState(''), [name, setName] = useState(`${current.name} 새 반`), [chosen, setChosen] = useState<string[]>([]), [error, setError] = useState('');
  const to = classes.find(c => c.id === target), people = labelsOf(base.draft), dialog = useRef<HTMLDialogElement>(null), stale = live.revision !== base.revision;
  useEffect(() => { dialog.current?.showModal(); }, []);
  function apply() {
    if (store.getSnapshot().revision !== base.revision) { setError('편집 내용이 바뀌었습니다. 창을 닫고 다시 열어 확인해 주세요.'); return; }
    try {
      const next = mode === 'merge' ? mergeClasses(base.draft, classId, target) : splitClass(base.draft, classId, name, chosen);
      store.commit(mode === 'merge' ? '반 합치기' : '반 나누기', next);
      announce(mode === 'merge' ? `${current.name} 학생을 ${to!.name}의 모든 수업에 합쳤습니다. 되돌리기로 복구할 수 있습니다.` : '새 반을 만들었습니다. 같은 시간의 강사·강의실 겹침을 확인하고 수업을 옮겨 보세요.'); close();
    } catch (e) { setError(reasonOf(e, '반과 학생을 확인해 주세요.')); }
  }
  const schedule = mode === 'merge' ? to?.items : current.items;
  return <dialog ref={dialog} className="lab-modal class-dialog" aria-labelledby="class-dialog-title" onCancel={e => { e.preventDefault(); close(); }}>
    <header><h2 id="class-dialog-title">{mode === 'merge' ? '다른 반과 합치기' : '두 반으로 나누기'}</h2><button onClick={close} aria-label="반 편집 닫기">×</button></header>
    <p><strong>{current.name}</strong> · 학생 {current.students.length}명 · 주간 수업 {current.items.length}개</p>
    {mode === 'merge' ? <label>합친 뒤 남길 반<select autoFocus value={target} onChange={e => setTarget(e.target.value)}><option value="">반 선택</option>{classes.filter(c => c.id !== classId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      : <><label>새 반 이름<input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={80} /></label><fieldset><legend>새 반으로 옮길 학생 ({chosen.length}명 선택)</legend>
        {current.students.map(id => <label key={id}><input type="checkbox" checked={chosen.includes(id)} onChange={e => setChosen(e.target.checked ? [...chosen, id] : chosen.filter(s => s !== id))} />{people[id] ?? '이름 미확인'}</label>)}</fieldset></>}
    {(to || mode === 'split') && <div className="source-summary"><strong>바뀌는 내용</strong>
      {to ? <p>{current.name}의 수업 {current.items.length}개를 연습본에서 없애고, 두 반의 학생 {new Set([...current.students, ...to.students]).size}명을 {to.name}의 모든 수업에 배정합니다. 반 이름·색·시간표는 {to.name} 것을 유지합니다.</p>
        : <p>{current.name}에 {current.students.length - chosen.length}명, 새 반에 {chosen.length}명이 남습니다. 기존 등원 요일과 수업 시간·강사·색을 복사합니다. 처음에는 강사·강의실이 겹치므로 시간표를 조정해 주세요.</p>}
      <details><summary>{to ? '합친 뒤 사용할 시간표' : '새 반에 복사할 시간표'} ({schedule?.length}개)</summary><ul>{schedule?.map(p => <li key={p.id}>{p.day} {timeLabel(p.start)}~{timeLabel(p.end)} · {p.teacher} · {p.room || '강의실 미정'}</li>)}</ul></details>
      <small>운영 시간표는 바뀌지 않습니다. 한 번에 되돌릴 수 있습니다.</small></div>}
    {(error || stale) && <p role="alert" className="load-error">{stale ? '편집 내용이 바뀌었습니다. 창을 닫고 다시 열어 주세요.' : error}</p>}
    <footer><button onClick={close}>취소</button><button className="primary" onClick={apply} disabled={stale || (mode === 'merge' ? !to : !name.trim() || !chosen.length || chosen.length >= current.students.length)}>{mode === 'merge' ? '이 내용으로 반 합치기' : '이 내용으로 반 나누기'}</button></footer>
  </dialog>;
}
