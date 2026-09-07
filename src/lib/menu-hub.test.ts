import { describe, expect, it } from "vitest";

import {
  FAVORITE_KEYS,
  HUB_GROUPS,
  SUPPORT_GROUPS,
  favoritesFor,
  hubGroupOfPath,
  hubGroupsFor,
} from "./menu-hub";
import { NAV_GROUPS, SUBTABS_BY_MENU } from "./navigation";
import { MENU_ACCESS, type AccessMatrix, type MenuKey } from "./permissions";

const ALL = [...HUB_GROUPS, ...SUPPORT_GROUPS];
const allDests = ALL.flatMap((g) => g.items);

/** 사이드바에 서던 메뉴 전부(숨김·하부 편입 제외) — 버튼형으로 바뀌어도 **갈 길이 사라지면 안 된다**. */
const visibleMenuKeys = NAV_GROUPS.flatMap((g) => g.items)
  .filter((i) => !i.hidden && !i.subOf)
  .map((i) => i.menuKey);

describe("버튼형 메뉴 — 입구를 줄이되 목적지는 하나도 잃지 않는다", () => {
  it("🔴 기존에 보이던 메뉴는 전부 어느 업무군에든 들어 있다(입구 상실 = 그 기능이 사라진 것과 같다)", () => {
    const covered = new Set(allDests.map((d) => d.menuKey));
    const missing = visibleMenuKeys.filter((k) => !covered.has(k));
    expect(missing).toEqual([]);
  });

  it("사이드바 하부탭으로만 있던 수학 시트(mcs)도 자기 버튼을 갖는다 — 독립 권한이라 부모에 묻히면 안 된다", () => {
    const mcs = allDests.find((d) => d.menuKey === "mcs");
    expect(mcs?.href).toBe("/mcs");
    // 영어(ecs)와 **다른 버튼**이어야 한다(한 줄로 묶으면 ecs=none인 사람이 수학 시트로 못 간다).
    expect(allDests.filter((d) => d.menuKey === "ecs" || d.menuKey === "mcs")).toHaveLength(2);
  });

  it("같은 화면이 두 업무군에 서지 않는다(어디로 들어갔는지 헷갈린다)", () => {
    const seen = new Map<string, string>();
    for (const g of ALL) {
      for (const d of g.items) {
        expect(seen.has(d.href), `${d.href} 중복: ${seen.get(d.href)} · ${g.id}`).toBe(false);
        seen.set(d.href, g.id);
      }
    }
  });

  it("업무군 id는 유일하고, 바로 여는 업무군(direct)은 목적지가 하나뿐이다", () => {
    expect(new Set(ALL.map((g) => g.id)).size).toBe(ALL.length);
    for (const g of ALL.filter((x) => x.kind === "direct")) expect(g.items).toHaveLength(1);
  });

  it("목적지는 전부 앱 안 주소다(외부 링크·빈 주소 금지)", () => {
    for (const d of allDests) expect(d.href.startsWith("/")).toBe(true);
  });

  it("즐겨찾기는 업무군에도 있는 화면이다 — 중복 입구는 의도(한 번에 열기)", () => {
    const covered = new Set(allDests.map((d) => d.menuKey));
    for (const k of FAVORITE_KEYS) expect(covered.has(k)).toBe(true);
  });
});

describe("권한 — 업무군은 자식이 하나라도 열릴 때만 선다", () => {
  const matrixWith = (over: Partial<Record<MenuKey, "none" | "full">>): AccessMatrix => {
    const m = structuredClone(MENU_ACCESS);
    for (const [key, level] of Object.entries(over)) {
      for (const role of Object.keys(m[key as MenuKey])) {
        m[key as MenuKey][role as keyof (typeof m)["dashboard"]] = level as "none" | "full";
      }
    }
    return m;
  };

  it("🔴 영어가 닫혀도 수학 시트는 보인다(두 시트는 독립 권한)", () => {
    const groups = hubGroupsFor(HUB_GROUPS, {
      systemRole: "teacher",
      permMatrix: matrixWith({ ecs: "none", mcs: "full" }),
      canTeacherView: true,
    });
    const cls = groups.find((g) => g.id === "class");
    expect(cls?.items.some((d) => d.menuKey === "mcs")).toBe(true);
    expect(cls?.items.some((d) => d.menuKey === "ecs")).toBe(false);
  });

  it("자식이 전부 닫힌 업무군은 아예 안 선다(눌러도 아무 데도 못 가는 입구 금지)", () => {
    const closed: Partial<Record<MenuKey, "none">> = {
      meetings: "none",
      approvals: "none",
      documents: "none",
    };
    const groups = hubGroupsFor(HUB_GROUPS, { systemRole: "master", permMatrix: matrixWith(closed) });
    expect(groups.some((g) => g.id === "document")).toBe(false);
  });

  it("담당 반 전제 화면(원스크린·출결 모드)은 겸직일 때만 — 권한이 아니라 쓸모 판정", () => {
    // ⚠️ 원스크린은 애초에 **강사 전용 권한**(master는 none)이라, 겸직 판정은 그 위에 한 겹 더 얹힌다.
    //    그래서 이 판정은 권한이 열려 있는 역할(teacher)로 본다.
    const keysOf = (canTeacherView: boolean) =>
      hubGroupsFor(HUB_GROUPS, { systemRole: "teacher", canTeacherView })
        .find((g) => g.id === "class")
        ?.items.map((d) => d.href) ?? [];
    expect(keysOf(false)).not.toContain("/onescreen");
    expect(keysOf(true)).toContain("/onescreen");
    // 출결 모드도 같은 축(담당 반이 없으면 빈 화면).
    expect(keysOf(false)).not.toContain("/attendance/quick");
    expect(keysOf(true)).toContain("/attendance/quick");
    // 🔴 사무실(master)에겐 권한 자체가 없어 겸직이어도 원스크린 버튼이 안 선다.
    const office = hubGroupsFor(HUB_GROUPS, { systemRole: "master", canTeacherView: true })
      .find((g) => g.id === "class")
      ?.items.map((d) => d.href) ?? [];
    expect(office).not.toContain("/onescreen");
  });

  it("즐겨찾기도 권한을 탄다", () => {
    const favs = favoritesFor({ systemRole: "master", permMatrix: matrixWith({ ecs: "none" }) });
    expect(favs.some((d) => d.menuKey === "ecs")).toBe(false);
    expect(favs.some((d) => d.menuKey === "timetable")).toBe(true);
  });
});

describe("hubGroupOfPath — 지금 보고 있는 화면이 어느 업무군인가", () => {
  it("하위 경로도 그 업무군으로 읽는다", () => {
    expect(hubGroupOfPath("/students/abc")?.id).toBe("student");
    expect(hubGroupOfPath("/mcs")?.id).toBe("class");
    expect(hubGroupOfPath("/owner")?.id).toBe("owner");
  });

  it("접두가 겹치면 더 긴 경로가 이긴다(출석부 ⊂ 오늘 출결)", () => {
    // 둘 다 '수업'이지만, 판정이 짧은 쪽으로 새면 다른 업무군 화면에서도 오작동한다.
    expect(hubGroupOfPath("/attendance/live")?.id).toBe("class");
    expect(hubGroupOfPath("/shuttle/today")?.id).toBe("operation");
  });

  it("모르는 주소는 없음(지어내지 않는다)", () => {
    expect(hubGroupOfPath("/nope")).toBeUndefined();
  });
});

describe("면(하부탭)도 갈 길이 남아야 한다 — 사이드바에서 뺐으면 허브가 든다", () => {
  /**
   * 🔴 예전엔 **사이드바 하부탭**이 면(수납 7·설정 11·출석부 3·셔틀 4…)의 입구였다. 버튼형으로 바꾸며
   *    그 줄을 걷어냈으므로, 같은 면이 허브 어딘가에 없으면 **그 화면으로 갈 길이 통째로 사라진다**.
   */
  const exceptions = new Set([
    // 도움말 화면 안에 링크가 있다(`/help` 페이지의 '아이콘 시스템') — 허브에 또 세우면 지원 줄이 늘어난다.
    "/help/icons",
  ]);

  it("모든 하부탭 면이 허브 목적지에 있다", () => {
    const hrefs = new Set(allDests.map((d) => d.href));
    const missing: string[] = [];
    for (const [, faces] of Object.entries(SUBTABS_BY_MENU)) {
      for (const f of faces ?? []) {
        if (!hrefs.has(f.href) && !exceptions.has(f.href)) missing.push(f.href);
      }
    }
    expect(missing).toEqual([]);
  });
});
