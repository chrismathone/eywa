import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MENU_ACCESS, mergeMostPermissive } from "@/lib/permissions";
import { applyUserMenuBlocks, USER_MENU_BLOCKS } from "./user-menu-blocks";

const YUN = "07cbe245-e8c8-4938-a974-8873689f72f4";

describe("개인 메뉴 차단(원장 2026-10-20)", () => {
  it("윤여원은 원장 역할이어도 직원관리가 닫힌다 — 다른 메뉴·다른 역할 줄은 그대로", () => {
    const m = applyUserMenuBlocks(MENU_ACCESS, YUN, ["master"]);
    expect(m.staff.master).toBe("none");
    expect(m.students.master).toBe(MENU_ACCESS.students.master);
    expect(m.staff.admin).toBe(MENU_ACCESS.staff.admin);
  });
  it("슈퍼관리자 병합(높은 쪽) 뒤에 눌러야 산다 — 앞에서 누르면 병합이 되살린다", () => {
    const before = mergeMostPermissive(MENU_ACCESS, applyUserMenuBlocks(MENU_ACCESS, YUN, ["master"]));
    expect(before.staff.master).toBe("full");
    const after = applyUserMenuBlocks(mergeMostPermissive(MENU_ACCESS, MENU_ACCESS), YUN, ["master"]);
    expect(after.staff.master).toBe("none");
  });
  it("명단 밖 사용자·비로그인은 입력 그대로(변형 없음)", () => {
    expect(applyUserMenuBlocks(MENU_ACCESS, "someone-else", ["master"])).toBe(MENU_ACCESS);
    expect(applyUserMenuBlocks(MENU_ACCESS, null, ["master"])).toBe(MENU_ACCESS);
    expect(MENU_ACCESS.staff.master).not.toBe("none");
  });
  it("명단은 원장이 지시한 한 줄뿐이다(넓히려면 원장에게 다시 묻는다)", () => {
    expect(USER_MENU_BLOCKS).toEqual({ [YUN]: ["staff"] });
  });
  it("배선: 행위자·다른 강사 뷰 매트릭스 둘 다 맨 끝에서 누른다(강사뷰는 보는 사람 · 대상 둘 다 — 2026-11-05)", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/auth/perm-matrix.ts"), "utf8");
    expect(src.match(/applyUserMenuBlocks\(/g)?.length).toBe(3);
    expect(src).toMatch(/applyUserMenuBlocks\(applyUserMenuBlocks\(m, user\.id, [^)]*\), target\.id,/);
  });
});
