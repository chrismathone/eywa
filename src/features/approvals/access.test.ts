import { describe, it, expect } from "vitest";
import { MENU_ACCESS, SYSTEM_ROLES, applyUserOverrides, resolveMatrix } from "@/lib/permissions";
import { APPROVAL_PILOT_USER_IDS, approvalMenuOverridesFor, isApprovalPilotUser } from "./access";
import { docYear, formatDocNo, nextDocNo } from "./doc-no";
import { stepRoleLabels } from "./types";

const [SEUNGYEOP, YEWON] = APPROVAL_PILOT_USER_IDS;
const OUTSIDER = "00000000-0000-4000-8000-000000000000";

describe("파일럿 명단", () => {
  it("이승엽·김예원·테스터 세 계정뿐", () => {
    expect(APPROVAL_PILOT_USER_IDS).toHaveLength(3);
    expect(isApprovalPilotUser(SEUNGYEOP!)).toBe(true);
    expect(isApprovalPilotUser(OUTSIDER)).toBe(false);
  });

  it("기본 권한은 전 역할 차단 — 명단 없이는 아무도 못 본다", () => {
    for (const role of SYSTEM_ROLES) {
      expect(MENU_ACCESS.approvals[role]).toBe("none");
    }
  });
});

// ⚠️ 결재자 후보 풀은 더 이상 코드 상수가 아니다 — **활성 직원 전원**(원장 2026-08-14 "결재자랑
// 이런 건 직원들 다 있어야지"). 후보는 getApproverCandidates()(DB), 검증은 액션이 users 대조.
// 기본 결재선도 없다(하이웍스처럼 기안자가 매번 지정하거나 자주 쓰는 결재선을 불러온다).
describe("직함 라벨", () => {
  it("한 명이면 '승인', 여럿이면 마지막만 '승인'", () => {
    expect(stepRoleLabels(0)).toEqual([]);
    expect(stepRoleLabels(1)).toEqual(["승인"]);
    expect(stepRoleLabels(3)).toEqual(["검토", "검토", "승인"]);
  });
});

describe("문서번호", () => {
  it("양식 접두 + 연도 + 4자리 일련번호 — 4종 전부", () => {
    expect(formatDocNo("leave", 2026, 1)).toBe("휴가-2026-0001");
    expect(formatDocNo("leave", "2026", 42)).toBe("휴가-2026-0042");
    expect(formatDocNo("proposal", 2026, 1)).toBe("품의-2026-0001");
    expect(formatDocNo("expense", 2026, 7)).toBe("지출-2026-0007");
    expect(formatDocNo("income", 2026, 3)).toBe("수입-2026-0003");
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
