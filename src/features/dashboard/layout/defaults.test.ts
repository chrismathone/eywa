import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT } from "@/features/dashboard/overview/layout";
import { dashboardBundleOf } from "./bundle";
import { classicDefault, defaultItems, optionDefault, usesClassicDefault } from "./defaults";
import { classicToItems, placedIds, sanitizeItems } from "./engine";
import { holesOf, layoutAt } from "./flow";
import { canRedo, canUndo, pushHistory, redoHistory, startHistory, undoHistory } from "./history";
import { normalizeDashboard, roleItems } from "./normalize";
import { BUNDLES } from "./types";

describe("기본 배치", () => {
  it("원장 = 지금 운영실 그대로(옛 CSS 격자로 그린다)", () => {
    expect(usesClassicDefault("owner")).toBe(true);
    expect(classicDefault("owner")).toBe(DEFAULT_LAYOUT);
    expect(defaultItems("owner")).toEqual(classicToItems(DEFAULT_LAYOUT));
    expect(BUNDLES.filter((b) => b !== "owner").every((b) => classicDefault(b) === null)).toBe(true);
  });

  it("원장 밖 역할 기본엔 금액 내역·직원 구성이 없다(민감 기본 빠짐)", () => {
    for (const b of BUNDLES.filter((x) => x !== "owner")) {
      const ids = placedIds(defaultItems(b));
      expect(ids).not.toContain("panel:billing6");
      expect(ids).not.toContain("panel:expenses");
      expect(ids).not.toContain("panel:staff");
    }
  });

  it("과목 관리자 기본 = 담당 과목으로 좁혀지는 칸 + 공지(수납·강사 시트·퇴원 명단 없음)", () => {
    expect(placedIds(defaultItems("subject"))).toEqual(["kpi:students", "kpi:firstClass", "kpi:absent", "panel:nowClasses", "panel:subjects", "panel:notices"]);
  });

  it("데스크는 학습 운영 칸(보고·학생 상담·강사 시트)도 뺀다 · 실장은 둔다", () => {
    expect(placedIds(defaultItems("desk"))).not.toEqual(expect.arrayContaining(["panel:reports"]));
    expect(placedIds(defaultItems("desk"))).not.toContain("panel:sheets");
    expect(placedIds(defaultItems("manager"))).toContain("panel:reports");
  });

  it("모든 기본 배치는 넓은 창에서 빈칸이 없고, 저장값 검증을 그대로 통과한다", () => {
    for (const b of BUNDLES) {
      expect(holesOf(layoutAt(defaultItems(b), "desktop"))).toEqual([]);
      expect(sanitizeItems(defaultItems(b))).toEqual(defaultItems(b));
    }
  });

  it("민감 옵션의 역할 기본 = 원장만 보임", () => {
    expect(optionDefault("owner")).toBe(true);
    expect(BUNDLES.filter((b) => b !== "owner").some((b) => optionDefault(b))).toBe(false);
  });
});

describe("역할 판정(dashboardBundleOf)", () => {
  it("원장·총괄 → 원장 · 관리자+담당 과목 → 과목 관리자 · 관리자 → 데스크 · 매니저 → 실장 · 그 밖 → 그 밖의 직책", () => {
    expect(dashboardBundleOf({ systemRole: "master", isSuperAdmin: false, subjects: ["math"] })).toBe("owner");
    expect(dashboardBundleOf({ systemRole: "admin", isSuperAdmin: true, subjects: ["math"] })).toBe("owner");
    expect(dashboardBundleOf({ systemRole: "admin", isSuperAdmin: false, subjects: ["math"] })).toBe("subject");
    expect(dashboardBundleOf({ systemRole: "admin", isSuperAdmin: false, subjects: [] })).toBe("desk");
    expect(dashboardBundleOf({ systemRole: "manager", isSuperAdmin: false, subjects: ["english"] })).toBe("manager");
    expect(dashboardBundleOf({ systemRole: "counselor", isSuperAdmin: false, subjects: [] })).toBe("other");
    expect(dashboardBundleOf({ systemRole: "viewer", isSuperAdmin: false, subjects: [] })).toBe("other");
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
    expect(out.layouts[1]?.items).toEqual(custom);
  });

  it("저장할 때 기본과 같은 역할은 저장값을 만들지 않는다 — 기본 개선이 따라오게", () => {
    const out = normalizeDashboard({ version: 1, layouts: [{ role: "desk", items: defaultItems("desk") }, { role: "owner", items: custom }] }, { dropDefaults: true });
    expect(out.layouts.map((l) => l.role)).toEqual(["owner"]);
  });

  it("저장값이 없으면 기본을 따른다(roleItems)", () => {
    expect(roleItems(normalizeDashboard({ version: 1, layouts: [] }), "manager")).toEqual(defaultItems("manager"));
    expect(roleItems(normalizeDashboard({ version: 1, layouts: [{ role: "manager", items: custom }] }), "manager")).toEqual(custom);
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
