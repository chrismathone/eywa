import { describe, expect, it } from "vitest";

import {
  isLayoutHideLocked,
  isMenuHiddenByLayout,
  sortByMenuLayout,
  type MenuLayout,
} from "./menu-layout";

const d = (href: string) => ({ href });

describe("왼쪽 탭 설정 — 비어 있으면 지금과 똑같아야 한다", () => {
  it("저장값이 없으면 아무것도 감추지 않는다", () => {
    expect(isMenuHiddenByLayout("/students", undefined)).toBe(false);
    expect(isMenuHiddenByLayout("/students", [])).toBe(false);
  });

  it("저장값이 없으면 순서도 코드 순서 그대로다", () => {
    const items = [d("/a"), d("/b"), d("/c")];
    expect(sortByMenuLayout(items, undefined).map((x) => x.href)).toEqual(["/a", "/b", "/c"]);
    expect(sortByMenuLayout(items, []).map((x) => x.href)).toEqual(["/a", "/b", "/c"]);
  });

  it("감춤만 저장돼 있고 순서 값이 없으면 순서는 안 흔들린다", () => {
    const layout: MenuLayout = [{ href: "/b", hidden: true }];
    expect(sortByMenuLayout([d("/a"), d("/b")], layout).map((x) => x.href)).toEqual(["/a", "/b"]);
  });
});

describe("감추기", () => {
  it("hidden: true인 목적지만 감춘다", () => {
    const layout: MenuLayout = [{ href: "/retention", hidden: true }, { href: "/students", order: 0 }];
    expect(isMenuHiddenByLayout("/retention", layout)).toBe(true);
    expect(isMenuHiddenByLayout("/students", layout)).toBe(false);
  });

  it("🔴 학원 설정 자신은 감출 수 없다 — 저장값이 그렇게 적혀 있어도(자기잠금 방지)", () => {
    expect(isLayoutHideLocked("/owner")).toBe(true);
    expect(isMenuHiddenByLayout("/owner", [{ href: "/owner", hidden: true }])).toBe(false);
  });

  it("면(?tab=) 주소는 부모와 다른 목적지다 — 하나를 감춰도 다른 면은 그대로", () => {
    const layout: MenuLayout = [{ href: "/billing?tab=expenses", hidden: true }];
    expect(isMenuHiddenByLayout("/billing?tab=expenses", layout)).toBe(true);
    expect(isMenuHiddenByLayout("/billing", layout)).toBe(false);
  });
});

describe("순서", () => {
  it("저장된 순서대로 선다", () => {
    const layout: MenuLayout = [
      { href: "/c", order: 0 },
      { href: "/a", order: 1 },
      { href: "/b", order: 2 },
    ];
    expect(sortByMenuLayout([d("/a"), d("/b"), d("/c")], layout).map((x) => x.href)).toEqual([
      "/c",
      "/a",
      "/b",
    ]);
  });

  /**
   * 🔴 이 규칙이 이 기능의 존재 이유와 직결된다 — 원장이 순서를 정한 **뒤에** 새 메뉴가 생기면
   *    그 메뉴엔 저장값이 없다. 뒤에 붙이면 적어도 **보이기는 한다**(찾을 수 없던 문제의 재발 방지).
   */
  it("저장값이 없는 새 메뉴는 맨 뒤에, 저희끼리는 코드 순서로 선다", () => {
    const layout: MenuLayout = [{ href: "/b", order: 0 }];
    const out = sortByMenuLayout([d("/a"), d("/b"), d("/new1"), d("/new2")], layout);
    expect(out.map((x) => x.href)).toEqual(["/b", "/a", "/new1", "/new2"]);
  });

  it("순서 값이 같으면 코드 순서를 지킨다(안정 정렬)", () => {
    const layout: MenuLayout = [
      { href: "/a", order: 5 },
      { href: "/b", order: 5 },
    ];
    expect(sortByMenuLayout([d("/a"), d("/b")], layout).map((x) => x.href)).toEqual(["/a", "/b"]);
  });

  it("목록에 없는 주소가 저장돼 있어도 무시한다(라우트가 바뀐 뒤의 옛 저장분)", () => {
    const layout: MenuLayout = [{ href: "/gone", order: 0 }, { href: "/b", order: 1 }];
    expect(sortByMenuLayout([d("/a"), d("/b")], layout).map((x) => x.href)).toEqual(["/b", "/a"]);
  });

  it("입력 배열을 변형하지 않는다", () => {
    const items = [d("/a"), d("/b")];
    sortByMenuLayout(items, [{ href: "/b", order: 0 }]);
    expect(items.map((x) => x.href)).toEqual(["/a", "/b"]);
  });
});
