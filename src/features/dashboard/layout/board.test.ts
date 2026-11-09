import { describe, expect, it } from "vitest";
import { MENU_KEYS } from "@/lib/permissions";
import { boardOf, isBoardItems, toBoardItems } from "./board";
import { editOf, itemsOf, placePanel, removeSection, setKpi, toggleCore } from "./board-edit";
import { defaultItems } from "./defaults";
import { normalizeDashboard } from "./normalize";
import { loadPlan, resolveView } from "./view";
import type { Item } from "./types";

/** 침산 과목 관리자처럼 저장된 옛 배치(좌표 · 구역 · 민감 옵션). */
const legacy: Item[] = [
  { id: "kpi:students", x: 0, y: 0, w: 6, h: 1 },
  { id: "kpi:calendar", x: 6, y: 0, w: 6, h: 1, phones: true },
  { id: "kpi:absent", x: 12, y: 0, w: 6, h: 1 },
  { id: "heading:a", x: 0, y: 1, w: 24, h: 1, title: "수업", note: "오늘" },
  { id: "panel:nowClasses", x: 0, y: 2, w: 12, h: 1 },
  { id: "panel:billingMonth", x: 12, y: 2, w: 6, h: 1, amounts: true },
  { id: "panel:changes", x: 18, y: 2, w: 6, h: 1, title: "등록 흐름" },
  { id: "heading:b", x: 0, y: 3, w: 24, h: 1, title: "공지" },
  { id: "panel:notices", x: 0, y: 4, w: 6, h: 1 },
];

describe("옛 배치 → 새 대시보드 모양(원장 2026-11-09 '자동 옮김')", () => {
  const items = toBoardItems(legacy);
  const board = boardOf(items);

  it("카드는 하나도 잃지 않고 제목·민감 옵션도 그대로 · 좌표는 버린다", () => {
    const before = legacy.filter((i) => !i.id.startsWith("heading:")).map((i) => i.id);
    for (const id of before) expect(items.some((i) => i.id === id), id).toBe(true);
    expect(items.find((i) => i.id === "panel:billingMonth")?.amounts).toBe(true);
    expect(items.find((i) => i.id === "panel:changes")?.title).toBe("등록 흐름");
    expect(items.some((i) => i.x !== undefined || i.y !== undefined)).toBe(false);
  });

  it("시안의 추이·구성 카드는 두 머리줄 아래로, 나머지는 옛 구역 그대로 오늘 운영에", () => {
    expect(board.trend).toEqual(["changes"]);
    expect(board.mix).toEqual(["billingMonth"]);
    expect(board.today.map((s) => [s.title, s.panels])).toEqual([["수업", ["nowClasses"]], ["공지", ["notices"]]]);
    expect(board.core).toEqual(["newcomers", "management", "workRecords"]);
  });

  it("KPI는 옛 순서로 오늘 운영 띠에 · 한눈에 보기는 종전 화면 규칙(최근 결석 자리에 오늘 입테 · 전화번호 옵션도 따라감)", () => {
    expect(board.kpis).toEqual(["students", "calendar", "absent"]);
    expect(board.glance).toEqual(["students", "todayTests"]);
    // 침산 과목 관리자 저장 배치 — 종전 한눈에 보기 6칸 그대로.
    const subject = ["students", "withdrawals", "intake", "calendar", "enrolledToday", "firstClass", "absent", "makeup"].map((k) => ({ id: `kpi:${k}`, w: 3, h: 1 }));
    expect(boardOf(toBoardItems(subject)).glance).toEqual(["students", "withdrawals", "intake", "enrolledToday", "todayTests", "makeup"]);
    expect(items.find((i) => i.id === "kpi:todayTests")?.phones).toBe(true);
  });

  it("두 번 옮겨도 같다 · 저장값 정규화도 같은 결과", () => {
    expect(isBoardItems(items)).toBe(true);
    expect(toBoardItems(items)).toEqual(items);
    const saved = normalizeDashboard({ version: 1, layouts: [{ role: "subject", items: legacy }] });
    expect(boardOf(saved.layouts[0]!.items)).toEqual(board);
  });

  it("원장 옛 배치는 등록 후 3개월 내 퇴원을 6개월 청구 뒤에 넣는다(종전 화면이 값이 오면 세우던 칸) · 다른 역할은 넣지 않는다", () => {
    const owner = [{ id: "panel:billing6", w: 12, h: 1 }, { id: "panel:notices", w: 6, h: 1 }];
    expect(boardOf(toBoardItems(owner, { owner: true })).trend).toEqual(["billing6", "earlyExits"]);
    expect(boardOf(toBoardItems(owner)).trend).toEqual(["billing6"]);
  });

  it("이름을 비운 구역도 구역으로 남는다(저장 정리가 '이름 없는 구역'으로)", () => {
    const e = editOf(defaultItems("desk"));
    const head = e.today[0]!.head.id;
    const items = itemsOf({ ...e, today: e.today.map((s) => (s.head.id === head ? { ...s, head: { ...s.head, title: "" } } : s)) });
    const saved = normalizeDashboard({ version: 1, layouts: [{ role: "desk", items }] });
    const today = boardOf(saved.layouts[0]!.items).today;
    expect(today[0]?.title).toBe("이름 없는 구역");
    expect(today[0]?.panels).toEqual(boardOf(defaultItems("desk")).today[0]?.panels);
  });

  it("🔴 옮겨도 서버 조회 범위는 같다 — 오늘 입테는 전일 입테와 같은 일정 영역", () => {
    const menus = new Set(MENU_KEYS);
    const plan = (list: Item[]) => [...loadPlan(resolveView({ stored: { version: 1, layouts: [{ role: "desk", items: list }] }, bundle: "desk", menus }), menus)].sort();
    expect(plan(items)).toEqual(plan(legacy));
  });
});

describe("칸 목록 편집(board-edit)", () => {
  const base = editOf(defaultItems("owner"));

  it("편집 모양 ↔ 저장 모양이 그대로 오간다", () => {
    expect(itemsOf(base)).toEqual(defaultItems("owner"));
  });

  it("한눈에 보기 KPI는 6칸까지 — 넘치게 켜면 그대로 둔다", () => {
    const next = setKpi(base, "makeup", { glance: true });
    expect(next).toBe(base);
    const freed = setKpi(base, "intake", { glance: false });
    expect(boardOf(itemsOf(setKpi(freed, "makeup", { glance: true }))).glance).toContain("makeup");
  });

  it("두 곳 다 끈 KPI는 배치에서 빠진다(그 영역은 다른 칸이 없으면 조회하지 않는다)", () => {
    const off = setKpi(setKpi(base, "makeup", { today: false }), "makeup", { glance: false });
    expect(itemsOf(off).some((i) => i.id === "kpi:makeup")).toBe(false);
  });

  it("카드 하나는 한 자리 — 다른 자리로 넣으면 옮긴다(옵션 유지) · 구역을 지우면 그 카드도 빠진다", () => {
    const moved = placePanel(base, "billingMonth", "trend");
    expect(boardOf(itemsOf(moved)).mix).not.toContain("billingMonth");
    expect(boardOf(itemsOf(moved)).trend.at(-1)).toBe("billingMonth");
    const head = base.today[0]!.head.id;
    expect(boardOf(itemsOf(removeSection(base, head))).today.flatMap((s) => s.panels)).not.toContain("subjects");
    expect(boardOf(itemsOf(toggleCore(base, "management", false))).core).toEqual(["newcomers", "workRecords"]);
  });
});
