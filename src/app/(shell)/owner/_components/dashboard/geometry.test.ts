import { describe, expect, it } from "vitest";
import { MENU_KEYS, type MenuKey } from "@/lib/permissions";
import { pack } from "@/features/dashboard/layout/flow";
import { badgesFor, exposureOf, optionOn, scopeLine, sensitiveReason } from "./badges";
import { GAP, HEADING_H, ROW_H, gridSizeFromPixels, insertionIndex, metricsOf, rectOf, verticalNeighbor } from "./geometry";

describe("캔버스 기하", () => {
  const placed = pack([
    { id: "heading:a", w: 24, h: 1 },
    { id: "a", w: 6, h: 1 },
    { id: "b", w: 6, h: 2 },
    { id: "c", w: 12, h: 1 },
    { id: "d", w: 6, h: 1 },
  ]);
  const m = metricsOf(placed, 24 * 40 - GAP);

  it("머리줄만 있는 줄은 낮고, 2줄 카드는 줄 두 개 + 간격", () => {
    expect(m.rowHeights[0]).toBe(HEADING_H);
    expect(m.rowHeights[1]).toBe(ROW_H);
    const b = rectOf(placed.find((p) => p.id === "b")!, m);
    expect(b.height).toBe(ROW_H * 2 + GAP);
    expect(b.left).toBe(6 * 40);
    expect(b.width).toBe(6 * 40 - GAP);
  });

  it("끼울 자리 — 카드 왼쪽 절반은 앞, 오른쪽 절반은 뒤, 맨 아래는 끝", () => {
    const others = placed.map((p) => ({ id: p.id, rect: rectOf(p, m), full: p.w >= 24 }));
    const a = others[1]!.rect;
    expect(insertionIndex(others, { x: a.left + 5, y: a.top + 5 }, null, null)).toBe(1);
    expect(insertionIndex(others, { x: a.left + a.width - 5, y: a.top + 5 }, null, null)).toBe(2);
    expect(insertionIndex(others, { x: 10, y: m.height + 50 }, null, null)).toBe(others.length);
  });

  it("🔑 놓을 자리(ghost) 안이면 그대로 — 비켜 흐르며 떨지 않게", () => {
    const others = placed.map((p) => ({ id: p.id, rect: rectOf(p, m), full: p.w >= 24 }));
    const ghost = others[3]!.rect;
    expect(insertionIndex(others, { x: ghost.left + 3, y: ghost.top + 3 }, ghost, 7)).toBe(7);
  });

  it("손잡이로 끈 픽셀 → 격자 크기", () => {
    expect(gridSizeFromPixels(6 * 40 - GAP, ROW_H, m)).toEqual({ w: 6, h: 1 });
    expect(gridSizeFromPixels(12 * 40 - GAP, ROW_H * 2 + GAP, m)).toEqual({ w: 12, h: 2 });
  });

  it("위·아래 화살표 = 가장 가까운 열의 윗줄·아랫줄 카드", () => {
    expect(verticalNeighbor(placed, "d", -1)).toBe("a");
    expect(verticalNeighbor(placed, "a", 1)).toBe("d");
    expect(verticalNeighbor(placed, "heading:a", -1)).toBeNull();
  });
});

describe("민감 6가지 꼬리표(기본 모두 가림)", () => {
  const ALL = new Set<MenuKey>(MENU_KEYS);
  it("원장 밖 역할: 금액·직원 카드는 '민감', 과목 관리자는 강사 시트·퇴원 명단도", () => {
    expect(sensitiveReason("panel:staff", "desk")).not.toBeNull();
    expect(sensitiveReason("panel:billing6", "manager")).not.toBeNull();
    expect(sensitiveReason("panel:sheets", "subject")).not.toBeNull();
    expect(sensitiveReason("kpi:withdrawals", "subject")).not.toBeNull();
    expect(sensitiveReason("panel:sheets", "manager")).toBeNull();
    expect(sensitiveReason("panel:staff", "owner")).toBeNull();
  });

  it("금액·전화번호 옵션 기본 = 원장만 보임", () => {
    expect(optionOn({}, "amounts", "desk")).toBe(false);
    expect(optionOn({}, "phones", "subject")).toBe(false);
    expect(optionOn({}, "amounts", "owner")).toBe(true);
    expect(optionOn({ amounts: true }, "amounts", "desk")).toBe(true);
    expect(badgesFor({ id: "panel:billingMonth", w: 6, h: 1 }, "desk", ALL).map((b) => b.text)).toEqual(["금액 가림"]);
  });

  it("권한 없는 카드는 '권한 없어 안 보임', 과목 관리자의 학원 전체 카드는 '학원 전체'", () => {
    const noBilling = new Set<MenuKey>(MENU_KEYS.filter((m) => m !== "billing"));
    expect(badgesFor({ id: "panel:billing6", w: 12, h: 1 }, "desk", noBilling)[0]?.text).toBe("권한 없어 안 보임");
    expect(badgesFor({ id: "panel:expenses", w: 6, h: 1 }, "subject", ALL).map((b) => b.text)).toContain("학원 전체 값");
    expect(scopeLine("panel:expenses", "subject")).toContain("학원 전체 값으로 보입니다");
    // 2단계(원장 2026-10-14) — 출결은 담당 과목으로 다시 센다.
    expect(scopeLine("panel:attendance", "subject")).toContain("담당 과목");
    expect(scopeLine("panel:subjects", "subject")).toContain("담당 과목");
    expect(scopeLine("panel:subjects", "desk")).toBeNull();
  });
});

describe("꼬리표 = 서버가 실제로 내보내는 것(resolveView 판정)", () => {
  const ALL = new Set<MenuKey>(MENU_KEYS);
  const month = { id: "panel:billingMonth", w: 6, h: 1 };
  const cal = { id: "panel:admissionsSchedule", w: 6, h: 1 };

  it("6개월 카드가 함께 있으면 이번 달 카드의 금액을 꺼도 '금액 일부 보임'(그 카드로 금액이 내려간다)", () => {
    const items = [month, { id: "panel:billing6", w: 12, h: 1 }];
    const ex = exposureOf(items, "desk", ALL);
    expect(ex).toMatchObject({ amounts: true, monthAmounts: false, billing6: true });
    expect(badgesFor(month, "desk", ALL, ex).map((b) => b.text)).toContain("금액 일부 보임");
  });

  it("일정 카드가 둘이면 하나만 켜도 번호는 가려진다 — 켠 카드에도 '번호 가림'", () => {
    const on = { ...cal, phones: true };
    const items = [on, { id: "kpi:calendar", w: 3, h: 1 }];
    const ex = exposureOf(items, "manager", ALL);
    expect(ex.phones).toBe(false);
    expect(badgesFor(on, "manager", ALL, ex).map((b) => b.text)).toContain("번호 가림");
    const both = [on, { id: "kpi:calendar", w: 3, h: 1, phones: true }];
    expect(badgesFor(on, "manager", ALL, exposureOf(both, "manager", ALL)).map((b) => b.text)).toContain("번호 보임");
  });
});
