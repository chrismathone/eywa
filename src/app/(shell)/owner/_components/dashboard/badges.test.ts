import { describe, expect, it } from "vitest";
import { MENU_KEYS, type MenuKey } from "@/lib/permissions";
import { defaultItems } from "@/features/dashboard/layout/defaults";
import { editOf, itemsOf, patchPanel } from "@/features/dashboard/layout/board-edit";
import { badgesFor, exposureOf, optionOn, scopeLine, sensitiveReason } from "./badges";


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

  // 리뷰 2026-11-09: 새 편집기의 KPI 표에 번호 칸이 없어 일정 카드를 켜도 번호가 늘 가려졌다 — KPI 칸도 같은 patchPanel로 켠다.
  it("데스크 기본: 일정 카드와 입테 KPI 칸을 모두 켜야 번호가 그대로 나간다(KPI 칸도 편집으로 켤 수 있다)", () => {
    let board = editOf(defaultItems("desk"));
    board = patchPanel(board, "panel:admissionsSchedule", { phones: true });
    expect(exposureOf(itemsOf(board), "desk", ALL).phones).toBe(false);
    for (const id of board.kpis.map((i) => i.id).filter((id) => id === "kpi:calendar" || id === "kpi:todayTests")) board = patchPanel(board, id, { phones: true });
    expect(exposureOf(itemsOf(board), "desk", ALL).phones).toBe(true);
    board = patchPanel(board, "kpi:calendar", { phones: false });
    expect(exposureOf(itemsOf(board), "desk", ALL).phones).toBe(false);
  });
});
