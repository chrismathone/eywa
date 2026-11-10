import { describe, expect, it } from "vitest";
import { boundaryNear, emptyBandAt, emptyRowBands, fitContentRows, insertGridRows, removeGridRows, rowBoundaries } from "./grid-rows";
import { overlaps, positionItems } from "./fixed-grid";
import { dashboardSchema } from "@/features/owner/settings-types";
import type { Item } from "./types";

const items: Item[] = [
  { id: "heading:top", title: "구역", x: 0, y: 0, w: 24, h: 1 },
  { id: "panel:nowClasses", x: 0, y: 5, w: 6, h: 4 },
  { id: "panel:notices", x: 12, y: 5, w: 6, h: 2 },
];
describe("대시보드 행 편집", () => {
  it("모든 열이 빈 행만 삭제하고 아래 카드의 열·크기를 그대로 당긴다", () => {
    expect(emptyRowBands(items)).toEqual([{ y: 1, h: 4 }]);
    expect(removeGridRows(items, 1, 4)).toEqual(items.map((i) => i.y === 5 ? { ...i, y: 1 } : i));
    expect(removeGridRows(items, 4, 2)).toEqual(items);
    expect(removeGridRows(items, 6, 1)).toEqual(items);
  });
  it("중간 삽입은 해당 경계 아래 카드만 이동하고 카드 중간은 거절한다", () => {
    expect(insertGridRows(items, 1, 3)).toEqual(items.map((i) => i.y === 5 ? { ...i, y: 8 } : i));
    expect(insertGridRows(items, 6, 2)).toEqual(items);
    expect(rowBoundaries(items)).not.toContain(7);
    expect(removeGridRows(insertGridRows(items, 1, 3), 1, 3)).toEqual(items);
  });
  it("우클릭 자리 → 가장 가까운 행 경계 · 카드 한가운데면 그 카드의 위·아래 경계로(원장 2026-10-14)", () => {
    // 경계 = 0~5, 9(카드가 5~9행을 차지해 6~8은 없다)
    expect(boundaryNear(items, 0.2)).toBe(0);
    expect(boundaryNear(items, 2.6)).toBe(3);
    expect(boundaryNear(items, 6.2)).toBe(5); // 카드 위쪽 절반 → 카드 위 경계
    expect(boundaryNear(items, 8.1)).toBe(9); // 카드 아래쪽 → 카드 아래 경계
    expect(boundaryNear(items, 30)).toBe(9); // 맨 아래보다 더 아래 → 맨 끝
    expect(boundaryNear(items, -3)).toBe(0);
    expect(emptyBandAt(items, 2)).toEqual({ y: 1, h: 4 });
    expect(emptyBandAt(items, 6)).toBeNull();
  });
  it("맨 끝에 추가한 빈 행은 저장 후에도 유지하며, 빈 행을 모두 없앨 수 있다", () => {
    const added = insertGridRows(items, 9, 4, "space:last");
    const saved = added;
    expect(positionItems(saved).at(-1)?.y).toBe(12);
    expect(emptyRowBands(saved)).toContainEqual({ y: 9, h: 4 });
    expect(removeGridRows(saved, 9, 4)).toEqual(items);
  });
  it("빈 예약 영역 중간에 넣거나 지워도 행 끝과 카드 위치가 맞는다", () => {
    const reserved = [...items, { id: "space:reserved", x: 0, y: 9, w: 24, h: 32 }];
    const added = insertGridRows(reserved, 20, 4, "space:last");
    expect(Math.max(...positionItems(added).map((i) => i.y + i.h))).toBe(45);
    expect(removeGridRows(added, 9, 36)).toEqual(items);
  });
  it("자동 내용 높이는 겹친 카드만 같은 열에서 밀고 반복 계산에도 늘어나지 않는다", () => {
    const base = [{ id: "panel:consultProgress", x: 0, y: 0, w: 12, h: 4 }, { id: "panel:notices", x: 0, y: 4, w: 12, h: 4 }, { id: "panel:nowClasses", x: 12, y: 4, w: 12, h: 4 }];
    const next = fitContentRows(base, { "panel:consultProgress": 8 });
    expect(next[1].y).toBe(8);
    expect(next[2]).toEqual(base[2]);
    expect(next.some((a, n) => next.slice(n + 1).some((b) => overlaps(a, b)))).toBe(false);
    expect(fitContentRows(base, { "panel:consultProgress": 8 })).toEqual(next);
    expect(fitContentRows(base, { "panel:consultProgress": NaN })).toEqual(base);
    const tall = fitContentRows(base, { "panel:consultProgress": 64 });
    const saved = { version: 1, layouts: [{ role: "subject", items: tall }] };
    expect(dashboardSchema.safeParse(saved).success).toBe(true);
  });
});
