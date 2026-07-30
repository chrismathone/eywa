// 통합뷰 커스텀 그룹 편집기(드래그 보드)의 순수 상태 전이 — "어느 줄(섹션)에 어떤 반이, 어떤 순서로".
// ⚠️ `import "server-only"` 금지 — 클라 편집기가 쓴다([[#61]]). IO 없이 순수 함수만(Vitest로 잠근다).
//
// 왜 컴포넌트가 아니라 여기서 배열을 만지나:
// ① 저장 형식(`classIds` **순서** = 통합뷰 열 순서 `groupSeq`)이 드래그 결과와 1:1이라 규칙이 미묘하다.
//    같은 줄 안 이동은 arrayMove(자리 밀기), 다른 줄로는 "놓은 칩 앞에 삽입" — 섞이면 열 순서가 튄다.
// ② **이 주 시간표에 없는 반**의 배정도 배열에 남아 있다(다른 주엔 있는 반). 화면엔 칩이 없지만
//    빼버리면 저장 순간 그 배정이 사라진다 → 안 보이는 id를 보존하는 책임을 한 곳에 모은다.

export type GroupDraft = { id: string; title: string; classIds: string[] };
export type ClassOption = { classId: string; className: string };

/** 미배정 칸의 컨테이너 id — 그룹 id(uuid)와 섞이지 않게 예약어로 둔다. */
export const POOL_ID = "__pool__";

function arrayMove<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * 한 반이 여러 줄에 적혀 있으면 **먼저 나온 줄**이 갖는다 — 렌더(`applyCustomGroups`)·저장과 같은 규칙.
 * 편집을 시작할 때 1회 통과시켜, 칩이 한 곳에만 보이는 화면과 저장 결과가 어긋나지 않게 한다.
 */
export function dedupeGroups(groups: GroupDraft[]): GroupDraft[] {
  const seen = new Set<string>();
  return groups.map((g) => ({
    ...g,
    classIds: g.classIds.filter((id) => (seen.has(id) ? false : (seen.add(id), true))),
  }));
}

/** 어느 줄에도 없는 반 = 미배정(통합뷰 '기타 수업' 줄 또는 숨김). 입력 순서(가나다)를 유지한다. */
export function unassignedOf(classes: ClassOption[], groups: GroupDraft[]): ClassOption[] {
  const taken = new Set(groups.flatMap((g) => g.classIds));
  return classes.filter((c) => !taken.has(c.classId));
}

/** 그 줄에서 **이 주에 실제 있는** 반만(화면에 칩으로 그릴 목록) — 순서는 저장된 열 순서 그대로. */
export function visibleIdsOf(group: GroupDraft, classes: ClassOption[]): string[] {
  const known = new Set(classes.map((c) => c.classId));
  return group.classIds.filter((id) => known.has(id));
}

/**
 * 이 주 시간표엔 없는데 배정이 남아 있는 반 수 — 칩이 안 보여도 저장 때 **보존된다**는 걸 알리는 용도.
 * (조용히 지우면 다른 주 통합뷰의 줄 배치가 이유 없이 무너진다.)
 */
export function offWeekCount(groups: GroupDraft[], classes: ClassOption[]): number {
  const known = new Set(classes.map((c) => c.classId));
  return groups.reduce((n, g) => n + g.classIds.filter((id) => !known.has(id)).length, 0);
}

/** 줄(섹션) 순서 바꾸기 — 위에서부터 통합뷰 섹션 순서. 못 찾으면 원본 그대로. */
export function reorderGroups(groups: GroupDraft[], activeId: string, overId: string): GroupDraft[] {
  const from = groups.findIndex((g) => g.id === activeId);
  const to = groups.findIndex((g) => g.id === overId);
  if (from < 0 || to < 0 || from === to) return groups;
  return arrayMove(groups, from, to);
}

/**
 * 반 칩 이동. `target` = 줄 id 또는 `POOL_ID`(미배정), `beforeClassId` = 그 반 **앞**에 끼운다(null=맨 뒤).
 *
 * · 같은 줄 안 = `arrayMove`(끌어온 칩이 놓은 자리를 차지하고 나머지가 밀린다 = 흔한 정렬 감각).
 * · 다른 줄/미배정 = 모든 줄에서 빼고 목표 줄에만 넣는다(**중복 배정 원천 차단** — 한 반이 두 줄에
 *   뜨면 인원·명단이 두 번 세어진 것처럼 보인다).
 */
export function moveClass(
  groups: GroupDraft[],
  classId: string,
  target: string,
  beforeClassId: string | null,
): GroupDraft[] {
  const from = groups.find((g) => g.classIds.includes(classId));

  if (from && from.id === target) {
    const oldIndex = from.classIds.indexOf(classId);
    const newIndex = beforeClassId ? from.classIds.indexOf(beforeClassId) : from.classIds.length - 1;
    if (newIndex < 0 || newIndex === oldIndex) return groups;
    return groups.map((g) => (g.id === target ? { ...g, classIds: arrayMove(g.classIds, oldIndex, newIndex) } : g));
  }

  if (target !== POOL_ID && !groups.some((g) => g.id === target)) return groups; // 없는 줄 = 무동작
  const stripped = groups.map((g) =>
    g.classIds.includes(classId) ? { ...g, classIds: g.classIds.filter((x) => x !== classId) } : g,
  );
  if (target === POOL_ID) return stripped;
  return stripped.map((g) => {
    if (g.id !== target) return g;
    const ids = [...g.classIds];
    const at = beforeClassId ? ids.indexOf(beforeClassId) : -1;
    if (at >= 0) ids.splice(at, 0, classId);
    else ids.push(classId);
    return { ...g, classIds: ids };
  });
}
