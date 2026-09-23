import { describe, expect, it } from "vitest";
import { canViewPayslip, PAYSLIP_VIEWER_IDS } from "./payslip-access";

/**
 * 급여명세서는 주민번호·계좌·급여가 한 장에 다 실린다. 게이트가 조용히 넓어지면 그게 곧 유출이라
 * **명단으로만** 열린다는 성질을 테스트로 잠근다(원장 지시 2026-08-13 "하드픽스").
 */
describe("급여명세서 열람 자격", () => {
  const at = (i: number) => ({ id: PAYSLIP_VIEWER_IDS[i]!, systemRole: "admin" as const });
  const chinsan = { isChinsanTenant: true, viewerIds: [] };

  it("명단에 오른 사람은 전부 통과한다", () => {
    expect(PAYSLIP_VIEWER_IDS).toHaveLength(5);
    for (let i = 0; i < PAYSLIP_VIEWER_IDS.length; i++) expect(canViewPayslip(at(i), chinsan)).toBe(true);
  });

  it("🔴 명단에 없으면 master여도 못 본다 — 역할이 아니라 명단이 게이트다", () => {
    expect(canViewPayslip({ id: "someone-else", systemRole: "master" }, chinsan)).toBe(false);
  });

  /**
   * ⚠️ super_admin 자동 통과는 **이 순수 함수가 아니라** `canViewPayslipNow()`(server/payslip-gate.ts)에
   *    있다(DB 조회가 필요해 async). 여기서 false가 나오는 게 정상이며, 새 호출부는 반드시 그쪽을 쓸 것.
   */
  it("순수 판정은 super_admin을 모른다 — 게이트는 canViewPayslipNow가 한다", () => {
    expect(canViewPayslip({ id: "some-super-admin", systemRole: "admin" }, chinsan)).toBe(false);
  });

  it("역할이 무엇이든 명단이 아니면 전부 거부", () => {
    for (const role of ["admin", "manager", "teacher", "counselor", "accountant", "viewer", "student"] as const) {
      expect(canViewPayslip({ id: "not-in-list", systemRole: role }, chinsan)).toBe(false);
    }
  });

  it("일반 지점은 침산 명단을 무시하고 설정에서 지정한 직원만 허용", () => {
    expect(canViewPayslip(at(0), { isChinsanTenant: false, viewerIds: [] })).toBe(false);
    expect(canViewPayslip(at(0), { isChinsanTenant: false, viewerIds: [at(0).id] })).toBe(true);
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
