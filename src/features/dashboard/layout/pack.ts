/**
 * 기본 배치 다듬기 — 지금 운영실에서 민감 칸을 뺀 뒤 **구역이 앙상해지는 공간 낭비**를 없앤다(원장 2026-10-01 *"쓸데 없는 공간낭비 안하게"*).
 * 순수 함수(서버·DB 무관). 역할별 시안(2026-10-01, `9d49c5f7c`)의 규칙을 기본 배치에 그대로 쓴다:
 *  1. 카드가 한 줄을 못 채우는 구역은 제목줄을 두지 않고 **이웃 구역과 한 흐름으로 합친다**(첫 구역이면 다음 구역 앞에).
 *  2. 줄 전체를 쓰는 카드(`followup`·재원생 추이)는 구역 맨 끝에 둬 줄 중간이 비지 않게 한다.
 * 줄의 남는 칸은 흐름 배치(`flow.ts` 줄 채우기)가 나눠 채운다 — 그래서 시안의 '열 수 = 카드 수'는 따로 계산하지 않는다.
 */
import type { LayoutSection, OverviewLayout, PanelSlot } from "@/features/dashboard/overview/layout";

const FULL_ROW: readonly PanelSlot[] = ["followup", "enrolledTrend"];
const WIDE: readonly PanelSlot[] = ["changes", "billing6"];
/** 지금 운영실 구역의 열 수(4열 격자). */
const ROW = 4;

const weight = (p: PanelSlot) => (WIDE.includes(p) ? 2 : 1);
const sum = (list: readonly PanelSlot[]) => list.reduce((n, p) => n + weight(p), 0);

export function packLayout(layout: OverviewLayout): OverviewLayout {
  type Group = { head: LayoutSection; panels: PanelSlot[] };
  const groups: Group[] = [];
  let carry: PanelSlot[] = [];
  let carryHead: LayoutSection | null = null;
  for (const section of layout.sections) {
    const panels = [...carry, ...section.panels];
    if (panels.length === 0) continue;
    const weighed = sum(panels.filter((p) => !FULL_ROW.includes(p)));
    if (section.title && weighed >= ROW) {
      groups.push({ head: section, panels });
      carry = [];
      carryHead = null;
    } else if (groups.length > 0) {
      // 한 줄을 못 채우면 앞 구역 흐름에 이어 붙인다.
      groups[groups.length - 1]!.panels.push(...panels);
      carry = [];
    } else {
      carry = panels; // 첫 구역이 모자라면(제목 유무와 무관) 다음 구역 앞으로
      carryHead = section;
    }
  }
  if (carry.length > 0) groups.push({ head: { ...(carryHead ?? { id: "carry", panels: [] }), title: "", note: "" }, panels: carry });
  const sections: LayoutSection[] = groups.map(({ head, panels }) => ({
    ...head,
    panels: [...panels.filter((p) => !FULL_ROW.includes(p)), ...panels.filter((p) => FULL_ROW.includes(p))],
  }));
  return { ...layout, sections };
}
