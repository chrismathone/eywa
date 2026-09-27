import { describe, expect, it } from "vitest";
import { parseUsageRows, shapeUsage, type RawUsageRow } from "./summary";

const row = (p: Partial<RawUsageRow> & { set: string }): RawUsageRow => ({
  tenantId: null,
  role: null,
  subjectGroup: null,
  menuKey: null,
  routeKey: null,
  visits: 0,
  openSec: 0,
  activeSec: 0,
  users: 0,
  ...p,
});

const ROWS: RawUsageRow[] = [
  row({ set: "total", visits: 30, openSec: 5000, activeSec: 3000, users: 4 }),
  row({ set: "menu", menuKey: "timetable", visits: 10, openSec: 3000, activeSec: 1000, users: 3 }),
  row({ set: "menu", menuKey: "attendance", visits: 20, openSec: 2000, activeSec: 2000, users: 4 }),
  row({ set: "route", menuKey: "attendance", routeKey: "/attendance", visits: 20, openSec: 2000, activeSec: 2000, users: 4 }),
  row({ set: "role", role: "teacher", visits: 25, openSec: 4000, activeSec: 2500, users: 3 }),
  row({ set: "role_menu", role: "teacher", menuKey: "timetable", visits: 5, openSec: 2500, activeSec: 500, users: 2 }),
  row({ set: "role_menu", role: "teacher", menuKey: "attendance", visits: 20, openSec: 1500, activeSec: 2000, users: 3 }),
  row({ set: "role", role: "master", visits: 5, openSec: 1000, activeSec: 500, users: 1 }),
  row({ set: "tenant", tenantId: "t1", visits: 30, openSec: 5000, activeSec: 3000, users: 4 }),
  row({ set: "tenant_menu", tenantId: "t1", menuKey: "attendance", visits: 20, openSec: 2000, activeSec: 2000, users: 4 }),
];

describe("shapeUsage", () => {
  it("기본은 활동 시간순 — 화면 시간이 길어도 활동이 적으면 아래로(멍하니 띄워 둔 화면)", () => {
    const s = shapeUsage(ROWS, ["timetable", "attendance", "shuttle"]);
    expect(s.menus.map((m) => m.menuKey)).toEqual(["attendance", "timetable"]);
    expect(s.menus[0]!.share).toBeCloseTo(2000 / 3000);
  });

  it("정렬 기준을 바꾸면 비중도 그 기준으로", () => {
    const s = shapeUsage(ROWS, [], "open");
    expect(s.menus.map((m) => m.menuKey)).toEqual(["timetable", "attendance"]);
    expect(s.menus[0]!.share).toBeCloseTo(3000 / 5000);
  });

  it("권한·지점 묶음은 SQL이 준 합계를 그대로 쓰고, 상위 메뉴 비중은 그 묶음 안에서", () => {
    const s = shapeUsage(ROWS, []);
    const [teacher, second] = s.roles;
    expect(teacher!.key).toBe("teacher");
    expect(second!.key).toBe("master");
    expect(teacher!.users).toBe(3);
    expect(teacher!.topMenus.map((m) => m.menuKey)).toEqual(["attendance", "timetable"]);
    expect(teacher!.topMenus[0]!.share).toBeCloseTo(2000 / 2500);
    expect(s.tenants[0]).toMatchObject({ key: "t1", users: 4 });
    expect(second!.topMenus).toEqual([]);
  });

  it("강사는 과목 묶음으로 갈린다(0293a) — 강사 아닌 권한은 과목 칸이 ''라 그대로", () => {
    const s = shapeUsage(
      [
        row({ set: "role", role: "teacher", subjectGroup: "math", activeSec: 300, users: 2 }),
        row({ set: "role", role: "teacher", subjectGroup: "english+math", activeSec: 200, users: 1 }),
        row({ set: "role", role: "teacher", subjectGroup: "", activeSec: 100, users: 1 }),
        row({ set: "role", role: "admin", subjectGroup: "", activeSec: 50, users: 1 }),
        row({ set: "role_menu", role: "teacher", subjectGroup: "math", menuKey: "mcs", activeSec: 300, users: 2 }),
      ],
      [],
    );
    expect(s.roles.map((r) => r.key).join(",")).toBe("teacher:math,teacher:english+math,teacher:,admin");
    expect(s.roles[0]!.topMenus.map((m) => m.menuKey)).toEqual(["mcs"]);
    expect(s.roles[1]!.topMenus).toEqual([]);
  });

  it("기간 안에 안 열린 메뉴를 가려낸다", () => {
    expect(shapeUsage(ROWS, ["timetable", "attendance", "shuttle"]).unusedMenus).toEqual(["shuttle"]);
  });

  it("기록이 없으면 전부 0·빈 목록", () => {
    const s = shapeUsage([], ["a"]);
    expect(s.total).toEqual({ visits: 0, openSec: 0, activeSec: 0, users: 0 });
    expect(s.menus).toEqual([]);
    expect(s.unusedMenus).toEqual(["a"]);
  });
});

describe("parseUsageRows", () => {
  it("jsonb 배열 → 행, 모양이 다른 원소는 버린다", () => {
    const rows = parseUsageRows([
      { set: "menu", menu_key: "billing", visits: "3", open_seconds: 10, active_seconds: 5, users: 1 },
      null,
      { visits: 1 },
    ]);
    expect(rows).toEqual([
      { set: "menu", tenantId: null, role: null, subjectGroup: null, menuKey: "billing", routeKey: null, visits: 3, openSec: 10, activeSec: 5, users: 1 },
    ]);
    expect(parseUsageRows(null)).toEqual([]);
    expect(parseUsageRows([{ set: "role", role: "teacher", subject_group: "" }])[0]!.subjectGroup).toBe("");
  });
});
