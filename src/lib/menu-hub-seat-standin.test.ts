import { describe, expect, it } from "vitest";
import { HUB_GROUPS, hubGroupsFor, hubSearchEntries, innerTabsOf, SUPPORT_GROUPS } from "@/lib/menu-hub";
import { MENU_ACCESS, type Access, type AccessMatrix, type MenuKey, type SystemRole } from "@/lib/permissions";

/**
 * 자리 출석부(랩실·JJ실) 대신 입구 — 원장 2026-11-05 *"랩실 JJ실 출석부만 보이게 하고 싶은데, 출석부 권한을 안주면 해당 출석부만
 * 보이지 않게 되고. 담당이나 읽기를 주면 결국 다른 선생님 출석부를 모두 볼 수 있음"*.
 * 출석부(attendance)는 없고 자리 출석부(seat_attendance)만 받은 사람에겐 출석부 자리에 두 자리가 대신 선다.
 * 출석부를 볼 수 있는 사람의 메뉴·메뉴 지도·검색은 그대로다(자리는 출석부 화면 드롭다운의 한 갈래 — 원장 2026-08-14 "따로 빼지말고").
 */
const withCells = (cells: [MenuKey, SystemRole, Access][]): AccessMatrix => {
  const m = Object.fromEntries(Object.entries(MENU_ACCESS).map(([k, v]) => [k, { ...v }])) as AccessMatrix;
  for (const [menu, role, access] of cells) m[menu][role] = access;
  return m;
};
const ALL = [...HUB_GROUPS, ...SUPPORT_GROUPS];
const hrefs = (role: SystemRole, permMatrix: AccessMatrix) => hubGroupsFor(ALL, { systemRole: role, permMatrix }).flatMap((g) => g.items.map((d) => d.href));
const SEATS = ["/attendance/seat/lab", "/attendance/seat/jj"];

describe("자리 출석부 대신 입구", () => {
  it("출석부 없음 + 자리 출석부 있음 → 출석부 자리에 랩실·JJ실 출석부가 선다(다른 선생님 출석부로 가는 입구는 없다)", () => {
    const m = withCells([["attendance", "parttime", "none"], ["seat_attendance", "parttime", "full"]]);
    const got = hrefs("parttime", m);
    expect(got).toEqual(expect.arrayContaining(SEATS));
    expect(got).not.toContain("/attendance");
    expect(got).not.toContain("/attendance/live");
    // 메뉴 검색에서도 이름으로 찾힌다(업무군의 버튼이 되었으므로).
    expect(hubSearchEntries({ systemRole: "parttime", permMatrix: m }).map((e) => e.dest.href)).toEqual(expect.arrayContaining(SEATS));
  });

  it("둘 다 없으면 아무것도 서지 않는다", () => {
    const got = hrefs("parttime", withCells([["attendance", "parttime", "none"], ["seat_attendance", "parttime", "none"]]));
    for (const h of [...SEATS, "/attendance"]) expect(got).not.toContain(h);
  });

  it("🔴 출석부를 볼 수 있는 사람(원장 · 기본 자리 권한 있음)의 메뉴·메뉴 지도·검색은 그대로 — 자리를 따로 세우지 않는다", () => {
    const got = hrefs("master", MENU_ACCESS);
    expect(got).toContain("/attendance");
    for (const h of SEATS) expect(got).not.toContain(h);
    expect(innerTabsOf("/attendance", { systemRole: "master", permMatrix: MENU_ACCESS })).toEqual([]);
    const searched = hubSearchEntries({ systemRole: "master", permMatrix: MENU_ACCESS }).map((e) => e.dest.href);
    for (const h of SEATS) expect(searched).not.toContain(h);
  });

  it("메뉴 구성에서 출석부를 감추면 대신 입구도 감춘다", () => {
    const m = withCells([["attendance", "parttime", "none"], ["seat_attendance", "parttime", "full"]]);
    const got = hubGroupsFor(ALL, { systemRole: "parttime", permMatrix: m, menuLayout: [{ href: "/attendance", hidden: true }] })
      .flatMap((g) => g.items.map((d) => d.href));
    for (const h of SEATS) expect(got).not.toContain(h);
  });
});
