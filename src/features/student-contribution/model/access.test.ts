import { describe, expect, it } from "vitest";
import { MENU_ACCESS, applyUserOverrides, resolveMatrix } from "@/lib/permissions";
import { capContributionMenu, CONTRIBUTION_PILOT_TENANT } from "./access";

describe("원생 충성도 두 열쇠", () => {
  it("기본값은 원장만 열고 다른 지점은 시범 메뉴를 닫는다", () => {
    expect(Object.entries(MENU_ACCESS.student_contribution).filter(([, v]) => v !== "none")).toEqual([["master", "full"]]);
    expect(capContributionMenu(resolveMatrix([]), "other").student_contribution.master).toBe("none");
  });
  it("메뉴를 열어도 수납이 없으면 닫고 원래 매트릭스를 바꾸지 않는다", () => {
    const matrix = structuredClone(resolveMatrix([]));
    matrix.student_contribution.teacher = "readonly";
    expect(capContributionMenu(matrix, CONTRIBUTION_PILOT_TENANT).student_contribution.teacher).toBe("none");
    expect(matrix.student_contribution.teacher).toBe("readonly");
    matrix.billing.teacher = "readonly";
    expect(capContributionMenu(matrix, CONTRIBUTION_PILOT_TENANT).student_contribution.teacher).toBe("readonly");
  });
  it("개인 열람 권한은 유지하되 기여도와 수납 두 권한이 모두 필요하다", () => {
    const base = resolveMatrix([]);
    const contributionOnly = applyUserOverrides(base, "staff", "teacher", [{ userId: "staff", menu: "student_contribution", access: "readonly" }]);
    expect(capContributionMenu(contributionOnly, CONTRIBUTION_PILOT_TENANT).student_contribution.teacher).toBe("none");
    const both = applyUserOverrides(contributionOnly, "staff", "teacher", [{ userId: "staff", menu: "billing", access: "readonly" }]);
    expect(capContributionMenu(both, CONTRIBUTION_PILOT_TENANT).student_contribution.teacher).toBe("readonly");
    expect(base.student_contribution.teacher).toBe("none");
    expect(capContributionMenu(both, "other").student_contribution.teacher).toBe("none");
  });
});
