import { describe, expect, it } from "vitest";
import { MENU_ACCESS, resolveMatrix } from "@/lib/permissions";
import { resolveDashboardAccess } from "./dashboard-access";

describe("resolveDashboardAccess", () => {
  it("회계는 수납을 보되 상담·반 생성·휴가 관리는 받지 않는다", () => {
    const access = resolveDashboardAccess("accountant", MENU_ACCESS);

    expect(access.read.billing).toBe(true);
    expect(access.read.consultations).toBe(false);
    expect(access.read.classes).toBe(false);
    expect(access.write.billing).toBe(true);
    expect(access.manageStaff).toBe(false);
    expect(access.write.classes).toBe(false);
    expect(access.write.consultations).toBe(false);
  });

  it("상담사는 학생·상담 쓰기만 오늘 조치 신호 후보가 되고 재무·출석은 보지 않는다", () => {
    const access = resolveDashboardAccess("counselor", MENU_ACCESS);

    expect(access.write.students).toBe(true);
    expect(access.write.consultations).toBe(true);
    expect(access.write.classes).toBe(false);
    expect(access.write.enrollment).toBe(true);
    expect(access.read.billing).toBe(false);
    expect(access.read.attendance).toBe(false);
  });

  it("viewer는 읽기 카드만 받고 생성 작업은 받지 않는다", () => {
    const access = resolveDashboardAccess("viewer", MENU_ACCESS);

    expect(access.read.students).toBe(true);
    expect(access.read.consultations).toBe(true);
    expect(access.read.billing).toBe(false);
    expect(Object.values(access.write).some(Boolean)).toBe(false);
  });

  it("테넌트 override를 조회와 쓰기 양쪽에 동일하게 반영한다", () => {
    const matrix = resolveMatrix([
      { menu: "students", role: "counselor", access: "none" },
      { menu: "billing", role: "counselor", access: "readonly" },
    ]);
    const access = resolveDashboardAccess("counselor", matrix);

    expect(access.read.students).toBe(false);
    expect(access.write.students).toBe(false);
    expect(access.read.billing).toBe(true);
    expect(access.write.billing).toBe(false);
  });

  it("직원관리가 readonly로 내려가면 역할이 manager여도 휴가 승인 신호를 받지 않는다", () => {
    const matrix = resolveMatrix([{ menu: "staff", role: "manager", access: "readonly" }]);
    const access = resolveDashboardAccess("manager", matrix);

    expect(access.read.staff).toBe(true);
    expect(access.manageStaff).toBe(false);
  });
});
