import { describe, expect, it } from "vitest";
import { MENU_ACCESS, MENU_LABEL, SYSTEM_ROLES, type AccessMatrix, type MenuKey } from "@/lib/permissions";
import { linkedGrants, linkGaps, requirementsOf } from "./permission-links";
import { ROW_NOTE } from "./permission-row-notes";

const base = (): AccessMatrix => JSON.parse(JSON.stringify(MENU_ACCESS)) as AccessMatrix;
const of = (m: AccessMatrix, role: keyof AccessMatrix[MenuKey]) => (menu: MenuKey) => m[menu][role];

describe("연동된 권한(원장 2026-11-12 '해당 권한도 함께 허용할까요?')", () => {
  it("필요한 권한이 모자라면 채우는 값 가운데 가장 좁은 값으로 묻는다", () => {
    const m = base();
    m.withdrawals.counselor = "none";
    expect(linkedGrants("withdrawals_churn", "counselor", "full", of(m, "counselor"))).toEqual([{ menu: "withdrawals", access: "readonly", from: "none" }]);
    // 구글 시트 연동은 시간표 화면 안에 있다 — 시간표가 닫혀 있으면 함께 열자고 묻는다(수업목록 '전체'는 가져오기에만 · 묻지 않는다)
    m.timetable.manager = "none";
    expect(linkedGrants("sheet_sync", "manager", "full", of(m, "manager"))).toEqual([{ menu: "timetable", access: "readonly", from: "none" }]);
  });

  it("요구가 커질 때만 묻는다 — 좁히기('전체 → 담당')·같은 수준 돌리기는 묻지 않는다(취소가 '그대로'라 닫지도 못했다 · 재리뷰)", () => {
    const m = base();
    m.ecs.admin = "none";
    expect(linkedGrants("student_english_name", "admin", "scoped", of(m, "admin"), {}, "full")).toEqual([]);
    expect(linkedGrants("student_english_name", "admin", "full", of(m, "admin"), {}, "none")).toEqual([{ menu: "ecs", access: "readonly", from: "none" }]);
  });

  it("홍보·마케팅 저장(쓰기)은 원장·관리자에게만 요구한다 — 상담·실장 등은 보기(열림)만", () => {
    const ctx = { marketingArchive: true };
    expect(requirementsOf("marketing", "full", ctx, "counselor")).toEqual([{ menu: "billing", need: "open" }]);
    expect(requirementsOf("marketing", "full", ctx, "admin")).toEqual([{ menu: "billing", need: "write" }]);
    const m = base();
    m.billing.manager = "readonly";
    expect(linkedGrants("marketing", "manager", "full", of(m, "manager"), ctx)).toEqual([]); // 실장은 이미 보기가 열린다
    // 역할 표(openOnly)는 관리자에게도 열림만 묻는다 — 칸이 '없음 → 전체'로 먼저 가도 '읽기'까지 갈 수 있게(재리뷰)
    m.billing.admin = "readonly";
    expect(linkedGrants("marketing", "admin", "full", of(m, "admin"), { ...ctx, openOnly: true })).toEqual([]);
  });

  it("이미 채워졌거나 · 닫을 때 · 짝이 없는 권한은 묻지 않는다", () => {
    const m = base();
    m.withdrawals.admin = "full";
    expect(linkedGrants("withdrawals_churn", "admin", "full", of(m, "admin"))).toEqual([]);
    expect(linkedGrants("withdrawals_churn", "admin", "none", of(m, "admin"))).toEqual([]);
    expect(linkedGrants("students", "admin", "full", of(m, "admin"))).toEqual([]);
  });

  it("홍보·마케팅 → 수납관리는 행사 자료 학원에서만 · 저장(전체·담당)은 수납관리 쓰기까지", () => {
    expect(requirementsOf("marketing", "full")).toEqual([]);
    expect(requirementsOf("marketing", "full", { marketingArchive: true })).toEqual([{ menu: "billing", need: "write" }]);
    expect(requirementsOf("marketing", "readonly", { marketingArchive: true })).toEqual([{ menu: "billing", need: "open" }]);
  });

  it("효과 없는 칸 — 열려 있는데 필요한 권한이 닫힌 칸을 찾는다(반대 방향)", () => {
    const m = base();
    m.withdrawals_churn.admin = "full";
    m.withdrawals.admin = "none";
    expect(linkGaps(m, SYSTEM_ROLES)).toContainEqual({ menu: "withdrawals_churn", role: "admin", missing: ["withdrawals"] });
  });

  it("코드 기본값에는 효과 없는 칸이 없다(새 학원에 알림이 뜨지 않게)", () => {
    expect(linkGaps(base(), SYSTEM_ROLES)).toEqual([]);
  });

  it("짝은 그 줄 설명이 말하는 권한과 같다", () => {
    for (const menu of ["withdrawals_churn", "shuttle_admin"] as const) {
      for (const req of requirementsOf(menu, "full")) expect(ROW_NOTE[menu]).toContain(`${MENU_LABEL[req.menu]} 권한`);
    }
  });
});
