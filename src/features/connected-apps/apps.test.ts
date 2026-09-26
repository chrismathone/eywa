import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONNECTED_APPS, connectedAppVisibleTo } from "./apps";

const todaysMath = CONNECTED_APPS.find((a) => a.feature === "todays_math")!;
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

describe("연결 앱 — 담당 과목 축(원장 2026-09-26 *\"영어교사는 탭이 안보여야함\"*)", () => {
  it("오늘의 수학은 영어만 맡은 사람에게 안 보인다", () => {
    expect(connectedAppVisibleTo(todaysMath, ["english"])).toBe(false);
  });

  it("수학·겸업·다른 과목은 보인다", () => {
    expect(connectedAppVisibleTo(todaysMath, ["math"])).toBe(true);
    expect(connectedAppVisibleTo(todaysMath, ["math", "english"])).toBe(true);
    expect(connectedAppVisibleTo(todaysMath, ["science"])).toBe(true);
  });

  it("과목이 없는 직원(원장·사무)은 보인다 — 과목으로 가를 근거가 없다", () => {
    expect(connectedAppVisibleTo(todaysMath, [])).toBe(true);
  });

  it("과목 제한이 없는 앱은 누구에게나 보인다", () => {
    expect(connectedAppVisibleTo({ ...todaysMath, hiddenForOnlySubjects: undefined }, ["english"])).toBe(true);
  });
});

describe("연결 앱 — 모든 입구가 같은 판정을 쓴다([[#77]] 화면에서만 잠그면 주소로 들어온다)", () => {
  const layout = read("src", "app", "(shell)", "layout.tsx");
  const launch = read("src", "app", "api", "connected-apps", "todays-math", "launch", "route.ts");

  it("셸(사이드바·폰 메뉴·강사 '내 메뉴')과 출발 라우트가 getMyConnectedApps를 본다", () => {
    expect(layout).toContain("getMyConnectedApps()");
    expect(layout).toMatch(/connectedApps=\{teacherConnectedApps\}/);
    expect(launch).toContain("getMyConnectedApps()");
  });

  it("총괄(super_admin)은 과목 축을 건너뛴다(결정 로그 staff.md — 새 게이트에 총괄을 빼먹지 말 것)", () => {
    const visible = read("src", "features", "connected-apps", "server", "visible.ts");
    expect(visible).toMatch(/isCurrentUserSuperAdmin\(\)\)\) return enabled/);
  });

  it("🔴 셸·출발 라우트가 지점 스위치만 따로 읽지 않는다 — 과목 축이 빠진 두 번째 판정이 된다", () => {
    expect(layout).not.toMatch(/isFeatureOptedIn\(/);
    expect(launch).not.toMatch(/isFeatureOptedIn\(/);
  });
});
