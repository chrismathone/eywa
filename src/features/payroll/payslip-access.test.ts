import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canViewPayslip } from "./payslip-access";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf-8");
const VIEWER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const admin = (id: string) => ({ id, systemRole: "admin" as const });

/**
 * 급여명세서는 주민번호·계좌·급여가 한 장에 다 실린다. 게이트가 조용히 넓어지면 그게 곧 유출이라
 * **원장 역할과 지정한 사람만** 열린다는 성질을 테스트로 잠근다. 누구를 지정하는지는 학원 설정이 정한다
 * (원장 2026-10-06 *"개인 역할은 전부다 편집기"* — 전에는 이 파일 옆에 계정 명단이 있었다).
 */
describe("급여명세서 열람 자격", () => {
  const policy = { viewerIds: [VIEWER] };

  it("학원 설정에서 지정한 사람은 통과한다", () => {
    expect(canViewPayslip(admin(VIEWER), policy)).toBe(true);
  });

  it("🔴 원장 역할은 지정 없이 본다 — 원장은 그 지점의 전부를 본다(원장 2026-10-06)", () => {
    expect(canViewPayslip({ id: OTHER, systemRole: "master" }, policy)).toBe(true);
    expect(canViewPayslip({ id: OTHER, systemRole: "master" }, { viewerIds: [] })).toBe(true);
    // 저장값이 깨져 있어도 원장은 본다(지정 목록을 읽지 않는다).
    expect(canViewPayslip({ id: OTHER, systemRole: "master" }, { viewerIds: null as unknown as string[] })).toBe(true);
  });

  it("🔴 그 밖의 역할은 지정되지 않았으면 못 본다 — 관리자여도, 메뉴 권한을 아무리 올려도", () => {
    for (const role of ["admin", "manager", "teacher", "counselor", "accountant", "viewer", "student"] as const) {
      expect(canViewPayslip({ id: OTHER, systemRole: role }, policy)).toBe(false);
    }
  });

  it("지정한 사람이 없으면 원장 역할 말고는 아무도 못 본다", () => {
    expect(canViewPayslip(admin(VIEWER), { viewerIds: [] })).toBe(false);
  });

  it("🔴 저장값이 목록이 아니면(손으로 넣은 값) 아무도 통과시키지 않는다 — 글자열에 id가 들어 있어도", () => {
    expect(canViewPayslip(admin(VIEWER), { viewerIds: `x${VIEWER}x` as unknown as string[] })).toBe(false);
    expect(canViewPayslip(admin(VIEWER), { viewerIds: null as unknown as string[] })).toBe(false);
  });

  /**
   * ⚠️ 운영 계정 자동 통과·기능 꺼짐 판정은 **이 순수 함수가 아니라** `canViewPayslipNow()`(server/payslip-gate.ts)에
   *    있다(조회가 필요해 async). 새 호출부는 반드시 그쪽을 쓸 것.
   */
  it("게이트는 학원 설정의 지정값을 읽는다 — 침산·새 학원을 가르지 않는다", () => {
    const gate = read("src/features/payroll/server/payslip-gate.ts");
    expect(gate).toContain("settings.permissions.specialAccess.payslipViewerIds");
    expect(gate).not.toContain("isChinsanTenant");
  });

  it("🔴 코드에 계정 명단을 두지 않는다 — 지정은 역할·권한 화면에서만", () => {
    const src = read("src/features/payroll/payslip-access.ts");
    expect(src).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(src).not.toMatch(/_IDS\b/);
  });
});
