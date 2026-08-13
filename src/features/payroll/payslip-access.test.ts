import { describe, expect, it } from "vitest";
import { canViewPayslip, PAYSLIP_VIEWER_IDS } from "./payslip-access";

/**
 * 급여명세서는 주민번호·계좌·급여가 한 장에 다 실린다. 게이트가 조용히 넓어지면 그게 곧 유출이라
 * **명단으로만** 열린다는 성질을 테스트로 잠근다(원장 지시 2026-08-13 "하드픽스").
 */
describe("급여명세서 열람 자격", () => {
  const at = (i: number) => ({ id: PAYSLIP_VIEWER_IDS[i]!, systemRole: "admin" as const });

  it("명단에 있는 4명은 통과한다", () => {
    expect(PAYSLIP_VIEWER_IDS).toHaveLength(4);
    for (let i = 0; i < PAYSLIP_VIEWER_IDS.length; i++) expect(canViewPayslip(at(i))).toBe(true);
  });

  it("🔴 명단에 없으면 master여도 못 본다 — 역할이 아니라 명단이 게이트다", () => {
    expect(canViewPayslip({ id: "someone-else", systemRole: "master" })).toBe(false);
  });

  it("역할이 무엇이든 명단이 아니면 전부 거부", () => {
    for (const role of ["admin", "manager", "teacher", "counselor", "accountant", "viewer", "student"] as const) {
      expect(canViewPayslip({ id: "not-in-list", systemRole: role })).toBe(false);
    }
  });

  it("명단이 uuid 형식이다(이름·이메일로 잠그면 개명·동명이인에 흔들린다)", () => {
    for (const id of PAYSLIP_VIEWER_IDS) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });

  it("중복 없이 유지된다(붙여넣기 실수로 같은 사람이 두 번 들어가지 않게)", () => {
    expect(new Set(PAYSLIP_VIEWER_IDS).size).toBe(PAYSLIP_VIEWER_IDS.length);
  });
});
