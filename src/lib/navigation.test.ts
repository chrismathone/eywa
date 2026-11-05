import { describe, expect, it } from "vitest";
import { MENU_ACCESS, MENU_LABEL, MENU_KEYS, menuKeyForPath } from "./permissions";
import {
  activeSubTabHref,
  findNavGroup,
  findNavItem,
  navPresentation,
  subTabsForMenu,
  menuSearchKeywords,
  isInternalPath,
  NAV_GROUPS,
} from "./navigation";

describe("navigation presentation", () => {
  it("대시보드는 모든 업무 창 뒤의 기본 작업 화면이다", () => {
    const dashboard = findNavItem("/dashboard");
    expect(dashboard).toBeTruthy();
    expect(dashboard!.label).toBe("대시보드");
    expect(navPresentation(dashboard!)).toBe("desktop");
  });

  it("등록상담은 별도 권한을 가진 탐색 메뉴로 노출한다", () => {
    const enrollment = findNavItem("/enrollment");
    // 라벨 = 페이지 metadata.title("신규 콜&상담 — aywa")과 동일 — 창 타이틀바가 문서 제목을 보여주므로.
    expect(enrollment).toMatchObject({ label: "신규 콜&상담", menuKey: "enrollment" });
    expect(enrollment!.hidden).not.toBe(true);
  });

  it("presentation을 생략한 기존 메뉴는 플로팅 창이 기본값이다", () => {
    const students = findNavItem("/students");
    expect(students).toBeTruthy();
    expect(students!.presentation).toBeUndefined();
    expect(navPresentation(students!)).toBe("window");
  });

  it("query와 hash가 붙은 창 경로도 메뉴와 그룹을 유지한다", () => {
    expect(findNavItem("/billing?tab=expenses")?.menuKey).toBe("billing");
    expect(findNavGroup("/billing?tab=expenses#pending")?.label).toBe("운영");
  });
});

describe("강사 시트 — 독립 사이드바 탭 (원장 2026-08-17 승격 · 08-31 영어/수학 묶음)", () => {
  // 2026-07-29~08-16엔 시간표의 subOf 하위 카테고리였다. 승격은 사이드바 위치만 바꾼다 —
  // 라우트(/ecs)·menuKey(권한)·창 크기·강사 미니셸 진입은 전부 그대로다.
  // 2026-08-31: 수학 시트(MCS)가 생기면서 **라벨만** "강사 시트"로 바뀌고 하부탭 둘이 붙었다
  // (원장: *"영어 강사 시트와 수학 강사 시트를 함께 묶어서 강사 시트의 세부 탭으로 2개 배정"*).
  // 승격 성질(최상위·subOf 없음·수업 그룹)은 그대로여야 한다.
  it("시간표와 같은 급의 최상위 항목이다 — subOf 없음, 수업 그룹 소속", () => {
    const ecs = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.href === "/ecs");
    expect(ecs).toMatchObject({ label: "강사 시트", menuKey: "ecs" });
    expect(ecs!.subOf).toBeUndefined();
    expect(ecs!.hidden).not.toBe(true);
    expect(findNavGroup("/ecs")?.label).toBe("수업");
  });

  it("🔴 하부탭은 영어·수학 둘이고 수학은 **자기 menuKey**를 갖는다(별도 권한·별도 창)", () => {
    const tabs = subTabsForMenu("ecs");
    expect(tabs.map((t) => t.label)).toEqual(["영어", "수학"]);
    // 영어는 부모 라우트 자신이라 menuKey가 없다(부모 창의 면 전환).
    expect(tabs[0]).toMatchObject({ href: "/ecs" });
    expect(tabs[0]!.menuKey).toBeUndefined();
    // 수학은 독립 메뉴 — 여기서 menuKey를 빼면 사이드바가 권한을 안 보고 부모 창에서 열려 버린다.
    expect(tabs[1]).toMatchObject({ href: "/mcs", menuKey: "mcs" });
  });

  it("수학 시트는 자기 권한키로 풀린다 — 상세 경로도 같은 키", () => {
    expect(menuKeyForPath("/mcs")).toBe("mcs");
    expect(menuKeyForPath("/mcs/abc-123/month")).toBe("mcs");
  });

  it("두 시트의 활성 하부탭이 서로 섞이지 않는다", () => {
    const tabs = subTabsForMenu("ecs");
    expect(activeSubTabHref(tabs, "/mcs")).toBe("/mcs");
    expect(activeSubTabHref(tabs, "/mcs/abc-123/month?month=2026-08")).toBe("/mcs");
    expect(activeSubTabHref(tabs, "/ecs")).toBe("/ecs");
    expect(activeSubTabHref(tabs, "/ecs/abc-123/month")).toBe("/ecs");
  });

  it("창 해석(findNavItem)은 불변 — 지우면 WindowLink가 창을 못 연다", () => {
    expect(findNavItem("/ecs")?.menuKey).toBe("ecs");
    expect(findNavItem("/ecs/abc-123")?.menuKey).toBe("ecs");
  });

  // 시간표 하부탭의 내력: ECS가 떠난 뒤 0면 → 2026-08-28 원장 지시로 3면(본 시간표 / 개발중 / 월별 비교)
  // → 08-31 사이드바에서 숨김 → **10-23 '개발중'·'월별 비교' 화면째 제거**(편집기로 대체).
  // 경로가 겹치는 하부탭의 '긴 쪽이 이긴다' 규약은 아래 출석부 묶음이 잠근다.
  it("시간표는 하부탭이 없다 — 사이드바에 줄이 서지 않는다", () => {
    expect(subTabsForMenu("timetable")).toEqual([]);
  });
});

describe("하위 카테고리·하부탭(subTabsForMenu)", () => {
  // 🔴 원장 2026-08-03: 직원관리가 '직원 목록' 하나만 남자 사이드바의 그 한 줄이 노이즈가 됐다.
  //    "면 하나 = 하부탭 아님". 단 독립 메뉴(subOf 자식)는 하나여도 남는다(지우면 갈 길이 사라진다) —
  //    현재 subOf 사용처는 0이라 이 분기는 다음 하위 카테고리 메뉴가 생길 때 다시 산다.
  it("면이 하나뿐인 메뉴는 하부탭을 내지 않는다(직원관리)", () => {
    expect(subTabsForMenu("staff")).toEqual([]);
  });

  it("면(?tab=)만 있는 메뉴는 menuKey 없이 그대로 — 부모 창에서 면 전환", () => {
    const subs = subTabsForMenu("billing");
    expect(subs.length).toBeGreaterThan(0);
    expect(subs.every((s) => s.menuKey === undefined)).toBe(true);
  });
});

describe("하부탭 활성 — 접두가 겹치면 긴 쪽이 이긴다", () => {
  const attendance = [
    { href: "/attendance/live" },
    { href: "/attendance" },
  ];

  it("오늘 출결에서는 월별이 같이 켜지지 않는다", () => {
    expect(activeSubTabHref(attendance, "/attendance/live")).toBe("/attendance/live");
    expect(activeSubTabHref(attendance, "/attendance/live?tab=seating")).toBe("/attendance/live");
  });

  it("월별 장부·날짜 칸만 월별이 켜진다", () => {
    expect(activeSubTabHref(attendance, "/attendance")).toBe("/attendance");
    expect(activeSubTabHref(attendance, "/attendance/2026-08-14")).toBe("/attendance");
  });

  it("출석부 부모 기본 착지는 월별이다 — 오늘 출결을 부모 href로 올리지 않는다", () => {
    expect(findNavItem("/attendance")?.href).toBe("/attendance");
    expect(NAV_GROUPS.flatMap((g) => g.items).find((i) => i.menuKey === "attendance")?.href).toBe(
      "/attendance",
    );
  });

  it("수납 ?tab= 면은 접두와 섞이지 않는다", () => {
    const billing = subTabsForMenu("billing");
    expect(activeSubTabHref(billing, "/billing")).toBe("/billing");
    expect(activeSubTabHref(billing, "/billing?tab=textbooks")).toBe("/billing?tab=textbooks");
  });
});

/**
 * 🔴 **새 메뉴를 만들 때 빠뜨리기 쉬운 배선**을 구조로 잠근다.
 *
 * 계기(원장 2026-09-09): *"'신입생 관리' 탭을 만들었는데 찾을 수가 없네. 자동 배정이 안되어있네."*
 * 실제 원인은 권한도 등록도 아니었지만(둘 다 정상이었다), 그걸 **확인하는 데만 한참 걸렸다** —
 * "메뉴 하나가 제대로 붙었나"를 한 번에 말해 주는 자리가 없어서다. 그래서 여기서 잠근다.
 *
 * ⚠️ 사이드바 노출(허브 업무군 편입)은 여기가 아니라 [`menu-hub.test.ts`](./menu-hub.test.ts)가 잠근다
 *    — 버튼형 전환(2026-09-07) 뒤로 사이드바를 그리는 건 NAV_GROUPS가 아니라 HUB_GROUPS라서다.
 *    두 벌로 만들지 말고 그쪽을 볼 것.
 */
describe("새 메뉴 배선 — 권한 표·라벨·경로 매핑이 함께 있어야 한다", () => {
  const items = NAV_GROUPS.flatMap((g) => g.items);

  it("NAV_GROUPS의 모든 menuKey가 권한 기본값 표(MENU_ACCESS)에 있다", () => {
    // 타입(AccessMatrix = Record<MenuKey, …>)이 이미 잠그지만, 표가 손으로 편집되거나 키가
    // 문자열로 새어 들어와도 잡히도록 런타임에서도 본다. 빠지면 canAccess가 undefined를 읽어 터진다.
    const missing = items
      .map((i) => i.menuKey)
      .filter((k) => !(k in MENU_ACCESS) || !(k in MENU_LABEL));
    expect(missing).toEqual([]);
  });

  it("권한 표의 모든 셀이 9개 역할을 다 채운다(빈 칸 = 조용한 차단)", () => {
    for (const key of MENU_KEYS) {
      expect(Object.keys(MENU_ACCESS[key]).length, `${key} 역할 수`).toBe(9);
    }
  });

  /**
   * 🔑 여기가 **실제로 안 잠겨 있던 자리**다 — `PATH_SEGMENT_TO_MENU`는 `Record<string, MenuKey>`라
   *    메뉴가 빠져도 타입이 통과한다. 빠지면 `menuKeyForPath`가 null이 되고, 셸의 뷰-경로 정합성 가드가
   *    fail-open으로 지나가 강사 미니셸이 강사가 못 여는 페이지를 감쌀 수 있다.
   */
  it("모든 메뉴 주소가 자기 menuKey로 되풀린다(menuKeyForPath) — 숨김 메뉴도 포함", () => {
    const broken = items
      .filter((i) => menuKeyForPath(i.href) !== i.menuKey)
      .map((i) => `${i.href} → ${menuKeyForPath(i.href) ?? "null"} (기대: ${i.menuKey})`);
    expect(broken).toEqual([]);
  });

  it("신규생 관리(2026-09-09 신설)도 같은 배선을 통과한다", () => {
    const item = items.find((i) => i.menuKey === "newcomers");
    expect(item).toMatchObject({ href: "/newcomers", label: "신규생 관리" });
    expect(item!.hidden).not.toBe(true);
    // 데스크 업무라 사무실은 열리고 강사는 막힌다(테넌트 전역 명단이라 강사 스코핑이 없다 — 퇴원관리와 같은 판단).
    expect(MENU_ACCESS.newcomers.master).toBe("full");
    expect(MENU_ACCESS.newcomers.teacher).toBe("none");
    expect(menuKeyForPath("/newcomers")).toBe("newcomers");
  });
});

/**
 * 검색 별칭 — 원장 2026-09-09: *"'신입생 관리' 탭을 만들었는데 **찾을 수가 없네**."*
 * 라벨은 "신규생 관리"라 팰릿 키워드에 "신입"이 한 글자도 없어 검색이 0건이었다.
 * 🔴 별칭은 **검색 전용**이다 — 화면 라벨은 여전히 `label` 하나뿐(라벨 변경 규약과 다른 축).
 */
describe("검색 별칭 — 사람이 부르는 말로도 찾힌다", () => {
  const rows = NAV_GROUPS.flatMap((g) => g.items.map((i) => ({ item: i, group: g.label })));
  const labels = new Set(rows.map((r) => r.item.label));
  /** 팰릿과 **같은 함수**로 매칭을 재현한다(팰릿은 `keywords.includes(q)` 한 줄). */
  const hits = (q: string) =>
    rows.filter((r) => menuSearchKeywords(r.item, r.group).includes(q.toLowerCase())).map((r) => r.item.menuKey);

  it("🔴 원장이 부르는 이름 '신입생'으로 신규생 관리가 나온다", () => {
    expect(hits("신입생")).toEqual(["newcomers"]);
    expect(hits("신입")).toEqual(["newcomers"]);
  });

  it("개칭 전 이름으로도 나온다(운영실 → 대시보드 · 학생 → 원생)", () => {
    expect(hits("운영실")).toEqual(["dashboard"]);
    expect(hits("학생목록")).toEqual(["students"]);
    expect(hits("학생상담")).toEqual(["consultations"]);
  });

  it("별칭이 다른 메뉴의 라벨과 겹치지 않는다 — 겹치면 엉뚱한 메뉴가 함께 선다", () => {
    const bad: string[] = [];
    for (const { item } of rows) {
      for (const a of item.aliases ?? []) {
        if (labels.has(a) && a !== item.label) bad.push(`${item.menuKey}: "${a}"는 다른 메뉴의 라벨`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("무의미한 별칭을 넣지 않는다 — 이미 라벨·그룹·영문키로 찾히는 말", () => {
    const useless: string[] = [];
    for (const { item, group } of rows) {
      const base = `${item.label} ${group} ${item.menuKey}`.toLowerCase();
      for (const a of item.aliases ?? []) {
        if (!a.trim()) useless.push(`${item.menuKey}: 빈 별칭`);
        else if (base.includes(a.toLowerCase())) useless.push(`${item.menuKey}: "${a}"는 이미 찾힌다`);
      }
      const list = item.aliases ?? [];
      expect(new Set(list).size, `${item.menuKey} 별칭 중복`).toBe(list.length);
    }
    expect(useless).toEqual([]);
  });
});

describe("isInternalPath — 복귀 경로는 앱 안 절대경로만", () => {
  it("앱 안 경로는 통과(쿼리·해시 포함)", () => {
    for (const p of ["/newcomers", "/students", "/students?tab=billing", "/students/1#memo"]) {
      expect(isInternalPath(p), p).toBe(true);
    }
  });

  it("🔴 프로토콜 상대 URL은 외부다 — `//`·`/\\`를 막는다", () => {
    for (const p of ["//evil.com", "//evil.com/students", "/\\evil.com"]) {
      expect(isInternalPath(p), p).toBe(false);
    }
  });

  it("절대 URL·스킴은 거절", () => {
    for (const p of ["https://evil.com", "http://a", "javascript:alert(1)", "/x://y"]) {
      expect(isInternalPath(p), p).toBe(false);
    }
  });

  it("상대경로·빈 값·제어문자는 거절", () => {
    for (const p of ["students", "", undefined, null, "/a\nb", "/a\tb"]) {
      expect(isInternalPath(p as string | undefined), String(p)).toBe(false);
    }
  });
});
