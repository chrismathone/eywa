import { describe, it, expect } from "vitest";
import { MENU_ACCESS, SYSTEM_ROLES, applyUserOverrides, resolveMatrix } from "@/lib/permissions";
import {
  LEAVE_APPROVER_IDS,
  LEAVE_PILOT_USER_IDS,
  approverIdsFor,
  isLeaveApprover,
  isLeavePilotUser,
  leaveMenuOverridesFor,
} from "./leave-access";

const [SEUNGYEOP, YEWON] = LEAVE_PILOT_USER_IDS;
const OUTSIDER = "00000000-0000-4000-8000-000000000000";

describe("파일럿 명단", () => {
  it("이승엽·김예원 두 계정뿐", () => {
    expect(LEAVE_PILOT_USER_IDS).toHaveLength(2);
    expect(isLeavePilotUser(SEUNGYEOP!)).toBe(true);
    expect(isLeavePilotUser(YEWON!)).toBe(true);
    expect(isLeavePilotUser(OUTSIDER)).toBe(false);
  });

  it("기본 권한은 전 역할 차단 — 명단 없이는 아무도 못 본다", () => {
    for (const role of SYSTEM_ROLES) {
      expect(MENU_ACCESS.leave[role]).toBe("none");
    }
  });
});

describe("결재선", () => {
  it("신청자 본인은 자기 결재선에서 빠진다(셀프 결재 금지)", () => {
    expect(approverIdsFor(SEUNGYEOP!)).toEqual([YEWON]);
    expect(approverIdsFor(YEWON!)).toEqual([SEUNGYEOP]);
  });

  it("명단 밖 사람이 내면 전원이 결재선", () => {
    expect(approverIdsFor(OUTSIDER)).toEqual([...LEAVE_APPROVER_IDS]);
  });

  it("결재 자격은 결재선에 있는 사람만", () => {
    expect(isLeaveApprover(YEWON!)).toBe(true);
    expect(isLeaveApprover(OUTSIDER)).toBe(false);
  });
});

describe("권한 매트릭스에 얹히는 개인 예외", () => {
  it("명단에 있으면 leave가 full로 열린다", () => {
    const overrides = leaveMenuOverridesFor(YEWON!, false);
    const matrix = applyUserOverrides(resolveMatrix([]), YEWON!, "admin", overrides);
    expect(matrix.leave.admin).toBe("full");
    // 다른 메뉴는 건드리지 않는다.
    expect(matrix.staff.admin).toBe(MENU_ACCESS.staff.admin);
  });

  it("명단 밖은 예외가 생기지 않는다", () => {
    expect(leaveMenuOverridesFor(OUTSIDER, false)).toEqual([]);
    const matrix = applyUserOverrides(resolveMatrix([]), OUTSIDER, "admin", []);
    expect(matrix.leave.admin).toBe("none");
  });

  it("super_admin은 명단에 없어도 통과(원장 지시 2026-08-13)", () => {
    const overrides = leaveMenuOverridesFor(OUTSIDER, true);
    expect(overrides).toHaveLength(1);
    const matrix = applyUserOverrides(resolveMatrix([]), OUTSIDER, "master", overrides);
    expect(matrix.leave.master).toBe("full");
  });
});
