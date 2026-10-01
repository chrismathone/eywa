import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT } from "@/features/dashboard/overview/layout";
import { classicToItems } from "./engine";
import { fillRows, holesOf, layoutAt, pack, sizeAt } from "./flow";
import type { Placed } from "./types";

const at = (placed: Placed[], id: string) => placed.find((p) => p.id === id)!;

describe("pack — CSS 격자 자동 배치(sparse)와 같은 자리", () => {
  it("한 줄을 넘치면 다음 줄 왼쪽부터", () => {
    const out = pack([
      { id: "a", w: 12, h: 1 },
      { id: "b", w: 12, h: 1 },
      { id: "c", w: 6, h: 1 },
    ]);
    expect(out.map((p) => [p.x, p.y])).toEqual([[0, 0], [12, 0], [0, 1]]);
  });

  it("2줄 카드 옆으로 다음 줄 카드가 흐른다(학교별 학생)", () => {
    const out = pack([
      { id: "a", w: 6, h: 1 },
      { id: "t", w: 6, h: 2 },
      { id: "b", w: 6, h: 1 },
      { id: "c", w: 6, h: 1 },
      { id: "d", w: 6, h: 1 },
      { id: "e", w: 6, h: 1 },
    ]);
    expect(at(out, "t")).toMatchObject({ x: 6, y: 0, h: 2 });
    expect(at(out, "d")).toMatchObject({ x: 0, y: 1 });
    expect(at(out, "e")).toMatchObject({ x: 12, y: 1 });
  });

  it("커서는 뒤로 가지 않는다 — 앞줄 빈칸을 뒤 카드가 채우지 않는다(읽는 순서 = 목록 순서)", () => {
    const out = pack([
      { id: "a", w: 18, h: 1 },
      { id: "b", w: 12, h: 1 },
      { id: "c", w: 6, h: 1 },
    ]);
    expect(at(out, "c")).toMatchObject({ x: 12, y: 1 });
  });

  it("지금 운영실(원장 기본)을 흘리면 옛 CSS 격자 자리와 같다", () => {
    const out = pack(classicToItems(DEFAULT_LAYOUT));
    // KPI 8칸이 한 줄
    expect(out.filter((p) => p.id.startsWith("kpi:")).every((p) => p.y === 0 && p.w === 3)).toBe(true);
    // 첫 구역: 4장 → 등록·퇴원/6개월 반씩 → 재원생 추이 한 줄
    expect(at(out, "heading:academy-overview")).toMatchObject({ y: 1, w: 24 });
    expect(at(out, "panel:changes")).toMatchObject({ x: 0, y: 3, w: 12 });
    expect(at(out, "panel:billing6")).toMatchObject({ x: 12, y: 3, w: 12 });
    expect(at(out, "panel:enrolledTrend")).toMatchObject({ x: 0, y: 4, w: 24 });
    // 둘째 구역: 학교별 학생이 2줄, 학습·학부모 보고 / 학생 상담이 반씩
    expect(at(out, "panel:schools")).toMatchObject({ x: 12, h: 2 });
    expect(at(out, "panel:reports").w).toBe(12);
    expect(at(out, "panel:studentConsult").x).toBe(12);
    expect(holesOf(out)).toEqual([]);
  });
});

describe("fillRows — 줄의 남는 칸은 그 줄 카드들이 나눠 갖는다(빈 공간 금지)", () => {
  it("3장(6열씩)이면 8열씩", () => {
    const out = fillRows(pack([{ id: "a", w: 6, h: 1 }, { id: "b", w: 6, h: 1 }, { id: "c", w: 6, h: 1 }]));
    expect(out.map((p) => [p.x, p.w])).toEqual([[0, 8], [8, 8], [16, 8]]);
  });

  it("2줄 카드가 아래 줄과 부딪히면 1줄 카드만 넓힌다 · 입력 순서는 그대로", () => {
    const placed = pack([
      { id: "t", w: 6, h: 2 },
      { id: "a", w: 6, h: 1 },
      { id: "b", w: 6, h: 1 },
      { id: "c", w: 18, h: 1 },
    ]);
    const out = fillRows(placed);
    expect(out.map((p) => p.id)).toEqual(["t", "a", "b", "c"]);
    expect(at(out, "t").w).toBe(6);
    expect(at(out, "a").w + at(out, "b").w).toBe(18);
  });

  it("머리줄은 그대로(한 줄 전체)", () => {
    const out = fillRows(pack([{ id: "heading:x", w: 24, h: 1 }, { id: "a", w: 6, h: 1 }]));
    expect(at(out, "heading:x").w).toBe(24);
    expect(at(out, "a").w).toBe(24);
  });
});

describe("layoutAt — 넓은 창 · 중간 · 폰이 같은 순서로 다시 흐른다", () => {
  const items = [
    { id: "kpi:students", w: 3, h: 1 },
    { id: "kpi:absent", w: 3, h: 1 },
    { id: "panel:attendance", w: 6, h: 1 },
    { id: "panel:changes", w: 12, h: 1 },
    { id: "panel:notices", w: 3, h: 1, mode: "summary" as const },
  ];

  it("중간 폭 = 폭 두 배(1×1 = 반 줄), 모두 한 줄 높이", () => {
    expect(sizeAt({ id: "panel:schools", w: 6, h: 2 }, "medium")).toEqual({ w: 12, h: 1 });
    expect(sizeAt({ id: "kpi:students", w: 3, h: 1 }, "medium")).toEqual({ w: 6, h: 1 });
  });

  it("폰 = KPI·요약만 반 줄, 나머지 한 줄", () => {
    expect(sizeAt(items[0]!, "mobile").w).toBe(12);
    expect(sizeAt(items[4]!, "mobile").w).toBe(12);
    expect(sizeAt(items[2]!, "mobile").w).toBe(24);
  });

  it("어느 폭이든 줄에 빈칸이 없다", () => {
    for (const bp of ["desktop", "medium", "mobile"] as const) {
      expect(holesOf(layoutAt(items, bp))).toEqual([]);
    }
  });
});
