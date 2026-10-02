import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { classList } from './class-commands';
import type { EditorActions, ManageTab } from './editor-actions';
import { draftStats, hoursLabel } from './insights';
import { deleteClass, replaceRoom } from './item-commands';
import { labelsOf, lessons } from './model';
import { addStudentToClass, removeStudentFromClass, renameStudent, studentSchedule } from './roster-commands';
import { reasonOf } from './reason';
import type { DraftStore } from './store';
import { moveTeacher, reassignTeacher, removeTeacher, renameTeacher, swapTeachers } from './teachers';

const tabs: { tab: ManageTab; label: string }[] = [
  { tab: 'teachers', label: '강사' }, { tab: 'students', label: '학생' }, { tab: 'classes', label: '반' }, { tab: 'rooms', label: '강의실' },
];
/** 강사·학생·반·강의실을 목록으로 한꺼번에 고친다. 바꾼 것은 바로 적용되고 하나씩 되돌릴 수 있다. */
export function ManageDialog({ store, initial, actions, close }: { store: DraftStore; initial: ManageTab; actions: EditorActions; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), [tab, setTab] = useState(initial);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  // 아래 상태줄은 이 창에 가려 안 보인다 — 된 일과 안 된 이유를 창 안에 적는다.
  const inner = useMemo<EditorActions>(() => ({ ...actions, run: (label, change, done) => {
    try { store.commit(label, change(store.getSnapshot().draft)); const text = done ?? '바꿨습니다.'; setNotice({ ok: true, text: text.includes('Ctrl+Z') ? text : `${text} Ctrl+Z로 되돌릴 수 있습니다.` }); actions.announce(text); return true; }
    catch (error) { const text = reasonOf(error, '바꿀 수 없습니다. 선택을 확인해 주세요.'); setNotice({ ok: false, text }); actions.announce(text); return false; }
  } }), [actions, store]);
  return <dialog ref={dialog} className="lab-modal manage-dialog" aria-labelledby="manage-title" onCancel={e => { e.preventDefault(); close(); }}>
    <header><h2 id="manage-title">강사·학생·반·강의실 관리</h2><button onClick={close} aria-label="관리 창 닫기">×</button></header>
    <div className="add-kinds" role="tablist" aria-label="관리할 대상">{tabs.map(t => <button key={t.tab} role="tab" aria-selected={tab === t.tab} onClick={() => { setTab(t.tab); setNotice(null); }}>{t.label}</button>)}</div>
    {notice && <p role={notice.ok ? 'status' : 'alert'} className={notice.ok ? 'clear-check manage-notice' : 'load-error manage-notice'}>{notice.text}</p>}
    {tab === 'teachers' && <Teachers store={store} actions={inner} />}
    {tab === 'students' && <Students store={store} actions={inner} close={close} />}
    {tab === 'classes' && <Classes store={store} actions={inner} close={close} />}
    {tab === 'rooms' && <Rooms store={store} actions={inner} />}
    <footer><button onClick={close}>닫기</button></footer>
  </dialog>;
}
type Part = { store: DraftStore; actions: EditorActions };

function Teachers({ store, actions }: Part) {
  const { draft } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const stats = useMemo(() => draftStats(draft).teachers, [draft]), names = stats.map(t => t.name);
  return <div className="manage-list" role="tabpanel" aria-label="강사">
    <p className="subtle">이름을 바꾸면 수업·색·담임 표시가 함께 바뀝니다. 수업을 넘기면 요일·시간·학생은 그대로이고 강사만 바뀝니다.</p>
    {stats.map((t, index) => <div className="manage-row" key={t.name} aria-label={`${t.name} 강사`} role="group">
      <form onSubmit={e => { e.preventDefault(); const to = String(new FormData(e.currentTarget).get('name'));
        actions.run('강사 이름 변경', d => renameTeacher(d, t.name, to), `${t.name} 강사의 이름을 ${to.trim()}(으)로 바꿨습니다.`); }}>
        <input name="name" aria-label={`${t.name} 이름`} defaultValue={t.name} maxLength={40} required /><button>이름 바꾸기</button></form>
      <span className="manage-meta">수업 {t.lessons}개 · {hoursLabel(t.minutes)}{t.blockMinutes ? ` · 일정 ${hoursLabel(t.blockMinutes)}` : ''}</span>
      <span className="manage-buttons">
        <button aria-label={`${t.name} 왼쪽으로`} disabled={index === 0} onClick={() => actions.run('강사 순서 변경', d => moveTeacher(d, t.name, -1))}>◀</button>
        <button aria-label={`${t.name} 오른쪽으로`} disabled={index === names.length - 1} onClick={() => actions.run('강사 순서 변경', d => moveTeacher(d, t.name, 1))}>▶</button>
        <select aria-label={`${t.name}의 수업을 넘기거나 맞바꿀 강사`} defaultValue="" onChange={e => {
          const [mode, other] = e.target.value.split('|'); e.target.value = '';
          if (mode === 'give') actions.run('강사 수업 넘기기', d => reassignTeacher(d, t.name, other), `${t.name} 강사의 수업을 모두 ${other} 강사에게 넘겼습니다.`);
          if (mode === 'swap') actions.run('강사 수업 맞바꾸기', d => swapTeachers(d, t.name, other), `${t.name}·${other} 강사의 수업을 맞바꿨습니다.`);
        }}><option value="" disabled>수업 넘기기·맞바꾸기</option>
          {names.filter(n => n !== t.name).map(n => <option key={`give-${n}`} value={`give|${n}`}>{n}에게 모두 넘기기</option>)}
          {names.filter(n => n !== t.name).map(n => <option key={`swap-${n}`} value={`swap|${n}`}>{n}와 맞바꾸기</option>)}</select>
        <button className="danger-text" title={t.lessons || t.blockMinutes ? '수업이나 일정이 남은 열은 지울 수 없습니다.' : undefined}
          onClick={() => actions.run('강사 열 지우기', d => removeTeacher(d, t.name), `${t.name} 열을 지웠습니다.`)}>지우기</button>
      </span>
    </div>)}
    <button onClick={() => actions.openAdd({ kind: 'teacher' })}>＋ 새 강사 열</button>
  </div>;
}

function Students({ store, actions, close }: Part & { close: () => void }) {
  const { draft } = useSyncExternalStore(store.subscribe, store.getSnapshot), people = labelsOf(draft);
  const [query, setQuery] = useState(''), classes = useMemo(() => classList(draft), [draft]);
  const ids = useMemo(() => Object.keys(people).filter(id => !query || people[id].includes(query.trim())).sort((a, b) => people[a].localeCompare(people[b], 'ko')), [people, query]);
  const shown = ids.slice(0, 60);
  return <div className="manage-list" role="tabpanel" aria-label="학생">
    <p className="subtle">한 학생이 여러 반을 함께 다닐 수 있습니다. 여기서 바꾸는 것은 연습본뿐이고 운영 원생목록은 그대로입니다.</p>
    <input className="manage-search" aria-label="학생 이름 찾기" placeholder="이름으로 찾기" value={query} onChange={e => setQuery(e.target.value)} />
    {shown.map(id => {
      const schedule = studentSchedule(draft, id), outside = classes.filter(c => !schedule.some(s => s.classId === c.id));
      return <div className="manage-row" key={`${id}-${people[id]}`} role="group" aria-label={`${people[id]} 학생`}>
        <form onSubmit={e => { e.preventDefault(); const to = String(new FormData(e.currentTarget).get('name'));
          actions.run('학생 이름 변경', d => renameStudent(d, id, to), '학생 이름을 바꿨습니다.'); }}>
          <input name="name" aria-label={`${people[id]} 이름`} defaultValue={people[id]} maxLength={40} required /><button>이름 바꾸기</button></form>
        <span className="manage-chips">{schedule.map(s => <span key={s.classId}>{s.name}
          <button className="mini" aria-label={`${people[id]} ${s.name}에서 빼기`} title="이 반에서 빼기" onClick={() => actions.run('학생을 반에서 빼기', d => removeStudentFromClass(d, id, s.classId))}>×</button></span>)}
          {!schedule.length && <i>배정된 반 없음</i>}</span>
        <span className="manage-buttons">
          <select aria-label={`${people[id]} 넣을 반`} defaultValue="" onChange={e => { const classId = e.target.value; e.target.value = '';
            actions.run('학생을 반에 추가', d => addStudentToClass(d, id, classId), `${people[id]} 학생을 반에 넣었습니다.`); }}>
            <option value="" disabled>반에 넣기</option>{outside.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <button onClick={() => { actions.focusStudent(id); close(); }}>동선 보기</button>
        </span>
      </div>;
    })}
    {ids.length > shown.length && <p className="subtle">{ids.length}명 중 {shown.length}명만 보입니다. 이름으로 찾아 주세요.</p>}
    {!ids.length && <p className="subtle">찾는 학생이 없습니다.</p>}
    <button onClick={() => actions.openAdd({ kind: 'student' })}>＋ 새 학생</button>
  </div>;
}

function Classes({ store, actions, close }: Part & { close: () => void }) {
  const { draft } = useSyncExternalStore(store.subscribe, store.getSnapshot), classes = useMemo(() => classList(draft), [draft]);
  return <div className="manage-list" role="tabpanel" aria-label="반">
    <p className="subtle">이름·담임·색·학생은 ‘고치기’에서, 수업 시간은 시간표에서 바로 옮겨 바꿉니다.</p>
    {classes.map(c => <div className="manage-row" key={c.id} role="group" aria-label={`${c.name} 반`}>
      <b>{c.name}</b>
      <span className="manage-meta">학생 {c.students.length}명 · 수업 {c.items.length}개 · {[...new Set(c.items.map(p => p.day))].join('·')}</span>
      <span className="manage-buttons">
        <button onClick={() => { actions.select(c.items.map(p => p.id)); actions.details(); close(); }}>고치기</button>
        <button onClick={() => actions.openAdd({ kind: 'lesson', classId: c.id, teacher: c.items[0]?.teacher })}>수업 추가</button>
        <button className="danger-text" onClick={() => actions.run('반 지우기', d => deleteClass(d, c.id), `${c.name} 반과 수업 ${c.items.length}개를 지웠습니다. Ctrl+Z로 되돌릴 수 있습니다.`)}>지우기</button>
      </span>
    </div>)}
    {!classes.length && <p className="subtle">아직 반이 없습니다.</p>}
    <button onClick={() => actions.openAdd({ kind: 'class' })}>＋ 새 반</button>
  </div>;
}

function Rooms({ store, actions }: Part) {
  const { draft } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const stats = useMemo(() => draftStats(draft), [draft]), unset = useMemo(() => lessons(draft).items.filter(p => !p.room && p.kind !== 'block' && p.kind !== 'seat').length, [draft]);
  return <div className="manage-list" role="tabpanel" aria-label="강의실">
    <p className="subtle">강의실 이름을 바꾸면 그 강의실을 쓰는 수업이 모두 바뀝니다. 다른 강의실 이름을 적으면 그쪽으로 합쳐집니다.</p>
    {stats.rooms.map(r => <div className="manage-row" key={r.room} role="group" aria-label={`${r.room} 강의실`}>
      <form onSubmit={e => { e.preventDefault(); const to = String(new FormData(e.currentTarget).get('room'));
        actions.run('강의실 찾아 바꾸기', d => replaceRoom(d, r.room, to), `${r.room} 강의실의 수업 ${r.lessons}개를 ${to.trim() || '미정'}(으)로 바꿨습니다.`); }}>
        <input name="room" aria-label={`${r.room} 새 이름`} defaultValue={r.room} maxLength={40} /><button>모두 바꾸기</button></form>
      <span className="manage-meta">수업 {r.lessons}개 · 주 {hoursLabel(r.minutes)}</span>
    </div>)}
    {unset > 0 && <p className="subtle">강의실이 정해지지 않은 수업이 {unset}개 있습니다. 시간표에서 수업을 골라 강의실을 정해 주세요.</p>}
    {!stats.rooms.length && <p className="subtle">강의실이 정해진 수업이 없습니다.</p>}
  </div>;
}
