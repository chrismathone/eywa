import { labelsOf, lessons, timeLabel, type Draft, type Lesson } from './model';
export type Difference = { id: string; name: string; kind: '추가' | '삭제' | '변경'; before: string; after: string; details: string[] };
const position = (p: Lesson) => `${p.name} · ${p.day} ${timeLabel(p.start)}~${timeLabel(p.end)} · ${p.teacher} · ${p.room || '강의실 미정'}`;
export function compareDrafts(before: Draft, after: Draft): Difference[] {
  const a = new Map(lessons(before).items.map(p => [p.id, p])), b = new Map(lessons(after).items.map(p => [p.id, p]));
  const result: Difference[] = [], people = { ...labelsOf(before), ...labelsOf(after) };
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    const old = a.get(id), current = b.get(id), details: string[] = [];
    if (old && current) {
      if (old.name !== current.name) details.push(`반 이름: ${old.name} → ${current.name}`);
      if (old.day !== current.day || old.start !== current.start || old.end !== current.end) details.push(`시간: ${old.day} ${timeLabel(old.start)}~${timeLabel(old.end)} → ${current.day} ${timeLabel(current.start)}~${timeLabel(current.end)}`);
      if (old.teacher !== current.teacher || old.teacherId !== current.teacherId) details.push(`강사: ${old.teacher} → ${current.teacher}`);
      if (old.room !== current.room || old.roomId !== current.roomId) details.push(`강의실: ${old.room || '미정'} → ${current.room || '미정'}`);
      if (old.kind !== current.kind || old.labSeparate !== current.labSeparate) details.push('수업·자습 구분 변경');
      const oldStudents = new Set(old.students), newStudents = new Set(current.students);
      const added = current.students.filter(s => !oldStudents.has(s)), removed = old.students.filter(s => !newStudents.has(s));
      if (added.length) details.push(`새로 배정: ${added.map(s => people[s] ?? '이름 미확인').join(', ')}`);
      if (removed.length) details.push(`배정에서 빠짐: ${removed.map(s => people[s] ?? '이름 미확인').join(', ')}`);
      if (JSON.stringify(before.classes?.[old.classId]?.color) !== JSON.stringify(after.classes?.[current.classId]?.color)
        || JSON.stringify(before.appearance?.teacherColors[old.teacher]) !== JSON.stringify(after.appearance?.teacherColors[current.teacher])) details.push('표시색 변경');
      if (!details.length) continue;
    } else {
      const p = (current ?? old)!; details.push(`학생 ${p.students.length}명: ${p.students.map(s => people[s] ?? '이름 미확인').join(', ') || '배정 없음'}`);
    }
    result.push({ id, name: (current ?? old)!.name, kind: !old ? '추가' : !current ? '삭제' : '변경', before: old ? position(old) : '없음', after: current ? position(current) : '없음', details });
  }
  return result;
}
