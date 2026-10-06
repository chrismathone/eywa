import { useMemo, useState } from 'react';
import { classList } from './class-commands';
import type { EditorActions } from './editor-actions';
import { labelsOf, type Draft } from './model';
import { addStudentToClass } from './roster-commands';

/** 한 번에 보여 주는 결과 수 — 넘치면 더 입력해 좁히게 한다. */
const LIMIT = 30;
const fold = (text: string) => text.replace(/\s+/g, '').toLowerCase();

/** 이름으로 좁힌 학생 — 입력으로 시작하는 이름이 먼저, 그다음 가나다순. 이미 반에 있는 학생은 뺀다. */
export function findStudents(people: Record<string, string>, members: string[], query: string): string[] {
  const q = fold(query), inside = new Set(members);
  if (!q) return [];
  const starts = (id: string) => Number(fold(people[id]).startsWith(q));
  return Object.keys(people).filter(id => !inside.has(id) && fold(people[id]).includes(q))
    .sort((a, b) => starts(b) - starts(a) || people[a].localeCompare(people[b], 'ko'));
}

/**
 * 반에 넣을 학생을 이름으로 찾는다 — 학생이 수백 명이라 펼침 목록에서 고르지 않고 몇 글자를 쳐서 좁힌다.
 * 찾은 이름을 누르면 바로 들어간다(Ctrl+Z로 되돌린다). 결과가 한 명이면 Enter로도 넣는다.
 * 🔴 Enter로 넣으면 초점이 찾는 칸에 남는다 — 편집기의 되돌리기는 글자 칸 안에서 손을 떼므로, **방금 넣은 직후의 Ctrl+Z·Y는 여기서 연습본으로 넘긴다**.
 *    다시 글자를 치거나 칸을 떠나면 끈다 — 쳤다 지운 빈 칸에서 Ctrl+Z가 엉뚱한 변경을 되돌리면 안 된다.
 */
export function StudentPicker({ draft, classId, members, actions, undo, redo }: { draft: Draft; classId: string; members: string[]; actions: EditorActions; undo: () => void; redo: () => void }) {
  const [query, setQuery] = useState(''), [justAdded, setJustAdded] = useState(false), people = labelsOf(draft);
  const found = useMemo(() => findStudents(people, members, query), [people, members, query]);
  /** 학생 → 지금 다니는 반(같은 이름의 학생을 가르는 단서). */
  const classesOf = useMemo(() => {
    const result = new Map<string, string[]>();
    for (const c of classList(draft)) for (const id of c.students) result.set(id, [...result.get(id) ?? [], c.name]);
    return result;
  }, [draft]);
  const add = (id: string) => {
    if (actions.run('학생을 반에 추가', d => addStudentToClass(d, id, classId), `${people[id]} 학생을 이 반에 넣었습니다. 다른 반 배정은 그대로입니다.`)) { setQuery(''); setJustAdded(true); }
  };
  return <form className="student-picker" aria-label="반에 학생 넣기" onSubmit={e => {
    e.preventDefault();
    if (found.length === 1) add(found[0]); else if (found.length > 1) actions.announce(`${found.length}명이 있습니다. 아래 목록에서 넣을 학생을 눌러 주세요.`);
  }}>
    <label>학생 넣기<input type="search" aria-label="넣을 학생 찾기" placeholder="이름으로 찾기" autoComplete="off" value={query} onChange={e => { setQuery(e.target.value); setJustAdded(false); }} onBlur={() => setJustAdded(false)}
      onKeyDown={e => {
        const key = e.key.toLowerCase();
        if (!justAdded || query || e.nativeEvent.isComposing || !(e.ctrlKey || e.metaKey) || (key !== 'z' && key !== 'y')) return;
        e.preventDefault(); (key === 'y' || e.shiftKey ? redo : undo)();
      }} /></label>
    {query.trim() && <ul aria-label="찾은 학생">
      {found.slice(0, LIMIT).map(id => <li key={id}><button type="button" aria-label={`${people[id]} 이 반에 넣기`} title="눌러서 이 반에 넣기" onClick={() => add(id)}>
        <b>{people[id]}</b><small>{classesOf.get(id)?.join(' · ') ?? '반 없음'}</small></button></li>)}
      {found.length > LIMIT && <li className="subtle">외 {found.length - LIMIT}명 — 이름을 더 입력해 좁혀 주세요.</li>}
      {!found.length && <li className="subtle">이 반에 없는 학생 중에는 찾는 이름이 없습니다.</li>}
    </ul>}
    <div className="class-actions"><button type="button" onClick={() => actions.openAdd({ kind: 'student', classId })}>새 학생 만들기</button></div>
  </form>;
}
