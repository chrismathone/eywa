import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 신규생 기록(`/newcomers/stats`) = **학원 전체** 신규생 수·기한 경과다 — 담당 범위 계정(강사 · '담당' · 읽기 강사뷰가 지운 담당)은
 * 자기 담임 학생만 보는 신규생 관리(`/newcomers`)로 돌려보낸다(2026-11-11 — 강사에게 신규생 관리를 '담당'으로 여는 결정과 함께 · #77).
 * 판정은 신규생 관리 화면과 같은 `followupAccess().scoped` — 그 함수의 판정 자체는 server/followup-query.test.ts가 본다.
 */
describe("신규생 기록 화면 — 담당 범위 계정은 보지 않는다", () => {
  const page = readFileSync(join(process.cwd(), "src", "app", "(shell)", "newcomers", "stats", "page.tsx"), "utf8");

  it("🔴 메뉴 문을 지난 뒤, 기록을 읽기 전에 담당 범위를 보고 돌려보낸다", () => {
    const gate = page.indexOf('await requireAccess("newcomers")');
    const scope = page.indexOf("(await followupAccess()).scoped");
    const load = page.indexOf("loadOpsHistory(");
    expect(gate).toBeGreaterThan(-1);
    expect(scope).toBeGreaterThan(gate);
    // 본문에서 처음 기록을 읽는 자리(import 줄이 아니라 호출)보다 앞이다.
    expect(page.indexOf("loadOpsHistory(user.tenantId")).toBeGreaterThan(scope);
    expect(load).toBeGreaterThan(-1);
    expect(page).toMatch(/if \(\(await followupAccess\(\)\)\.scoped\) redirect\(/);
  });

  it("창(embed) 안에서는 embed=1을 달아 보낸다 — 안 달면 창 안에 전체 셸이 뜬다(#133)", () => {
    expect(page).toContain('(await headers()).get("x-embed") === "1" ? "/newcomers?embed=1" : "/newcomers"');
  });

  it("🔴 페이지에서 역할을 직접 비교하지 않는다 — 판정은 권한 도우미 한 곳", () => {
    expect(page).not.toMatch(/systemRole\s*[!=]==/);
    expect(page).not.toMatch(/"teacher"|"master"|"admin"/);
    expect(page).toContain('import { followupAccess } from "@/features/newcomers/server/followup-query";');
  });
});
