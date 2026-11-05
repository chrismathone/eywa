import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONNECTED_APP_MENU_KEYS, isConnectedAppMenu, MENU_ACCESS } from "@/lib/permissions";
import { CONNECTED_APPS, connectedAppNote, connectedAppVisibleTo } from "./apps";

const todaysMath = CONNECTED_APPS.find((a) => a.feature === "todays_math")!;
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
/** 주석을 뗀 원문 — 주석에 적힌 함수 이름으로 배선 검사가 통과하지 않게. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("연결 앱 — 담당 과목 축(원장 2026-09-26 *\"영어교사는 탭이 안보여야함\"*)", () => {
  it("오늘 수학은 영어만 맡은 사람에게 안 보인다", () => {
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

  it("'연결 앱 권한' 표 아래 안내 = 과목 축을 학원 설정의 과목 이름으로(하드코딩 없이) · 제한 없는 앱은 안내 없음", () => {
    const labelOf = (key: string) => ({ english: "영어(EiE)" })[key] ?? key;
    expect(connectedAppNote(todaysMath, labelOf)).toBe("담당 과목이 영어(EiE)뿐인 직원에게는 이 표와 상관없이 보이지 않습니다");
    expect(connectedAppNote({ ...todaysMath, hiddenForOnlySubjects: undefined }, labelOf)).toBeUndefined();
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

  it("🔴 오늘 수학 v2 로그인(authorize)도 코드를 내주기 전에 같은 판정을 본다 — 오늘 수학 쪽 시작 주소로 바로 들어와도(리뷰 2026-11-05)", () => {
    const authorize = strip(read("src", "app", "api", "connected-apps", "todays-math", "authorize", "route.ts"));
    const gate = authorize.indexOf("getMyConnectedApps()");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(authorize.indexOf("tm_sync_issue_code"));
    // 자리 = 오늘 수학 자격 확인 뒤(꺼짐·검증 실패의 403/503은 그대로 · 권한이 꺼지면 자격 없음과 같은 로그인 안내 — 동작 시험은 sync-authorize-fallback).
    expect(gate).toBeGreaterThan(authorize.indexOf("sourceControl("));
  });

  it("총괄은 권한 축도 통과한다 — 단 개인 메뉴 차단(USER_MENU_BLOCKS)은 따른다(새 연결 앱은 원장 칸까지 없음으로 시작)", () => {
    const visible = read("src", "features", "connected-apps", "server", "visible.ts");
    expect(visible).toMatch(/USER_MENU_BLOCKS\[user\.id\]/);
    expect(visible).toMatch(/permitted = enabled\.filter\(\(a\) => !blocked\.has\(a\.permission\)\)/);
  });

  it("총괄(super_admin)은 과목 축을 건너뛴다(결정 로그 staff.md — 새 게이트에 총괄을 빼먹지 말 것)", () => {
    const visible = read("src", "features", "connected-apps", "server", "visible.ts");
    // 권한 축(역할 표)은 총괄에게도 권한 표의 병합 규칙(getActorPermMatrix — 기본값이 바닥)으로 적용된다 — 과목 축만 건너뛴다.
    expect(visible).toMatch(/isCurrentUserSuperAdmin\(\)\)\) return permitted/);
  });

  it("🔴 역할·개인 권한 축 = 본인(행위자)의 권한 표 · 앱마다 제 권한 키(원장 2026-11-05 *\"연결앱 권한 따로 빼나줘\"*)", () => {
    const visible = read("src", "features", "connected-apps", "server", "visible.ts");
    expect(visible).toContain("getActorPermMatrix()");
    expect(visible).toMatch(/matrix\[a\.permission\]\[user\.systemRole\] !== "none"/);
    // 다른 강사 뷰의 대상 권한(getUserPermMatrix)이 아니다 — 이 입구는 로그인한 본인으로 바깥 앱에 들어간다.
    expect(visible).not.toContain("getUserPermMatrix");
  });

  it("🔴 셸·출발 라우트가 지점 스위치만 따로 읽지 않는다 — 과목 축이 빠진 두 번째 판정이 된다", () => {
    expect(layout).not.toMatch(/isFeatureOptedIn\(/);
    expect(launch).not.toMatch(/isFeatureOptedIn\(/);
  });
});

describe("연결 앱 — 권한 키(학원 설정 → 역할·권한 '연결 앱 권한')", () => {
  it("앱마다 연결 앱 권한 키 하나 — 겹치지 않고, 권한 목록의 키는 모두 어느 앱이 쓴다", () => {
    const keys = CONNECTED_APPS.map((a) => a.permission);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(isConnectedAppMenu(key), key).toBe(true);
    expect([...CONNECTED_APP_MENU_KEYS].sort()).toEqual([...keys].sort());
  });

  it("오늘 수학 기본값 = 강사 이상(원장·관리자·매니저·강사 · 원장 2026-11-05) — 상담·회계·열람·아르바이트·학생은 없음", () => {
    expect(todaysMath.permission).toBe("app_todays_math");
    const access = MENU_ACCESS.app_todays_math;
    for (const role of ["master", "admin", "manager", "teacher"] as const) expect(access[role], role).toBe("full");
    for (const role of ["counselor", "accountant", "viewer", "parttime", "student"] as const) expect(access[role], role).toBe("none");
  });
});
