import { describe, expect, it } from "vitest";
import { addRow, appendItem, overlaps, placeItem, positionItems, resizeGridItem } from "./fixed-grid";
import { newItem, removeItem, sameItems, sanitizeItems } from "./engine";
import { dashboardItemSchema } from "@/features/owner/settings-types";
import type { Item } from "./types";

const initial = () => positionItems([
  ...["students", "withdrawals", "firstClass", "absent"].map((k) => ({ id: `kpi:${k}`, w: 6, h: 1 })),
  { id: "panel:nowClasses", w: 12, h: 1 }, { id: "panel:notices", w: 6, h: 1 },
]);
const noOverlap = (items: Item[]) => {
  const placed = positionItems(items);
  for (let n = 0; n < placed.length; n++) for (let m = n + 1; m < placed.length; m++) expect(overlaps(placed[n], placed[m])).toBe(false);
};

describe("고정 행·열 배치", () => {
  it("첫 행 카드 4개와 둘째 행을 분리하고 남은 폭을 늘리지 않는다", () => {
    const items = initial();
    expect(items.slice(0, 4).map((i) => [i.x, i.y, i.w, i.h])).toEqual([[0, 0, 6, 2], [6, 0, 6, 2], [12, 0, 6, 2], [18, 0, 6, 2]]);
    expect(items[4]).toMatchObject({ x: 0, y: 2, w: 12, h: 4 });
    expect(items[5]).toMatchObject({ x: 12, y: 2, w: 6 });
    noOverlap(items);
  });
  it("삭제·추가 후에도 나머지 카드 위치와 크기를 유지한다", () => {
    const items = initial();
    const next = appendItem(removeItem(items, items[1].id), newItem("panel:subjects"));
    for (const item of items.filter((i) => i.id !== items[1].id)) expect(next.find((i) => i.id === item.id)).toEqual(item);
    expect(next.at(-1)).toMatchObject({ x: 0, y: 6 });
    noOverlap(next);
  });
  it("기존에 작게 줄인 KPI 네 개 뒤의 패널도 별도 행에서 시작한다", () => {
    const items = positionItems([...initial().slice(0, 4).map((i) => ({ id: i.id, w: 3, h: 1 })), { id: "panel:nowClasses", w: 12, h: 1 }]);
    expect(items[4]).toMatchObject({ x: 0, y: 2, w: 12 });
    expect(items.slice(0, 4).every((i) => i.w === 3 && i.y === 0)).toBe(true);
  });
  it("행·열을 넘는 확장은 겹친 카드만 아래로 옮긴다", () => {
    const items = initial();
    const next = resizeGridItem(items, items[0].id, { w: 9, h: 5 });
    expect(next[0]).toMatchObject({ x: 0, y: 0, w: 9, h: 5 });
    expect(next[1]).toMatchObject({ x: 6, y: 5, w: 6 });
    expect(next[2]).toEqual(items[2]);
    expect(next[3]).toEqual(items[3]);
    noOverlap(next);
  });
  it("빈 행은 저장·재조회 후 남고 그곳에 카드를 놓을 수 있다", () => {
    const items = addRow(initial(), "test");
    const saved = sanitizeItems(JSON.parse(JSON.stringify(items)));
    expect(saved).toEqual(items);
    for (const i of saved) expect(dashboardItemSchema.safeParse(i).success).toBe(true);
    const next = appendItem(saved, newItem("panel:subjects"));
    expect(next.some((i) => i.id === "space:test")).toBe(false);
    expect(next.at(-1)).toMatchObject({ x: 0, y: 6 });
    expect(next.slice(0, initial().length)).toEqual(initial());
  });
  it("프리셋에 없는 크기와 위치도 저장하고 변경으로 인식한다", () => {
    const item = { id: "panel:notices", w: 7, h: 5, x: 3, y: 9 };
    expect(sanitizeItems([item])).toEqual([item]);
    expect(sameItems([item], [{ ...item, y: 10 }])).toBe(false);
  });
  it("오른쪽 경계에서 확장해도 왼쪽 열은 움직이지 않는다", () => {
    const items = initial();
    expect(resizeGridItem(items, items[3].id, { w: 24, h: 2 })[3]).toMatchObject({ x: 18, w: 6 });
  });
  it("긴 카드가 있던 옛 배치도 겹치지 않게 변환한다", () => {
    const items = positionItems([{ id: "panel:schools", w: 24, h: 2 }, { id: "panel:notices", w: 6, h: 1 }]);
    expect(items[1].y).toBe(8);
    noOverlap(items);
  });
  it("반복 이동·확장·축소해도 겹침이나 범위 이탈이 없다", () => {
    let items: Item[] = initial();
    for (let n = 0; n < 70; n++) {
      const item = items[n % items.length];
      items = placeItem(items, item, n % 20, n % 16);
      items = resizeGridItem(items, item.id, { w: 3 + n % 12, h: 1 + n % 8 });
      noOverlap(items);
      for (const i of positionItems(items)) expect(i.x + i.w).toBeLessThanOrEqual(24);
    }
  });
});
