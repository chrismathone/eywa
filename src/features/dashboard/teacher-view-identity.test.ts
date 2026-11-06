import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 운영실의 사람 = '다른 강사 뷰'의 대상 직원(원장 2026-11-05 강사뷰 전수) — 로그인 계정(requireAccess·인자 없는 getCurrentUser)으로
 * 배치·공지 대상·관리 버튼을 정하던 자리가 되돌아가지 않게 잠근다. 동작은 viewer-server.test · server/actions.test · server-on-view.test가 본다.
 */
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

describe("운영실 — 대상 직원 기준", () => {
  it("과목 탭·강사별 업무(extras)는 대상 직원으로 연다", () => {
    expect(read("src", "features", "dashboard", "instruments", "extras-server.ts")).toContain("getCurrentUser({ teacherView: true })");
  });
  it("묶음·담당 과목 판정은 강사뷰면 대상으로 바꾼다(호출부가 로그인 계정을 넘겨도)", () => {
    expect(read("src", "features", "dashboard", "layout", "viewer-server.ts")).toMatch(/const user = \(await viewAsTeacher\(\)\) \?\? viewer;/);
  });
  it("스냅샷(loadOverview)과 공지 화면은 대상 직원의 역할로 공지 대상·관리 여부를 정한다", () => {
    expect(read("src", "features", "dashboard", "overview", "server.ts")).toMatch(/const user = \(await getCurrentUser\(\{ teacherView: true \}\)\) \?\? signedIn;/);
    expect(read("src", "app", "(shell)", "dashboard", "announcements", "page.tsx")).toMatch(/const user = \(await getCurrentUser\(\{ teacherView: true \}\)\) \?\? signedIn;/);
  });
  it("공지 액션은 전부 대상 직원으로 판정한다(인자 없는 getCurrentUser가 없다)", () => {
    const src = read("src", "features", "dashboard", "server", "actions.ts");
    expect(src).not.toMatch(/getCurrentUser\(\)/);
    expect(src.match(/const user = await getCurrentUser\(\{ teacherView: true \}\);/g)?.length).toBe(5);
  });
});
