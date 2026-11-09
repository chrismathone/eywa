import { describe, expect, it } from "vitest";
import { dashboardSavePart, mergeDashboardSave, normalizeDashboard } from "./normalize";
import { DASHBOARD_VERSION, type DashboardSettings, type Item } from "./types";

const a: Item = { id: "panel:notices", x: 0, y: 0, w: 6, h: 2 };
const b: Item = { id: "panel:nowClasses", x: 6, y: 0, w: 6, h: 2 };
const c: Item = { id: "panel:subjects", x: 12, y: 0, w: 6, h: 2 };
const assign = { userId: "11111111-1111-4111-8111-111111111111", scope: "subjects" as const, adminLayout: "subject" as const, subjects: ["math"] };
/** 새 대시보드 모양으로 옮긴 뒤의 카드 순서(핵심 업무·머리줄 제외) — 저장 병합은 카드 자리를 그대로 둔다. */
const panels = (items: readonly Item[] | undefined) => items?.filter((i) => i.id.startsWith("panel:")).map((i) => i.id);
const settings = (layouts: DashboardSettings["layouts"], assignments: unknown[] = []) => ({ version: DASHBOARD_VERSION, layouts, assignments });

describe("대시보드 동시 저장 — 마지막 저장이 이기되 고친 배치만(원장 2026-10-14)", () => {
  it("고친 역할만 덮어쓰고, 그사이 다른 사람이 저장한 다른 역할 배치와 직원 배정은 지금 저장본 그대로", () => {
    // 지금 저장본: 다른 사람이 실장(manager) 배치와 직원 배정을 막 저장했다.
    const fresh = settings([{ role: "manager", items: [a, c] }, { role: "desk", items: [a] }], [assign]);
    // 내 화면: 처음 받은 값으로 데스크만 고쳐 보냈다(실장은 옛 값 그대로 실려 있다).
    const sent = settings([{ role: "manager", items: [a] }, { role: "desk", items: [a, b] }]);
    const out = normalizeDashboard(mergeDashboardSave(fresh, sent, "layouts", ["desk"]));
    expect(panels(out.layouts.find((l) => l.role === "manager")?.items)).toEqual(["panel:notices", "panel:subjects"]);
    expect(panels(out.layouts.find((l) => l.role === "desk")?.items)).toEqual(["panel:notices", "panel:nowClasses"]);
    expect(out.assignments).toHaveLength(1);
  });

  it("같은 역할을 둘이 고쳤으면 나중 저장이 이긴다 · 과목별 배치 키도 따로 본다", () => {
    const fresh = settings([{ role: "subject", subject: "math", items: [a, c] }, { role: "subject", subject: "english", items: [c] }]);
    const sent = settings([{ role: "subject", subject: "math", items: [b] }, { role: "subject", subject: "english", items: [a] }]);
    const out = mergeDashboardSave(fresh, sent, "layouts", ["subject:math"]);
    expect(panels(out.layouts.find((l) => l.subject === "math")?.items)).toEqual(["panel:nowClasses"]);
    expect(panels(out.layouts.find((l) => l.subject === "english")?.items)).toEqual(["panel:subjects"]);
  });

  it("직원 배정 저장은 배치를 건드리지 않는다", () => {
    const fresh = settings([{ role: "desk", items: [a, b] }]);
    const sent = settings([{ role: "desk", items: [a] }], [assign]);
    const out = mergeDashboardSave(fresh, sent, "assignments", [assign.userId]);
    expect(panels(out.layouts[0]?.items)).toEqual(["panel:notices", "panel:nowClasses"]);
    expect(out.assignments).toHaveLength(1);
  });

  it("두 직원을 동시에 배정해도 둘 다 남는다 — 고친 직원 한 줄만 바꾼다 · 보낸 값에 없으면 그 직원만 지운다(리뷰 2026-10-14)", () => {
    const other = { ...assign, userId: "22222222-2222-4222-8222-222222222222", subjects: ["english"] };
    // 둘 다 빈 배정을 읽고 → A가 먼저 저장 → B가 [B]만 실어 보낸다.
    const afterA = mergeDashboardSave(settings([]), settings([], [assign]), "assignments", [assign.userId]);
    const afterB = mergeDashboardSave(afterA, settings([], [other]), "assignments", [other.userId]);
    expect(afterB.assignments!.map((x) => x.userId).sort()).toEqual([assign.userId, other.userId]);
    const removed = mergeDashboardSave(afterB, settings([], []), "assignments", [assign.userId]);
    expect(removed.assignments!.map((x) => x.userId)).toEqual([other.userId]);
  });

  it("요청 칸 해석 — 칸이 없으면 옛 규칙(null) · 있는데 못 읽거나 모양이 틀리면 거절(전체 덮어쓰기로 넓히지 않는다)", () => {
    expect(dashboardSavePart(null, null)).toBeNull();
    expect(dashboardSavePart("other", "[]")).toBe("invalid");
    expect(dashboardSavePart("layouts", JSON.stringify(["desk", "subject:math", "desk"]))).toEqual({ part: "layouts", touched: ["desk", "subject:math"] });
    expect(dashboardSavePart("layouts", JSON.stringify(["desk", "nope"]))).toBe("invalid");
    expect(dashboardSavePart("layouts", JSON.stringify(["subject:"]))).toBe("invalid");
    expect(dashboardSavePart("layouts", "{깨짐")).toBe("invalid");
    expect(dashboardSavePart("layouts", JSON.stringify(Array.from({ length: 129 }, () => "desk")))).toBe("invalid");
    expect(dashboardSavePart("assignments", undefined)).toBe("invalid");
    expect(dashboardSavePart("assignments", JSON.stringify(["desk"]))).toBe("invalid");
    expect(dashboardSavePart("assignments", JSON.stringify([assign.userId]))).toEqual({ part: "assignments", touched: [assign.userId] });
  });
});
