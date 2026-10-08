import { integratedProjection } from './integrated-projection';
import { appearanceOf } from './appearance';
import { changed } from './class-commands';
import type { Draft } from './model';

/** 반 배정은 그대로 두고 통합뷰의 행·열 위치만 옮긴다. */
export function placeClass(draft: Draft, classId: string, targetId: string, side: 'before' | 'after'): Draft {
  if (classId === targetId) return draft;
  const projection = integratedProjection(draft);
  const source = projection.groups.find(group => group.cards.some(card => card.classId === classId));
  const destination = projection.groups.find(group => group.cards.some(card => card.classId === targetId));
  if (!source || !destination) throw new Error('옮길 반과 도착할 반을 다시 선택해 주세요.');
  const original = appearanceOf(draft).groups;
  const groups = projection.groups.map(group => ({
    id: original?.groups.find(saved => group.cards.some(card => saved.classIds.includes(card.classId)))?.id ?? group.key,
    title: group.label, classIds: group.cards.map(card => card.classId),
  }));
  const sourceIndex = projection.groups.indexOf(source), targetIndex = projection.groups.indexOf(destination);
  const before = [...groups[targetIndex].classIds];
  for (const group of groups) group.classIds = group.classIds.filter(id => id !== classId);
  const target = groups[targetIndex];
  target.classIds.splice(target.classIds.indexOf(targetId) + (side === 'after' ? 1 : 0), 0, classId);
  if (sourceIndex === targetIndex && target.classIds.every((id, index) => id === before[index])) return draft;
  for (const saved of original?.groups ?? []) {
    const missing = saved.classIds.filter(id => !projection.byClass.has(id));
    const shown = groups.find(group => group.id === saved.id);
    if (shown) shown.classIds.push(...missing);
    else if (missing.length) groups.push({ ...saved, classIds: missing });
  }
  const next = changed(draft);
  next.appearance = { ...structuredClone(appearanceOf(draft)), groups: { groups, showOthers: original?.showOthers ?? true, othersTitle: original?.othersTitle ?? '기타' } };
  return next;
}
