import { describe, expect, it } from "vitest";

import {
  DEFAULT_FREQUENT_KEYS,
  HUB_GROUPS,
  SUPPORT_GROUPS,
  frequentFor,
  hubGroupOfPath,
  hubGroupsFor,
} from "./menu-hub";
import { NAV_GROUPS, SUBTABS_BY_MENU } from "./navigation";
import type { MenuLayout } from "@/features/owner/menu-layout";
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

  it("'자주 방문한 메뉴'의 첫 화면 기본값도 업무군에 있는 화면이다 — 중복 입구는 의도(한 번에 열기)", () => {
    const covered = new Set(allDests.map((d) => d.menuKey));
    for (const k of DEFAULT_FREQUENT_KEYS) expect(covered.has(k)).toBe(true);
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

  it("'자주 방문한 메뉴'도 권한을 탄다 — 기록에 남아 있어도 못 여는 메뉴는 안 세운다", () => {
    const favs = frequentFor({ systemRole: "master", permMatrix: matrixWith({ ecs: "none" }) });
    expect(favs.some((d) => d.menuKey === "ecs")).toBe(false);
    expect(favs.some((d) => d.menuKey === "timetable")).toBe(true);
  });

  it("방문 기록 순서를 그대로 따른다(빈 기록이면 기본값)", () => {
    const ordered = frequentFor({ systemRole: "master" }, ["students", "billing"]);
    expect(ordered.map((d) => d.menuKey)).toEqual(["students", "billing"]);
    expect(frequentFor({ systemRole: "master" }, []).map((d) => d.menuKey)).toEqual(
      DEFAULT_FREQUENT_KEYS,
    );
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

/**
 * 학원 설정 '왼쪽 탭'(`navigation.menus`)이 **실제로 이 목록을 바꾸는지** — 설정 배선의 5단계(검증)다.
 * 소비처가 없는 설정은 만들지 않는다는 규약(CLAUDE.md)의 증거를 여기 둔다.
 */
describe("왼쪽 탭 설정 — 보기만 바꾼다(권한 아님)", () => {
  const base = { systemRole: "master" as const, isMaster: true, canTeacherView: true };
  const hrefsOf = (layout?: MenuLayout) =>
    hubGroupsFor(HUB_GROUPS, { ...base, menuLayout: layout }).flatMap((g) => g.items.map((d) => d.href));

  it("🔴 설정이 비면 지금과 글자 그대로 같다", () => {
    expect(hrefsOf([])).toEqual(hrefsOf(undefined));
    expect(hrefsOf(undefined)).toContain("/newcomers");
  });

  it("감춘 목적지는 목록에서 빠진다 — 같은 메뉴의 다른 면은 그대로", () => {
    const after = hrefsOf([{ href: "/attendance/live", hidden: true }]);
    expect(after).not.toContain("/attendance/live");
    expect(after).toContain("/attendance"); // 부모 메뉴는 산다(면 단위 판정)
  });

  it("감춘 메뉴는 '자주 방문한 메뉴' 줄에서도 빠진다 — 감췄는데 맨 위에 남으면 안 된다", () => {
    const favs = frequentFor({ ...base, menuLayout: [{ href: "/students", hidden: true }] }, ["students", "billing"]);
    expect(favs.map((d) => d.menuKey)).toEqual(["billing"]);
  });

  it("순서를 정하면 업무군 안에서 그 순서로 선다", () => {
    const counsel = (layout?: MenuLayout) =>
      hubGroupsFor(HUB_GROUPS, { ...base, menuLayout: layout }).find((g) => g.id === "counsel")!.items.map((d) => d.href);
    const before = counsel(undefined);
    const moved = counsel([{ href: "/newcomers", order: 0 }]);
    expect(moved[0]).toBe("/newcomers");
    expect([...moved].sort()).toEqual([...before].sort()); // 사라진 것도 생긴 것도 없다
  });

  it("🔴 학원 설정 자신은 감춰지지 않는다 — 저장값이 그렇게 적혀 있어도(돌아올 길)", () => {
    const support = hubGroupsFor(SUPPORT_GROUPS, { ...base, menuLayout: [{ href: "/owner", hidden: true }] });
    expect(support.find((g) => g.id === "owner")?.items.map((d) => d.href)).toContain("/owner");
  });
});

describe("메뉴에서 감춘 항목은 '자주 방문한 메뉴'에도 안 뜬다", () => {
  const gate = { systemRole: "master" as const };

  it("🔴 캘린더는 방문 기록이 아무리 많아도 안 선다 — 감추기 전 기록으로 되살아나면 안 된다", () => {
    const rows = frequentFor(gate, ["calendar", "students"]);
    expect(rows.map((d) => d.menuKey)).not.toContain("calendar");
    expect(rows.map((d) => d.menuKey)).toContain("students");
  });

  it("하위 면만 감춘 메뉴(수납)는 그대로 뜬다 — 과잉 차단 금지", () => {
    expect(frequentFor(gate, ["billing"]).map((d) => d.menuKey)).toContain("billing");
  });

  it("기본값에도 감춘 메뉴가 없다", () => {
    expect(frequentFor(gate).map((d) => d.menuKey)).not.toContain("calendar");
  });
});
