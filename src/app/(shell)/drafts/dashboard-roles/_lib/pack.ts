/**
 * 역할별 배치 채우기 — 카드가 적어 한 줄이 비는 **공간 낭비**를 없앤다(원장 2026-10-01 *"쓸데 없는 공간낭비 안하게"*).
 * 순수 함수(서버·DB 무관). 규칙:
 *  1. 카드가 한 줄을 못 채우는 구역은 제목줄을 두지 않고 **이웃 구역과 한 흐름으로 합친다**(첫 구역이면 다음 구역 앞에).
 *  2. 한 구역의 열 수는 카드 수에 맞춘다 — 3장이면 3열, 2장이면 2열. 넘치면 마지막 줄이 가장 덜 비는 열 수.
 *  3. 빈 상태 카드(데이터 0건)는 맨 뒤 **얇은 줄**로 모은다(같은 줄 카드 높이를 늘리지 않는다).
 * 줄 전체를 쓰는 카드(`followup`·재원생 추이)는 구역 맨 끝에 둬 줄 중간이 비지 않게 한다.
 */
import type { LayoutSection, OverviewLayout, PanelId, PanelSlot } from "@/features/dashboard/overview/layout";

const FULL_ROW: readonly PanelSlot[] = ["followup", "enrolledTrend"];
const WIDE: readonly PanelSlot[] = ["changes", "billing6"];

const weight = (p: PanelSlot) => (WIDE.includes(p) ? 2 : 1);
const sum = (list: readonly PanelSlot[]) => list.reduce((n, p) => n + weight(p), 0);

/** 카드 폭 합 w를 max열 안에서 가장 덜 비게 놓는 열 수. */
export function fitColumns(w: number, max: number, hasWide: boolean): number {
  const floor = hasWide ? 2 : 1;
  if (w <= max) return Math.max(floor, w);
  let best = max;
  let bestGap = (max - (w % max)) % max;
  for (let c = max - 1; c >= Math.max(3, floor); c--) {
    const gap = (c - (w % c)) % c;
    if (gap < bestGap) {
      best = c;
      bestGap = gap;
    }
  }
  return best;
}

export function packLayout(layout: OverviewLayout, empty: ReadonlySet<PanelId>): OverviewLayout {
  const max = layout.columns ?? 4;
  const thinPanels: PanelSlot[] = [];
  type Group = { head: LayoutSection; panels: PanelSlot[] };
  const groups: Group[] = [];
  let carry: PanelSlot[] = [];
  let carryHead: LayoutSection | null = null;
  for (const section of layout.sections) {
    const live = section.panels.filter((p) => {
      if (p !== "followup" && empty.has(p)) {
        thinPanels.push(p);
        return false;
      }
      return true;
    });
    const panels = [...carry, ...live];
    const weighed = sum(panels.filter((p) => !FULL_ROW.includes(p)));
    if (panels.length === 0) continue;
    if (section.title && weighed >= max) {
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
  const sections: LayoutSection[] = groups.map(({ head, panels }) => {
    const normal = panels.filter((p) => !FULL_ROW.includes(p));
    const full = panels.filter((p) => FULL_ROW.includes(p));
    return {
      ...head,
      panels: [...normal, ...full],
      columns: fitColumns(sum(normal), max, normal.some((p) => WIDE.includes(p))),
    };
  });
  if (thinPanels.length > 0) {
    sections.push({ id: "thin", title: "", note: "", panels: thinPanels, columns: Math.min(thinPanels.length, max), thin: true });
  }
  return { ...layout, evenGap: true, sections };
}
