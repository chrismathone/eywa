import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT } from "@/features/dashboard/overview/layout";
import { dashboardBundleOf } from "./bundle";
import { defaultItems, optionDefault } from "./defaults";
import { resolveView } from "./view";
import { MENU_KEYS } from "@/lib/permissions";
import { classicToItems, placedIds, sanitizeItems } from "./engine";
import { boardOf, isBoardItems, toBoardItems } from "./board";
import { canRedo, canUndo, pushHistory, redoHistory, startHistory, undoHistory } from "./history";
import { normalizeDashboard, roleItems } from "./normalize";
import { BUNDLES, EMPTY_DASHBOARD } from "./types";

describe("기본 배치", () => {
  it("원장 = 새 대시보드 전부 · 옛 CSS 격자는 어느 역할도 쓰지 않는다(2026-11-09)", () => {
    expect(BUNDLES.every((b) => resolveView({ stored: EMPTY_DASHBOARD, bundle: b, menus: new Set(MENU_KEYS) }).mode === "grid")).toBe(true);
    const owner = boardOf(defaultItems("owner"));
    expect(owner.core).toEqual(["newcomers", "management", "workRecords"]);
    expect(owner.glance).toEqual(["students", "courses", "withdrawals", "intake", "enrolledToday", "todayTests"]);
    expect(owner.kpis).toEqual(["students", "courses", "withdrawals", "intake", "calendar", "enrolledToday", "firstClass", "absent", "makeup"]);
    expect(owner.trend).toEqual(["changes", "billing6", "enrolledTrend", "courseTrend", "earlyExits"]);
    expect(owner.mix).toEqual(["studentsComp", "attendance", "billingMonth", "newcomerStages"]);
    // 옛 원장 운영실의 카드는 하나도 빠지지 않는다.
    const placed = new Set(placedIds(defaultItems("owner")));
    for (const id of placedIds(classicToItems(DEFAULT_LAYOUT))) expect(placed.has(id)).toBe(true);
  });

  it("원장 밖 역할 기본엔 금액 내역·직원 구성이 없다(민감 기본 빠짐)", () => {
    for (const b of BUNDLES.filter((x) => x !== "owner" && x !== "super")) {
      const ids = placedIds(defaultItems(b));
      expect(ids).not.toContain("panel:billing6");
      expect(ids).not.toContain("panel:expenses");
      expect(ids).not.toContain("panel:staff");
    }
  });

  // 강사별 업무 현황은 직원 평가 '업무 현황' 면으로 옮겨 대시보드 기본에서 빠졌다(원장 2026-10-29·30).
  it("과목 관리자 기본 = 담당 과목의 수업·학생 위주(수납·직원·강사 시트·퇴원 명단 없음)", () => {
    const ids = placedIds(defaultItems("subject"));
    for (const id of ["panel:billingMonth", "panel:billing6", "panel:expenses", "panel:staff", "panel:sheets", "panel:earlyExits"]) expect(ids).not.toContain(id);
    expect(ids).toEqual(expect.arrayContaining(["kpi:students", "kpi:withdrawals", "panel:nowClasses", "panel:repeatAbsence", "panel:notices"]));
  });

  it("데스크 = 일정·상담·출결 위주 · 학습 운영과 금액 카드 없음", () => {
    const ids = placedIds(defaultItems("desk"));
    for (const id of ["panel:reports", "panel:studentConsult", "panel:sheets", "panel:billingMonth", "panel:billing6", "panel:expenses"]) expect(ids).not.toContain(id);
    expect(ids).toEqual(expect.arrayContaining(["panel:admissionsSchedule", "panel:consultProgress", "panel:repeatAbsence", "kpi:todayTests"]));
  });

  it("데스크는 학습 운영 칸(보고·학생 상담·강사 시트)도 뺀다 · 실장은 둔다", () => {
    expect(placedIds(defaultItems("desk"))).not.toEqual(expect.arrayContaining(["panel:reports"]));
    expect(placedIds(defaultItems("desk"))).not.toContain("panel:sheets");
    expect(placedIds(defaultItems("manager"))).toContain("panel:reports");
  });

  it("실장 기본에는 등록 후 3개월 내 퇴원(학생 이름) 카드가 없다 — 원장 화면에만 있던 카드(리뷰 2026-11-09)", () => {
    expect(placedIds(defaultItems("manager"))).not.toContain("panel:earlyExits");
    expect(placedIds(defaultItems("owner"))).toContain("panel:earlyExits");
  });

  it("핵심 업무 칸만 남긴 배치는 저장값으로 남는다 · 제목만 남은 옛 배치는 버린다(리뷰 2026-11-09)", () => {
    const coreOnly = [{ id: "core:workRecords", w: 24, h: 1 }];
    const out = normalizeDashboard({ version: 1, layouts: [{ role: "parttime", items: coreOnly }, { role: "manager", items: [{ id: "heading:x", w: 24, h: 1, title: "a" }] }] });
    expect(out.layouts.map((l) => l.role)).toEqual(["parttime"]);
    expect(boardOf(roleItems(out, "parttime")).core).toEqual(["workRecords"]);
    expect(placedIds(roleItems(out, "parttime"))).toEqual([]);
  });

  it("모든 기본 배치는 새 대시보드 모양이고 저장값 검증·읽기 변환을 그대로 통과한다", () => {
    for (const b of BUNDLES) {
      expect(isBoardItems(defaultItems(b))).toBe(true);
      expect(sanitizeItems(defaultItems(b))).toEqual(defaultItems(b));
      expect(toBoardItems(defaultItems(b))).toEqual(defaultItems(b));
      expect(boardOf(defaultItems(b)).glance.length).toBeLessThanOrEqual(6);
    }
  });

  it("민감 옵션의 역할 기본 = 원장만 보임", () => {
    expect(optionDefault("owner")).toBe(true);
    expect(optionDefault("super")).toBe(true);
    expect(BUNDLES.filter((b) => b !== "owner" && b !== "super").some((b) => optionDefault(b))).toBe(false);
  });
});

describe("역할 판정(dashboardBundleOf)", () => {
  it("원장·총괄 → 원장 · 관리자+담당 과목 → 과목 관리자 · 관리자 → 데스크 · 매니저 → 실장 · 그 밖 → 그 밖의 직책", () => {
    expect(dashboardBundleOf({ systemRole: "master", isSuperAdmin: false, subjects: ["math"] })).toBe("owner");
    expect(dashboardBundleOf({ systemRole: "admin", isSuperAdmin: true, subjects: ["math"] })).toBe("super");
    expect(dashboardBundleOf({ systemRole: "admin", isSuperAdmin: false, subjects: ["math"] })).toBe("subject");
    expect(dashboardBundleOf({ systemRole: "admin", isSuperAdmin: false, subjects: [] })).toBe("desk");
    expect(dashboardBundleOf({ systemRole: "manager", isSuperAdmin: false, subjects: ["english"] })).toBe("manager");
    expect(dashboardBundleOf({ systemRole: "counselor", isSuperAdmin: false, subjects: [] })).toBe("counselor");
    expect(dashboardBundleOf({ systemRole: "viewer", isSuperAdmin: false, subjects: [] })).toBe("viewer");
  });
});

describe("저장값 정규화(normalizeDashboard)", () => {
  const custom = [{ id: "panel:notices", w: 12, h: 1 }];

  it("판 번호가 다르거나 모양이 깨지면 비운다(= 기본 배치)", () => {
    expect(normalizeDashboard({ version: 2, layouts: [] }).layouts).toEqual([]);
    expect(normalizeDashboard(null).layouts).toEqual([]);
    expect(normalizeDashboard({ version: 1, layouts: "x" }).layouts).toEqual([]);
  });

  it("모르는 역할·중복 역할·카드 없는 배치는 버리고, 역할 정의 순서로 둔다", () => {
    const out = normalizeDashboard({
      version: 1,
      layouts: [
        { role: "desk", items: custom },
        { role: "boss", items: custom },
        { role: "desk", items: [{ id: "panel:staff", w: 6, h: 1 }] },
        { role: "manager", items: [{ id: "heading:x", w: 24, h: 1, title: "a" }] },
        { role: "owner", items: custom },
      ],
    });
    expect(out.layouts.map((l) => l.role)).toEqual(["owner", "desk"]);
    expect(out.layouts[1]?.items).toEqual(toBoardItems(custom));
  });

  it("저장할 때 기본과 같은 역할은 저장값을 만들지 않는다 — 기본 개선이 따라오게", () => {
    const out = normalizeDashboard({ version: 1, layouts: [{ role: "desk", items: defaultItems("desk") }, { role: "owner", items: custom }] }, { dropDefaults: true });
    expect(out.layouts.map((l) => l.role)).toEqual(["owner"]);
  });

  it("저장값이 없으면 기본을 따른다(roleItems)", () => {
    expect(roleItems(normalizeDashboard({ version: 1, layouts: [] }), "manager")).toEqual(defaultItems("manager"));
    expect(roleItems(normalizeDashboard({ version: 1, layouts: [{ role: "manager", items: custom }] }), "manager")).toEqual(toBoardItems(custom));
  });
});

describe("되돌리기·다시 하기", () => {
  it("한 번의 조작 = 한 칸, 같은 값은 안 쌓는다, 새 조작은 다시 하기를 지운다", () => {
    const a = defaultItems("subject");
    const b = a.slice(1);
    const c = a.slice(2);
    let h = startHistory(a);
    expect(pushHistory(h, a.map((i) => ({ ...i })))).toBe(h);
    h = pushHistory(pushHistory(h, b), c);
    h = undoHistory(h);
    expect(h.present).toBe(b);
    expect(canRedo(h)).toBe(true);
    h = redoHistory(h);
    expect(h.present).toBe(c);
    h = pushHistory(undoHistory(h), a.slice(3));
    expect(canRedo(h)).toBe(false);
    expect(canUndo(h)).toBe(true);
  });
});
