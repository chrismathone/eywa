import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { MENU_ACCESS, SYSTEM_ROLES, applyUserOverrides, resolveMatrix } from "@/lib/permissions";
import { approvalMenuOverridesFor } from "./access";
import { docYear, formatDocNo, nextDocNo } from "./doc-no";
import { stepRoleLabels } from "./types";

const STAFF = "11111111-1111-4111-8111-111111111111";
const OUTSIDER = "00000000-0000-4000-8000-000000000000";

describe("전자결재 메뉴 — 역할 권한이 기본, 개인에게는 저장된 개인별 권한으로(원장 2026-10-06)", () => {
  it("기본 권한은 전 역할 차단 — 역할 표나 개인별 메뉴 권한으로 열어야 보인다", () => {
    for (const role of SYSTEM_ROLES) {
      expect(MENU_ACCESS.approvals[role]).toBe("none");
    }
  });

  it("🔴 코드에 계정 명단이 없다 — 권한을 보는 곳(역할·권한 면)과 정하는 곳이 갈리지 않는다", () => {
    const source = readFileSync(join(process.cwd(), "src", "features", "approvals", "access.ts"), "utf8");
    // 계정 id(UUID) 문자열이 한 줄도 없어야 한다 — 다시 생기면 그 화면에 안 보이는 권한이 생긴다.
    expect(source).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(source).not.toMatch(/pilot/i);
  });

  it("결재·후결·회수·댓글 액션은 공통 로그인 문에서 지점 모듈도 확인한다", () => {
    const source = readFileSync(join(process.cwd(), "src", "features", "approvals", "server", "actions.ts"), "utf8");
    const gate = source.slice(source.indexOf("async function requireSignedIn()"), source.indexOf("const TEACHER_VIEW_APPROVAL_ERROR"));
    expect(gate).toContain('isModuleOnForTenant(user.tenantId, "approvals")');
    for (const name of ["decideDocument", "confirmDeferredStep", "withdrawDocument", "addApprovalComment", "deleteApprovalComment"]) {
      const action = source.slice(source.indexOf(`export async function ${name}`));
      expect(action.slice(0, 500)).toContain("requireSignedIn()");
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

describe("권한 매트릭스에 얹히는 예외", () => {
  it("개인에게는 저장된 개인별 권한으로 연다 — 그 사람의 그 메뉴만 열린다", () => {
    const stored = [{ userId: STAFF, menu: "approvals" as const, access: "full" as const }];
    const matrix = applyUserOverrides(resolveMatrix([]), STAFF, "admin", [...approvalMenuOverridesFor(STAFF, false), ...stored]);
    expect(matrix.approvals.admin).toBe("full");
    expect(matrix.staff.admin).toBe(MENU_ACCESS.staff.admin); // 다른 메뉴는 그대로
    // 줄이 없는 사람은 그대로 닫혀 있다.
    expect(applyUserOverrides(resolveMatrix([]), OUTSIDER, "admin", stored).approvals.admin).toBe("none");
  });

  it("역할 표에서 열면 그 역할 전원에게 열린다", () => {
    expect(resolveMatrix([{ menu: "approvals", role: "admin", access: "full" }]).approvals.admin).toBe("full");
  });

  it("🔴 코드가 얹는 예외는 없다 — 어느 계정이든(전에 파일럿이던 계정 포함) 저장값 없이는 닫혀 있다", () => {
    expect(approvalMenuOverridesFor(STAFF, false)).toEqual([]);
    expect(approvalMenuOverridesFor(OUTSIDER, false)).toEqual([]);
  });

  it("super_admin은 저장값 없이도 통과(원장 지시 2026-08-13)", () => {
    const matrix = applyUserOverrides(resolveMatrix([]), OUTSIDER, "master", approvalMenuOverridesFor(OUTSIDER, true));
    expect(matrix.approvals.master).toBe("full");
  });
});
