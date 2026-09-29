/**
 * 사이드바(왼쪽 탭) 표시 설정 — **보기만 정한다. 권한이 아니다.**
 *
 * 원장 2026-09-09: *"설정에서 탭 하나 추가해서 왼쪽 탭 설정이 있으면 좋겠네."* 앞선 말이 발단이다 —
 * *"'신입생 관리' 탭을 만들었는데 찾을 수가 없네. 자동 배정이 안되어있네. 자동 배정하던가 기능을 추가해주던가."*
 * 2026-09-07 버튼형 전환 뒤 왼쪽 맨 위엔 **메뉴가 한 줄도 없다**(업무군 + 방문 횟수 순 '자주 방문한 메뉴'뿐).
 * 그래서 새로 만든 탭은 업무군 **안**에 묻히고, 한 번도 안 연 메뉴는 '자주 방문한 메뉴'에 오를 길이
 * 구조적으로 없다 — 새 탭이 스스로 자리를 얻지 못한다. 그 자리를 **원장이 직접 정하게** 하는 것이 이 설정이다.
 *
 * 🔴 **권한을 대체하지 않는다.** 여기서 켜도 권한이 없으면 안 보이고(권한이 먼저 거른다), 여기서 꺼도
 *    주소를 직접 치면 열린다(그건 권한·게이트의 일이다, [[#77]]). 즉 이 설정은 **입구를 보이고 감추는 것**뿐이다.
 * 🔴 판정 단위는 **목적지(href)** 다 — menuKey가 아니다. 한 업무군 안에 같은 menuKey를 가진 버튼이 여럿
 *    있어서다(수납 7면·출석부 3면·셔틀 4면·설정 11면 전부 부모 menuKey가 하나다). menuKey로 감추면
 *    '오늘 출결'을 끄려다 출석부 전체가 사라진다.
 * 🔴 저장은 **sparse**다 — 바뀐 줄만 담고, 비어 있으면 **지금과 글자 그대로 같게** 동작한다(전부 표시·코드 순서).
 *    설정이 비었을 때 화면이 달라지면 그건 이 기능의 실패다.
 *
 * ⚠️ 저장 그릇이 배열인 이유는 permissions.overrides와 같다 — resolve.ts의 deepMerge가 base 키만 순회해서,
 *    빈 객체(`{}`) 기본값 아래 record를 두면 새 키가 통째로 탈락한다. 배열은 "있으면 통째 교체"라 살아남는다.
 */

/**
 * 감출 수 없는 목적지 — 여기를 감추면 **이 설정으로 돌아올 길이 사라진다**(자기잠금).
 * 역할·권한이 원장의 owner/admin 접근을 못 잠그게 막아 둔 것(`isPermissionLocked`)과 같은 결이다.
 * 설정 업무군은 자식이 하나도 없으면 아예 서지 않으므로, 이 한 줄이 그 업무군을 항상 세운다.
 */
export const LAYOUT_LOCKED_HREFS: ReadonlySet<string> = new Set(["/dashboard", "/support", "/owner", "/owner?tab=navigation"]);

import type { AywaIconName } from "@/components/icons/aywa-icons";
import { hasMenuGlyph } from "@/components/icons/menu-glyph";

export const FIXED_GROUP_IDS: ReadonlySet<string> = new Set(["dashboard", "owner", "support"]);
export const MAX_NAV_GROUPS = 30;
export type MenuGroupLayoutRow = {
  id: string;
  label?: string;
  icon?: AywaIconName;
  order?: number;
  hidden?: boolean;
};
export type MenuGroupLayout = readonly MenuGroupLayoutRow[];

/** 목적지 한 줄의 보기 설정(sparse) — 안 담긴 목적지는 "기본 그대로"라는 뜻이다. */
export type MenuLayoutRow = {
  /** 목적지 주소. 업무군을 통틀어 유일하다(menu-hub.test.ts가 중복을 잠근다). */
  href: string;
  /** 사이드바·메뉴 판에서 감춘다(라우트·권한은 그대로). */
  hidden?: boolean;
  /** 업무군 안 표시 순서(작을수록 앞). 없으면 코드 순서 뒤에 붙는다. */
  order?: number;
  label?: string;
  icon?: AywaIconName;
  groupId?: string;
};

export type MenuLayout = readonly MenuLayoutRow[];

/** 원본 목적지의 권한/주소는 건드리지 않고 이름과 그림만 바꾼다. */
export function applyMenuPresentation<T extends { href: string; label: string; icon: AywaIconName }>(item: T, layout?: MenuLayout): T {
  if (isFixedDestination(item.href)) return item;
  const row = layout?.find((r) => r.href === item.href);
  if (!row) return item;
  return { ...item, label: row.label?.trim() || item.label, icon: row.icon && hasMenuGlyph(row.icon) ? row.icon : item.icon };
}

/** 고정 그룹에 속한 메뉴는 다른 탭으로 옮기거나 개명할 수 없다. */
export function isFixedDestination(href: string): boolean {
  return href === "/dashboard" || href === "/support" || href === "/owner" || href.startsWith("/owner?");
}

/** DB의 옛/손상된 행도 소비처에 안전한 형태로 전달한다. 새 코드의 목적지 목록 검사는 해석기가 한다. */
export function normalizeMenuRows(raw: unknown): MenuLayoutRow[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.slice(0, 200).flatMap((r) => {
    if (!r || typeof r.href !== "string" || !r.href.startsWith("/") || r.href.startsWith("//") || seen.has(r.href)) return [];
    seen.add(r.href);
    const fixed = isFixedDestination(r.href);
    return [{ href: r.href,
      ...(r.hidden === true && !isLayoutHideLocked(r.href) ? { hidden: true } : {}),
      ...(Number.isInteger(r.order) && r.order >= 0 && r.order < 200 ? { order: r.order as number } : {}),
      ...(!fixed && typeof r.label === "string" && r.label.trim() ? { label: r.label.trim().slice(0, 40) } : {}),
      ...(!fixed && typeof r.icon === "string" && hasMenuGlyph(r.icon) ? { icon: r.icon as AywaIconName } : {}),
      ...(!fixed && typeof r.groupId === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(r.groupId) && !FIXED_GROUP_IDS.has(r.groupId) ? { groupId: r.groupId } : {}),
    }];
  });
}

export function normalizeGroupRows(raw: unknown): MenuGroupLayoutRow[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.slice(0, MAX_NAV_GROUPS).flatMap((r) => {
    if (!r || typeof r.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(r.id) || FIXED_GROUP_IDS.has(r.id) || seen.has(r.id)) return [];
    seen.add(r.id);
    return [{ id: r.id,
      ...(typeof r.label === "string" && r.label.trim() ? { label: r.label.trim().slice(0, 24) } : {}),
      ...(typeof r.icon === "string" && hasMenuGlyph(r.icon) ? { icon: r.icon as AywaIconName } : {}),
      ...(Number.isInteger(r.order) && r.order >= 0 && r.order < MAX_NAV_GROUPS ? { order: r.order as number } : {}),
      ...(r.hidden === true ? { hidden: true } : {}),
    }];
  });
}

/** 이 목적지는 감출 수 없다(설정으로 돌아올 길). 화면·스키마·적용 세 곳이 같은 함수를 본다. */
export function isLayoutHideLocked(href: string): boolean {
  return LAYOUT_LOCKED_HREFS.has(href);
}

/**
 * 이 목적지를 감췄나. 잠긴 목적지는 저장값이 뭐라 하든 **항상 보인다**
 * (DB를 직접 고쳐도 잠기지 않게 — 스키마 거부와 이중 방어).
 */
export function isMenuHiddenByLayout(href: string, layout: MenuLayout | undefined): boolean {
  if (!layout || layout.length === 0) return false;
  if (isLayoutHideLocked(href)) return false;
  return layout.some((r) => r.href === href && r.hidden === true);
}

/**
 * 업무군 안 정렬 — **저장된 순서가 있는 것부터 그 순서대로, 없는 것은 코드 순서로 뒤에.**
 *
 * ⚠️ "없는 것은 뒤로"가 핵심이다 — 원장이 한 번 순서를 정한 뒤 **새 메뉴가 생기면** 그 메뉴는 저장값이
 *    없다. 코드 위치에 끼워 넣으면 정해 둔 순서 사이에 낯선 줄이 끼고, 뒤에 붙이면 "새로 생긴 게 맨 아래"라
 *    예측 가능하다(그리고 어쨌든 **보이기는 한다** — 이 기능이 애초에 풀려던 문제가 그거다).
 * ⚠️ 안정 정렬이라 순서가 같은 값끼리는 코드 순서를 지킨다.
 */
export function sortByMenuLayout<T extends { href: string }>(
  items: readonly T[],
  layout: MenuLayout | undefined,
): T[] {
  if (!layout || layout.length === 0) return [...items];
  const orderOf = new Map<string, number>();
  for (const r of layout) if (typeof r.order === "number") orderOf.set(r.href, r.order);
  if (orderOf.size === 0) return [...items];
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const ao = orderOf.get(a.item.href);
      const bo = orderOf.get(b.item.href);
      if (ao !== undefined && bo !== undefined) return ao - bo || a.i - b.i;
      if (ao !== undefined) return -1;
      if (bo !== undefined) return 1;
      return a.i - b.i;
    })
    .map((x) => x.item);
}

/**
 * 강사뷰 '내 메뉴'에 **강사뷰 구성**(`navigation.teacherMenus`)을 적용한다 — 원장 2026-09-22: *"'관리자뷰' '강사뷰'
 * 메뉴를 따로 구성할 수 있게"*. 관리자뷰 구성(`navigation.menus`)과 **따로 저장**되고 규약은 같다(sparse · 목적지 단위 ·
 * 권한 아님 — 권한이 먼저 거르고, 여기서 꺼도 주소를 치면 열린다).
 *
 * 🔴 **그 강사의 홈은 감춰도 남고, 늘 맨 위다**(원장 2026-08-07 "영어 전담 = ECS, 그 외 = 원스크린"). 설정은
 *    학원 전체에 한 벌이라 선생님마다 다른 홈을 표현할 수 없다 — 홈을 감추면 영어 선생님이 ECS로 돌아갈 입구를 잃는다.
 * ⚠️ 비어 있으면 받은 순서 그대로 + 홈만 맨 위(이 기능 이전과 글자 그대로 같다).
 */
export function applyTeacherMenuLayout<T extends { href: string }>(
  items: readonly T[],
  layout: MenuLayout | undefined,
  home: string | null,
): T[] {
  const kept = items.filter((i) => i.href === home || !isMenuHiddenByLayout(i.href, layout));
  const sorted = sortByMenuLayout(kept, layout);
  if (!home) return sorted;
  return [...sorted.filter((i) => i.href === home), ...sorted.filter((i) => i.href !== home)];
}

/** 목록 안에서 한 칸 옮긴 새 배열(범위 밖이면 그대로). 두 편집기 공용. */
export function moveInList(list: readonly string[], index: number, delta: number): string[] {
  const to = index + delta;
  if (to < 0 || to >= list.length) return [...list];
  const next = [...list];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

/**
 * 저장할 줄(sparse) — **바뀐 줄만**. 순서를 한 번이라도 바꾼 목록은 그 목록 전체의 순서를 적는다(일부만 적으면
 * 나머지가 어디 끼는지가 코드 순서에 따라 흔들려, 메뉴가 하나 늘 때마다 정해 둔 순서가 조용히 달라진다).
 */
export function sparseLayoutRows(
  current: readonly string[],
  codeOrder: readonly string[],
  hidden: ReadonlySet<string>,
): MenuLayoutRow[] {
  const reordered = current.join("|") !== codeOrder.join("|");
  const rows: MenuLayoutRow[] = [];
  current.forEach((href, i) => {
    const isHidden = hidden.has(href);
    if (!isHidden && !reordered) return;
    rows.push({ href, ...(isHidden ? { hidden: true } : {}), ...(reordered ? { order: i } : {}) });
  });
  return rows;
}
