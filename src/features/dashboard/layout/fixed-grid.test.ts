import { describe, expect, it } from "vitest";
import { addRow, appendItem, overlaps, placeItem, positionItems, resizeGridItem, uniformKpiItems } from "./fixed-grid";
import { newItem, removeItem, sameItems, sanitizeItems } from "./engine";
import { dashboardItemSchema } from "@/features/owner/settings-types";
import { MAX_GRID_Y, type Item } from "./types";

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
  it("카드 사이에 끼우면 오른쪽의 카드들이 같은 줄에서 밀린다", () => {
    const items = initial().slice(0, 3);
    const next = placeItem(items, { id: "kpi:makeup", w: 6, h: 1 }, 6, 0);
    expect(next.map((i) => [i.id, i.x, i.y])).toEqual([
      [items[0].id, 0, 0], [items[1].id, 12, 0], [items[2].id, 18, 0], ["kpi:makeup", 6, 0],
    ]);
    noOverlap(next);
  });
  it("한 줄이 꽉 찼을 때만 맨 끝 카드를 다음 줄 왼쪽으로 넘긴다", () => {
    const items = initial().slice(0, 4);
    const next = placeItem(items, { id: "kpi:makeup", w: 6, h: 1 }, 6, 0);
    expect(next[0]).toEqual(items[0]);
    expect(next[1]).toMatchObject({ x: 12, y: 0 });
    expect(next[2]).toMatchObject({ x: 18, y: 0 });
    expect(next[3]).toMatchObject({ x: 0, y: 2 });
    noOverlap(next);
  });
  it("기존 카드를 앞으로 끼워도 중복 없이 오른쪽으로 순서를 바꾼다", () => {
    const items = initial();
    const next = placeItem(items, items[3], 6, 0);
    expect(next[1]).toMatchObject({ x: 12, y: 0 });
    expect(next[2]).toMatchObject({ x: 18, y: 0 });
    expect(next[3]).toMatchObject({ x: 6, y: 0 });
    expect(next.slice(4)).toEqual(items.slice(4));
    expect(new Set(next.map((i) => i.id)).size).toBe(items.length);
    noOverlap(next);
  });
  it("다음 줄이 차 있으면 그 줄도 오른쪽으로 이어 밀고 빈 예약 칸은 소비한다", () => {
    const items = [
      ...initial().slice(0, 4),
      { id: "kpi:makeup", x: 0, y: 2, w: 6, h: 2 },
      { id: "space:empty", x: 6, y: 2, w: 18, h: 2 },
    ];
    const next = placeItem(items, { id: "kpi:intake", w: 6, h: 1 }, 6, 0);
    expect(next.find((i) => i.id === "kpi:makeup")).toMatchObject({ x: 6, y: 2 });
    expect(next.some((i) => i.id === "space:empty")).toBe(false);
    noOverlap(next);
  });
  it("아래 경계를 넘는 끼워 넣기는 전체를 취소한다", () => {
    const items = initial().slice(0, 4).map((i) => ({ ...i, y: MAX_GRID_Y - 2 }));
    expect(placeItem(items, { id: "kpi:makeup", w: 6, h: 1 }, 6, MAX_GRID_Y - 2)).toEqual(items);
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

describe("KPI 크기 통일", () => {
  const mixed = () => [
    ...["students", "courses", "withdrawals", "enrolledToday", "intake", "calendar", "firstClass", "absent", "makeup"].map((k, n) => ({ id: `kpi:${k}`, w: n < 6 ? 3 : 2, h: 2, x: n < 6 ? n * 3 : 18 + (n - 6) * 2, y: 0 })),
    { id: "heading:next", title: "다음 구역", x: 0, y: 3, w: 24, h: 1 },
    { id: "panel:billingMonth", title: "이번 달 수납", x: 6, y: 5, w: 12, h: 4, amounts: false },
  ];
  it.each([2, 3, 6] as const)("폭 %i로 9개 KPI를 통일하고 아래 구역의 간격과 옵션을 보존한다", (width) => {
    const items = mixed();
    const next = uniformKpiItems(items, width);
    const perRow = 24 / width;
    next.slice(0, 9).forEach((i, n) => expect(i).toMatchObject({ w: width, h: 2, x: n % perRow * width, y: Math.floor(n / perRow) * 2 }));
    const delta = Math.ceil(9 / perRow) * 2 - 2;
    expect(next.slice(9)).toEqual(items.slice(9).map((i) => ({ ...i, y: i.y + delta })));
    expect(sanitizeItems(JSON.parse(JSON.stringify(next)))).toEqual(next);
    next.forEach((i) => expect(dashboardItemSchema.safeParse(i).success).toBe(true));
    noOverlap(next);
  });
  it("목록 순서가 달라도 화면에서 읽는 순서를 따르고 좁히면 아래 구역을 당긴다", () => {
    const wide = uniformKpiItems(mixed(), 6).reverse();
    expect(uniformKpiItems(wide, 2).reverse()).toEqual(uniformKpiItems(mixed(), 2));
  });
  it("KPI가 없거나 아래 구역이 경계를 넘으면 기존 배치를 유지한다", () => {
    expect(uniformKpiItems(initial().slice(4), 3)).toEqual(initial().slice(4));
    const items = mixed();
    items[10].y = MAX_GRID_Y - items[10].h;
    expect(uniformKpiItems(items, 6)).toEqual(items);
  });
});
