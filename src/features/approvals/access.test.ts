import { describe, it, expect } from "vitest";
import { MENU_ACCESS, SYSTEM_ROLES, applyUserOverrides, resolveMatrix } from "@/lib/permissions";
import {
  APPROVAL_PILOT_USER_IDS,
  approvalLineFor,
  approvalMenuOverridesFor,
  approverCandidateIds,
  isApprovalPilotUser,
} from "./access";
import { docYear, formatDocNo, nextDocNo } from "./doc-no";
import { stepRoleLabels } from "./types";

const [SEUNGYEOP, YEWON] = APPROVAL_PILOT_USER_IDS;
const OUTSIDER = "00000000-0000-4000-8000-000000000000";

describe("파일럿 명단", () => {
  it("이승엽·김예원 두 계정뿐", () => {
    expect(APPROVAL_PILOT_USER_IDS).toHaveLength(2);
    expect(isApprovalPilotUser(SEUNGYEOP!)).toBe(true);
    expect(isApprovalPilotUser(OUTSIDER)).toBe(false);
  });

  it("기본 권한은 전 역할 차단 — 명단 없이는 아무도 못 본다", () => {
    for (const role of SYSTEM_ROLES) {
      expect(MENU_ACCESS.approvals[role]).toBe("none");
    }
  });
});

describe("기본 결재선(폼 초기값)", () => {
  it("결재자 후보 풀 = 파일럿 동안은 파일럿 명단", () => {
    expect(approverCandidateIds()).toEqual(APPROVAL_PILOT_USER_IDS);
  });

  it("기안자 본인은 기본 결재선에서 빠진다(셀프 결재 금지)", () => {
    expect(approvalLineFor(SEUNGYEOP!)).toEqual([YEWON]);
    expect(approvalLineFor(YEWON!)).toEqual([SEUNGYEOP]);
  });

  it("후보 풀 밖 사람이 올리면 후보 전원이 기본 결재선(순서 보존)", () => {
    expect(approvalLineFor(OUTSIDER)).toEqual([...approverCandidateIds()]);
  });

  it("직함 라벨 — 한 명이면 '승인', 여럿이면 마지막만 '승인'", () => {
    expect(stepRoleLabels(0)).toEqual([]);
    expect(stepRoleLabels(1)).toEqual(["승인"]);
    expect(stepRoleLabels(3)).toEqual(["검토", "검토", "승인"]);
  });
});

describe("문서번호", () => {
  it("양식 접두 + 연도 + 4자리 일련번호", () => {
    expect(formatDocNo("leave", 2026, 1)).toBe("휴가-2026-0001");
    expect(formatDocNo("leave", "2026", 42)).toBe("휴가-2026-0042");
  });

  it("연도는 기안일(KST)에서 뽑는다", () => {
    expect(docYear("2026-08-14")).toBe("2026");
  });

  it("이미 쓴 개수에서 잇고, 충돌하면 다음 번호로", () => {
    expect(nextDocNo("leave", "2026-08-14", 0)).toBe("휴가-2026-0001");
    expect(nextDocNo("leave", "2026-08-14", 7)).toBe("휴가-2026-0008");
    expect(nextDocNo("leave", "2026-08-14", 7, 1)).toBe("휴가-2026-0009");
  });
});

describe("권한 매트릭스에 얹히는 개인 예외", () => {
  it("명단에 있으면 approvals가 full로 열린다", () => {
    const matrix = applyUserOverrides(
      resolveMatrix([]),
      YEWON!,
      "admin",
      approvalMenuOverridesFor(YEWON!, false),
    );
    expect(matrix.approvals.admin).toBe("full");
    expect(matrix.staff.admin).toBe(MENU_ACCESS.staff.admin); // 다른 메뉴는 그대로
  });

  it("명단 밖은 예외가 생기지 않는다", () => {
    expect(approvalMenuOverridesFor(OUTSIDER, false)).toEqual([]);
  });

  it("super_admin은 명단에 없어도 통과(원장 지시 2026-08-13)", () => {
    const matrix = applyUserOverrides(
      resolveMatrix([]),
      OUTSIDER,
      "master",
      approvalMenuOverridesFor(OUTSIDER, true),
    );
    expect(matrix.approvals.master).toBe("full");
  });
});
