// 배치 편집 보드의 **줄 목록** 도출 — 순수 함수(Vitest로 잠금).
//
// 🔴 왜 필요한가: 섹션은 [groupRichCards](./class-grid.ts)가 **카드(반)에서** 만든다. 그래서 반이 0개인
// 줄은 섹션이 아예 안 나오고, 편집 보드에서 그대로 쓰면 방금 만든 줄이 화면에서 사라진다 —
// '줄 추가'가 죽은 버튼처럼 보이고(하단 카운터만 늘어난다), 무엇보다 **드롭 칸이 없어 반을 넣을 길이
// 없어서 새 줄을 만드는 것 자체가 불가능**했다(원장 2026-08-14 *"줄 추가도 안되네?"*).
//
// ⚠️ 편집 보드 전용이다. 읽기 화면(통합뷰)은 지금처럼 빈 줄을 그리지 않는다 — 볼 게 없는 줄이다.
import { OTHERS_GROUP_ID, type RichCardGroup } from "./class-grid";
import type { GroupDraft } from "./group-assign";

/** 빈 줄 자리표 섹션 — 카드·교시축이 없고 `customGroupId`만 진짜다(드롭 칸이 되는 근거). */
function emptyRowSection(group: GroupDraft, order: number): RichCardGroup {
  return {
    key: `empty::${group.id}`,
    label: group.title,
    order,
    sectionKey: order,
    compacted: false,
    compactable: false, // 반이 없으니 '1시간 단위'로 나눌 것도 없다
    cards: [],
    periodRows: [],
    days: [],
    rosterRows: { active: 0, hold: 0, withdrawn: 0 },
    customGroupId: group.id,
  };
}

/**
 * 섹션 목록에 **반이 0개인 줄**을 끼워 넣고 줄 순서대로 정렬한다.
 *
 * 순서의 진실은 `groups` 배열이고, 미배정('기타')은 줄이 아니라 **늘 맨 뒤**다.
 * 한 줄이 평일·주말 두 섹션으로 갈린 경우 그 둘의 기존 순서는 그대로 지킨다(안정 정렬).
 */
export function withEmptyRowSections(
  sections: RichCardGroup[],
  groups: GroupDraft[],
): RichCardGroup[] {
  const shown = new Set(sections.map((s) => s.customGroupId));
  const missing = groups.filter((g) => !shown.has(g.id));
  const rank = (id?: string) => {
    if (!id || id === OTHERS_GROUP_ID) return groups.length;
    const i = groups.findIndex((g) => g.id === id);
    return i < 0 ? groups.length : i;
  };
  if (!missing.length) return sections;
  return [...sections, ...missing.map((g) => emptyRowSection(g, rank(g.id)))]
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(a.s.customGroupId) - rank(b.s.customGroupId) || a.i - b.i)
    .map((x) => x.s);
}
