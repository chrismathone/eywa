import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { reasonOf } from './reason';
import { classList } from './class-commands';
import { validate } from './constraints';
import type { AddKind, AddSeed, EditorActions } from './editor-actions';
import { addBlock, addClass, addLesson, type Slot } from './item-commands';
import { days, lessons, timeLabel, timeMinutes, type Draft } from './model';
import { operatingHoursOf, operatingLabel } from './operating-times';
import { addStudentToClass, createStudent } from './roster-commands';
import type { DraftStore } from './store';
import { addTeacher, teacherColumns } from './teachers';

const kinds: { kind: AddKind; label: string; done: string; hint: string }[] = [
  { kind: 'lesson', label: '수업', done: '수업을', hint: '이미 있는 반에 수업을 하나 더합니다. 그 반 학생이 모두 배정됩니다.' },
  { kind: 'class', label: '새 반', done: '새 반을', hint: '새 반을 만들고 첫 수업을 놓습니다. 학생은 만든 뒤에 넣습니다.' },
  { kind: 'block', label: '회의·일정', done: '일정을', hint: '회의·상담 같은 비수업 일정입니다. 수업 운영시간 밖에도 둘 수 있습니다.' },
  { kind: 'teacher', label: '강사', done: '강사 열을', hint: '새 강사 열을 만듭니다. 수업이 없어도 열이 보여 수업을 놓을 수 있습니다.' },
  { kind: 'student', label: '학생', done: '학생을', hint: '연습본에만 있는 새 학생을 만듭니다(입학 예정 등). 운영 원생목록에는 생기지 않습니다.' },
];
const placed = (kind: AddKind) => kind === 'lesson' || kind === 'class' || kind === 'block';

/** 새 수업·반·일정·강사·학생을 만든다. 놓기 전에 운영시간과 새로 생길 겹침을 미리 보여 준다. */
export function AddDialog({ store, seed, actions, close }: { store: DraftStore; seed: AddSeed; actions: EditorActions; close: () => void }) {
  const { draft } = useSyncExternalStore(store.subscribe, store.getSnapshot), dialog = useRef<HTMLDialogElement>(null);
  const all = useMemo(() => lessons(draft).items, [draft]), classes = useMemo(() => classList(draft), [draft]);
  const teachers = useMemo(() => teacherColumns(draft, all), [draft, all]);
  const rooms = useMemo(() => [...new Set(all.map(p => p.room).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko', { numeric: true })), [all]);
  const [kind, setKind] = useState<AddKind>(seed.kind ?? (teachers.length ? classes.length ? 'lesson' : 'class' : 'teacher'));
  const [day, setDay] = useState(seed.day ?? '월'), [pickedTeacher, setTeacher] = useState(seed.teacher ?? '');
  const firstStart = operatingHoursOf(draft)[seed.day ?? '월']?.[0]?.start ?? 840;
  const [start, setStart] = useState(timeLabel(seed.start ?? firstStart)), [end, setEnd] = useState(timeLabel(seed.end ?? (seed.start ?? firstStart) + 60));
  const [room, setRoom] = useState(''), [pickedClass, setClassId] = useState(seed.classId ?? ''), [name, setName] = useState('');
  // 창을 연 채로 강사·반을 더하거나 지울 수 있다(계속 추가) — 고른 값이 없어졌으면 첫 항목을 쓴다.
  const teacher = teachers.includes(pickedTeacher) ? pickedTeacher : teachers[0] ?? '', classId = classes.some(c => c.id === pickedClass) ? pickedClass : classes[0]?.id ?? '';
  const [target, setTarget] = useState(seed.kind === 'student' ? seed.classId ?? '' : ''), [more, setMore] = useState(false), [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  const a = timeMinutes(start), b = timeMinutes(end);
  const slot: Slot | null = a !== null && b !== null ? { day, teacher, start: a, end: b, room } : null;

  /** 지금 입력대로 만든 연습본. 실제로 적용하지는 않는다 — 미리 보기와 적용이 같은 계산을 쓴다. */
  const build = (base: Draft): Draft => {
    if (kind === 'teacher') return addTeacher(base, name);
    if (kind === 'student') { const made = createStudent(base, name); return target ? addStudentToClass(made.draft, made.id, target) : made.draft; }
    if (!slot) throw new Error('시작과 종료 시간을 입력해 주세요.');
    return kind === 'lesson' ? addLesson(base, classId, slot) : kind === 'class' ? addClass(base, name, slot) : addBlock(base, name, slot);
  };
  const preview = useMemo(() => {
    if ((kind !== 'lesson' && !name.trim()) || (placed(kind) && !slot)) return { blocked: '', fresh: [] as string[] };
    try {
      const before = new Set(validate(draft).issues.map(i => i.key));
      return { blocked: '', fresh: validate(build(draft)).issues.filter(i => !before.has(i.key)).map(i => i.message) };
    } catch (e) { return { blocked: reasonOf(e, '입력한 내용을 확인해 주세요.'), fresh: [] as string[] }; }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- build는 아래 입력값으로만 정해진다
  }, [draft, kind, name, classId, target, day, teacher, start, end, room]);

  function apply() {
    const before = new Set(store.getSnapshot().draft.placements.map(p => p.id));
    const { label, done } = kinds.find(k => k.kind === kind)!;
    try {
      const next = build(store.getSnapshot().draft);
      store.commit(`${label} 추가`, next);
      const made = next.placements.filter(p => !before.has(p.id)).map(p => p.id);
      if (made.length) actions.select(made);
      actions.announce(placed(kind) ? `${done} ${day} ${start}~${end}에 추가했습니다. Ctrl+Z로 되돌릴 수 있습니다.` : `“${name.trim()}” ${done} 추가했습니다.`);
      if (more) { setName(''); setError(''); } else close();
    } catch (e) { setError(reasonOf(e, '추가하지 못했습니다. 입력한 내용을 확인해 주세요.')); }
  }
  const ready = kind === 'lesson' ? !!classId && !!teacher && !!slot : placed(kind) ? !!name.trim() && !!teacher && !!slot : !!name.trim();
  return <dialog ref={dialog} className="lab-modal add-dialog" aria-labelledby="add-title" onCancel={e => { e.preventDefault(); close(); }}>
    <header><h2 id="add-title">새 항목 추가</h2><button onClick={close} aria-label="추가 창 닫기">×</button></header>
    <div className="add-kinds" role="radiogroup" aria-label="추가할 항목">{kinds.map(k => <button key={k.kind} role="radio" aria-checked={kind === k.kind}
      disabled={(k.kind === 'lesson' && !classes.length) || (placed(k.kind) && !teachers.length)} onClick={() => { setKind(k.kind); setError(''); }}>{k.label}</button>)}</div>
    <p className="subtle">{kinds.find(k => k.kind === kind)!.hint}</p>
    <form onSubmit={e => { e.preventDefault(); apply(); }}>
      {kind === 'lesson' && <label>반<select aria-label="수업을 더할 반" value={classId} onChange={e => setClassId(e.target.value)}>{classes.map(c => <option key={c.id} value={c.id}>{c.name} · {c.students.length}명</option>)}</select></label>}
      {kind !== 'lesson' && <label>{kind === 'class' ? '반 이름' : kind === 'block' ? '일정 이름' : kind === 'teacher' ? '강사 이름' : '학생 이름'}
        <input autoFocus aria-label="이름" value={name} maxLength={80} onChange={e => setName(e.target.value)} placeholder={kind === 'block' ? '예: 강사 회의' : kind === 'class' ? '예: 영어 D' : ''} /></label>}
      {placed(kind) && <>
        <label>요일<select aria-label="요일" value={day} onChange={e => setDay(e.target.value)}>{days.map(d => <option key={d}>{d}</option>)}</select></label>
        <label>강사<select aria-label="강사" value={teacher} onChange={e => setTeacher(e.target.value)}>{teachers.map(t => <option key={t}>{t}</option>)}</select></label>
        <label>시작<input aria-label="시작" type="time" value={start} onChange={e => setStart(e.target.value)} required /></label>
        <label>종료<input aria-label="종료" type="time" value={end} onChange={e => setEnd(e.target.value)} required /></label>
        <div className="duration-presets">{[40, 50, 60, 80, 90].map(n => <button type="button" key={n} disabled={a === null} onClick={() => setEnd(timeLabel(a! + n))}>{n}분</button>)}</div>
        {kind !== 'block' && <label>강의실<input aria-label="강의실" list="add-rooms" value={room} maxLength={40} onChange={e => setRoom(e.target.value)} placeholder="비워 두면 미정" />
          <datalist id="add-rooms">{rooms.map(r => <option key={r} value={r} />)}</datalist></label>}
        {kind !== 'block' && <small>{day}요일 운영시간: {operatingLabel(draft, day)}</small>}
      </>}
      {kind === 'student' && <label>넣을 반<select aria-label="넣을 반" value={target} onChange={e => setTarget(e.target.value)}><option value="">나중에 넣기</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      {(error || preview.blocked) && <p role="alert" className="load-error">{error || preview.blocked}</p>}
      {!preview.blocked && preview.fresh.length > 0 && <p role="status" className="lab-conflict">이 자리에 놓으면 겹침이 {preview.fresh.length}건 생깁니다. 그래도 놓을 수 있습니다.<br />{preview.fresh[0]}</p>}
      {!preview.blocked && !preview.fresh.length && placed(kind) && ready && <p role="status" className="clear-check">이 자리는 겹치는 수업이 없습니다.</p>}
      <footer><label className="keep-open"><input type="checkbox" checked={more} onChange={e => setMore(e.target.checked)} />계속 추가</label>
        <button type="button" onClick={close}>취소</button><button className="primary" disabled={!ready || !!preview.blocked}>추가</button></footer>
    </form>
  </dialog>;
}
