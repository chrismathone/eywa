/**
 * 역할·권한 면의 **줄 구성** — 왼쪽 탭과 그 탭을 눌렀을 때 나오는 내부 메뉴의 차례 그대로. 순수(Vitest).
 *
 * 원장 2026-10-06: *"권한도 실제 좌측 탭과 탭 클릭시 나오는 내부메뉴에 맞게 권한 정렬해줄것. 이건 탭 및 메뉴구성과
 * 배선을 일치화 시켜서 구조를 철저히 맞출것."* 전에는 권한 표가 코드의 권한 키 차례(`MENU_KEYS`)로 서 있어서, 화면에서
 * 보는 메뉴 차례와 표의 줄 차례가 서로 달랐다.
 *
 * 🔴 차례·묶음·이름은 여기서 새로 적지 않는다 — 사이드바·메뉴 판·'탭 및 메뉴 구성' 편집기가 쓰는 **같은 해석**
 *    ([`configuredHubGroups`](@/lib/menu-hub))을 그대로 부른다. 원장이 탭을 옮기거나 이름을 바꾸면 이 표도 따라 바뀐다.
 * 🔴 줄의 단위는 **권한 키**다(목적지가 아니다) — 출석부의 세 화면은 권한이 하나라 줄도 하나다(수납·셔틀의 면은 2026-10-14부터 메뉴가 아닌 화면 안 탭이다).
 *    줄은 탭 이름 한 줄이고 함께 여는 화면을 나열하지 않는다(원장 2026-11-05) — `covers`는 메뉴 구성에서 이름을 바꾼 화면만 적는다(아래 `finish`).
 * 🔴 이 목록은 메뉴 구성에서 감춘 줄도 **지우지 않고** `hiddenInMenu` 표식을 단다 — 감추는 것은 입구뿐이고 권한은 그대로다
 *    (주소를 치면 열린다, [[#77]]). 화면에 세울지는 아래 `editablePermissionRowGroups`가 정한다(감춘 줄은 세우지 않는다).
 * 🔴 화면(표 · 개인별 메뉴 권한의 메뉴 고르기)은 `editablePermissionRowGroups`를 쓴다 — **탭 및 메뉴 구성에서 쓰고 있는 화면의 권한만** 세운다
 *    (원장 2026-10-06 *"탭 및 메뉴 구성에 사용중인 역할만 역할 권한에 넣을것"* · *"감춘 메뉴 줄도 표에서 빼"*). 어느 메뉴에도 없는 화면(④),
 *    구성에서 감춘 메뉴, 어느 역할의 칸도 바꿀 수 없는 역할 전용 화면 둘(선생님 원스크린 · 내 학습)은 세우지 않는다.
 * 강사 '내 메뉴' 표시 칸의 차례는 [`teacher-toggle-rows.ts`](./teacher-toggle-rows.ts)가 같은 방식으로 정한다.
 */
import { configuredHubGroups, HUB_GROUPS, hubDestinationForPath, INNER_TABS, SUPPORT_GROUPS, type HubDest } from "@/lib/menu-hub";
import { navItemByKey } from "@/lib/navigation";
import { isConnectedAppMenu, isRoleOnlyMenu, MENU_KEYS, MENU_LABEL, type MenuKey } from "@/lib/permissions";
import { SETTINGS_ROLE_HREF, SETTINGS_ROLE_KEYS, type SettingsRoleKey } from "@/lib/settings-role-catalog";
import { teacherNavigationSource } from "@/lib/teacher-navigation";
import { isMenuHiddenByLayout, type MenuGroupLayout, type MenuLayout } from "./menu-layout";
import { ROW_NOTE } from "./permission-row-notes";

/** 권한 표가 읽는 메뉴 구성 — 학원 설정 '탭 및 메뉴 구성'의 저장 값(관리자뷰 · 강사뷰). */
export type PermissionNavigation = {
  menus?: MenuLayout;
  groups?: MenuGroupLayout;
  teacherMenus?: MenuLayout;
  teacherGroups?: MenuGroupLayout;
};

export type PermissionRow = {
  menu: MenuKey;
  /** 권한 이름 — 화면과 감사 기록이 같은 말을 쓴다(`MENU_LABEL`). */
  label: string;
  /** 메뉴 구성에서 **이름을 바꾼** 화면의 바뀐 이름 — 그 밖엔 비운다(줄은 탭 이름 한 줄 · 원장 2026-11-05). */
  covers: string[];
  /** 메뉴 구성에서 이 권한의 입구를 전부 감췄다(권한은 그대로다). */
  hiddenInMenu: boolean;
  /** 메뉴 버튼 없이 다른 화면 **안에서** 쓰는 권한 — 그 화면의 줄 바로 아래에 들여 세운다. */
  inner: boolean;
  /** 다른 역할에 열기 전에 알아야 할 것 — 줄 아래 작은 글([`ROW_NOTE`](./permission-row-notes.ts)). 없으면 비운다. */
  note?: string;
};

export type PermissionRowGroup = {
  id: string;
  /** 왼쪽 탭 이름(원장이 바꿨으면 바꾼 이름). */
  label: string;
  /** 왼쪽 탭 자체를 감췄다. */
  hiddenInMenu: boolean;
  rows: PermissionRow[];
};

/** 강사 '내 메뉴'에만 입구가 있는 권한 · 어느 메뉴에도 입구가 없는 권한의 묶음 이름. */
export const TEACHER_ONLY_GROUP = { id: "teacher-menu", label: "강사 ‘내 메뉴’ 전용" } as const;
export const NO_MENU_GROUP = { id: "no-menu", label: "메뉴에 없는 화면" } as const;
/** 연결 앱(바깥 앱 링크) 권한 — 역할별 메뉴 표가 아니라 그 아래 '연결 앱 권한' 표에 선다(원장 2026-11-05 *"역할별 밑에 넣어줘"* · connected-app-permissions-card). */
export const CONNECTED_APP_GROUP = { id: "connected-apps", label: "연결 앱" } as const;

/**
 * 메뉴가 아니라 **사이드바 맨 아래 줄의 단추**로 여는 도구의 권한(학원 비서 — 폰은 위쪽 줄 · 어느 화면에서나 Ctrl+J).
 * 탭 묶음 뒤(도움말 다음)에 도구마다 제 줄로 선다 — 사이드바에서 그 단추가 서는 차례 그대로다(원장 2026-11-09 *"역할에 '비서 추가' 권한은 없네"*).
 * 🔴 새 도구 단추를 만들면 여기에 키를 더하고 그 단추의 판정을 그 권한으로 할 것(코드에 역할로 박지 않는다).
 */
export const SIDEBAR_TOOL_KEYS = ["assistant"] as const satisfies readonly MenuKey[];
export const SIDEBAR_TOOL_GROUP_PREFIX = "sidebar-tool:";

/**
 * 메뉴 버튼이 없는 권한이 속한 화면 — **다른 화면 안의 버튼·드롭다운으로만 닿는 것**만 손으로 적는다. 설정 권한은 그 설정의
 * 주소가 속한 메뉴에서 저절로 정해진다(`SETTINGS_ROLE_HREF`).
 * ⚠️ 새 권한 키가 어디에도 속하지 않으면 '메뉴에 없는 화면'으로 떨어지고, 가드(`permission-rows.test.ts`)가 그 목록을 잠근다.
 */
const INNER_PARENT: Partial<Record<MenuKey, MenuKey>> = {
  seat_attendance: "attendance", // 출석부 안 강사 드롭다운의 랩실·JJ실
  sheet_sync: "timetable", // 시간표의 '시트 반영' · '시트에서 가져오기'
  integrations: "students", // 원생목록의 '지금 동기화'(콜&상담의 '보내기'도 이 권한)
  student_english_name: "students", // 원생목록 - 영어이름: 영문 이름 한 칸 편집
  teacher_view: "staff",
  // 셔틀 관리자 화면(원장 2026-11-10) — 학부모 관리 현황(학원운영 도구 버튼) · 탑승 학생 시간표 · 가까운 노선 찾기 · 실시간 위치(셔틀 화면 위 탭).
  // 버튼이 있어도 셔틀 줄 바로 아래(└)에 세운다 — 셔틀 권한 위 조건이라 셔틀과 함께 읽혀야 한다(아래 `rowsAt`이 버튼 자리에 줄을 세우지 않는다).
  shuttle_admin: "shuttle",
};

/** `listed` = '이 권한으로 열리는 메뉴'에 이름을 적는 목적지(원장만 들어가는 면은 적지 않는다 — 감춤 판정에는 센다). */
type PlacedDest = { label: string; renamed: boolean; hidden: boolean; listed: boolean };
type Placed = { row: PermissionRow; dests: PlacedDest[] };

function finish(placed: Placed): PermissionRow {
  const listed = placed.dests.filter((d) => d.listed);
  // 줄은 **탭 이름 한 줄**이 기본이다 — 이 권한이 함께 여는 화면(출석부의 오늘 출결·출결 모드 · 셔틀의 면 · 수납의 탭 · 학원 설정의 면 …)을
  // 나열하지 않는다(원장 2026-11-05 *"문구 특별한 일 없으면 나누지마. 하위로 따로 빼는것만 빼도록"* · *"항상 탭 이름을 기본으로 가져가도록해"*).
  // 따로 권한이 있는 화면만 제 줄(└ 랩실·JJ실 출석부 등)로 선다. 예외('특별한 일') = 메뉴 구성에서 **이름을 바꾼** 화면 — 표의 이름(권한 이름)과
  // 메뉴에 보이는 이름이 달라 무엇인지 못 알아보므로 바꾼 이름만 적는다.
  const covers = renamedCovers(listed, placed.row.label);
  return { ...placed.row, covers, hiddenInMenu: placed.dests.length > 0 && placed.dests.every((d) => d.hidden) };
}

const newRow = (menu: MenuKey, inner = false): PermissionRow => ({
  menu, label: MENU_LABEL[menu], covers: [], hiddenInMenu: false, inner, ...(ROW_NOTE[menu] ? { note: ROW_NOTE[menu] } : {}),
});
/** 메뉴 구성에서 **이름을 바꾼** 목적지인가 — 권한 표 · 강사 '내 메뉴' 표시 칸이 같은 판정으로 `covers`를 채운다(원장 2026-11-05 "항상 탭 이름을 기본으로"). */
export const isRenamedDest = (d: Pick<HubDest, "label" | "originalLabel">) => !!d.originalLabel && d.originalLabel !== d.label;
const renamed = isRenamedDest;
/**
 * 줄(칸) 아래 적을 이름 — 이름을 바꾼 목적지의 바뀐 이름만. 바꾼 이름이 줄 이름(권한 이름)과 같으면 적지 않고("원생목록 / 원생목록"),
 * 겹치면 한 번만 적는다("출석 · 출석") — 리뷰 2026-11-05. 권한 표 · 강사 '내 메뉴' 표시 칸이 같이 쓴다.
 */
export function renamedCovers(dests: readonly { label: string; renamed: boolean }[], rowLabel: string): string[] {
  return [...new Set(dests.filter((d) => d.renamed && d.label !== rowLabel).map((d) => d.label))];
}

/**
 * 권한 표의 묶음과 줄 — **모든 권한 키가 정확히 한 번** 선다.
 *  ① 왼쪽 탭(관리자뷰 구성) 차례대로, 탭 안에서는 내부 메뉴 차례대로. 줄은 그 권한의 대표 화면이 있는 자리에 선다.
 *  ② 메뉴 버튼이 없는 권한은 그 권한을 쓰는 화면의 줄 아래.
 *  ③ 강사 '내 메뉴'에만 입구가 있는 권한(강사뷰 구성 차례).
 *  ④ 어느 메뉴에도 입구가 없는 화면.
 */
export function permissionRowGroups(navigation?: PermissionNavigation, options?: { generic?: boolean }): PermissionRowGroup[] {
  const source = [...HUB_GROUPS, ...SUPPORT_GROUPS];
  const menus = navigation?.menus;
  const visible = (d: HubDest) => !d.genericOnly || options?.generic === true;
  const sourceDests = source.flatMap((g) => g.items.filter(visible));

  // 권한마다의 대표 화면 — 그 메뉴 **자신의 주소**(예: 학원 설정 = /owner)에 목적지가 있으면 거기, 없으면 그 권한을 쓰는 첫 목적지.
  // 메뉴 자신의 주소에 선 목적지가 다른 권한을 쓰는 경우(학원 설정의 첫 면 = 프로필·브랜드 설정)에도 그 메뉴의 줄은 그 자리에 선다.
  const used = new Set(sourceDests.map((d) => d.menuKey));
  const primary = new Map<MenuKey, string>();
  for (const menu of used) {
    const own = navItemByKey(menu)?.href;
    primary.set(menu, own && sourceDests.some((d) => d.href === own) ? own : sourceDests.find((d) => d.menuKey === menu)!.href);
  }
  // 한 자리에 두 줄이 서면 그 주소의 주인(메뉴 자신)이 먼저다.
  // `INNER_PARENT`에 속할 화면을 적은 권한은 메뉴 버튼이 있어도 그 화면 줄 아래에 들여 세운다(셔틀 관리자 화면 — 2026-11-10).
  const rowsAt = (d: HubDest): MenuKey[] =>
    [...used].filter((menu) => primary.get(menu) === d.href && !INNER_PARENT[menu]).sort((a, b) => Number(b !== d.menuKey) - Number(a !== d.menuKey));

  const configured = configuredHubGroups(source, menus, navigation?.groups, true);
  const placed = new Map<MenuKey, Placed>();
  const groups: { id: string; label: string; hidden: boolean; keys: MenuKey[] }[] = [];
  for (const g of configured) {
    const keys: MenuKey[] = [];
    // 화면 위 탭 이름은 그 묶음의 버튼을 다 적은 **뒤에** 붙인다 — 메뉴 판·화면 탭 차례(수납 · 교재 · 지출 → 환불 …)와 같게(리뷰 2026-10-15).
    const tabsAfter: { menu: MenuKey; dest: PlacedDest }[] = [];
    for (const d of g.items) {
      if (!visible(d)) continue;
      const at = placed.get(d.menuKey) ?? { row: newRow(d.menuKey), dests: [] };
      // 원장만 들어가는 면은 "이 권한으로 열리는 메뉴"로 적지 않는다 — 다른 역할에게 이 줄을 열어도 그 면은 안 열린다.
      const hidden = g.hidden === true || isMenuHiddenByLayout(d.href, menus);
      at.dests.push({ label: d.label, renamed: renamed(d), hidden, listed: !d.masterOnly });
      // 같은 권한으로 열리는 그 화면 위 탭(수납의 환불 요청서·회차 확정 · 셔틀의 오늘 등하원 …)도 이 줄의 목적지로 센다 — 이름은 적지 않지만(원장 2026-11-05)
      // '메뉴 구성에서 다 감췄나' 판정에 든다. 감춤은 부모를 따른다(탭은 부모 화면 안에 있다). 따로 권한이 있는 탭은 제 줄이 선다.
      for (const tab of INNER_TABS.find((x) => x.parent === d.href)?.items ?? []) {
        if (tab.menuKey === d.menuKey && visible(tab)) tabsAfter.push({ menu: d.menuKey, dest: { label: tab.label, renamed: false, hidden, listed: !tab.masterOnly } });
      }
      placed.set(d.menuKey, at);
      keys.push(...rowsAt(d));
    }
    for (const t of tabsAfter) placed.get(t.menu)?.dests.push(t.dest);
    groups.push({ id: g.id, label: g.label, hidden: g.hidden === true, keys });
  }

  // ② 메뉴 버튼이 없는 권한 → 그 권한을 쓰는 화면의 줄 아래(권한 키 차례).
  const allDests = configured.flatMap((g) => g.items.filter(visible));
  const parentOf = (menu: MenuKey): MenuKey | undefined => {
    if (INNER_PARENT[menu]) return INNER_PARENT[menu];
    if (!(SETTINGS_ROLE_KEYS as readonly string[]).includes(menu)) return undefined;
    return hubDestinationForPath(SETTINGS_ROLE_HREF[menu as SettingsRoleKey], allDests)?.menuKey;
  };
  const innerOf = new Map<MenuKey, MenuKey[]>();
  for (const menu of MENU_KEYS) {
    if (placed.has(menu) && !INNER_PARENT[menu]) continue;
    const parent = parentOf(menu);
    if (!parent || parent === menu || !placed.has(parent)) continue;
    innerOf.set(parent, [...(innerOf.get(parent) ?? []), menu]);
  }
  // 실제로 줄이 선 권한만 — 버튼이 있어도 들여 세우는 권한(INNER_PARENT)은 부모가 없으면 '메뉴에 없는 화면'으로 떨어져 사라지지 않는다.
  const taken = new Set<MenuKey>([...groups.flatMap((g) => g.keys), ...[...innerOf.values()].flat()]);

  const out: PermissionRowGroup[] = groups
    .map((g) => ({
      id: g.id,
      label: g.label,
      hiddenInMenu: g.hidden,
      rows: g.keys.flatMap((menu) => [finish(placed.get(menu)!), ...(innerOf.get(menu) ?? []).map((inner) => newRow(inner, true))]),
    }))
    .filter((g) => g.rows.length > 0);

  // ②′ 사이드바 맨 아래 줄 단추(학원 비서) — 탭 묶음 뒤에 도구마다 제 줄. 메뉴 구성이 감추거나 옮기는 자리가 아니라 늘 선다.
  for (const menu of SIDEBAR_TOOL_KEYS) {
    if (taken.has(menu)) continue;
    out.push({ id: `${SIDEBAR_TOOL_GROUP_PREFIX}${menu}`, label: MENU_LABEL[menu], hiddenInMenu: false, rows: [newRow(menu)] });
    taken.add(menu);
  }

  // ③ 강사 '내 메뉴'에만 입구가 있는 권한 — 강사뷰 구성 차례.
  const teacherMenus = navigation?.teacherMenus;
  const teacherOnly = new Map<MenuKey, Placed>();
  for (const g of configuredHubGroups(teacherNavigationSource(), teacherMenus, navigation?.teacherGroups, true)) {
    for (const d of g.items) {
      if (taken.has(d.menuKey)) continue;
      const at = teacherOnly.get(d.menuKey) ?? { row: newRow(d.menuKey), dests: [] };
      at.dests.push({ label: d.label, renamed: renamed(d), hidden: g.hidden === true || isMenuHiddenByLayout(d.href, teacherMenus), listed: true });
      teacherOnly.set(d.menuKey, at);
    }
  }
  if (teacherOnly.size > 0) out.push({ ...TEACHER_ONLY_GROUP, hiddenInMenu: false, rows: [...teacherOnly.values()].map(finish) });
  for (const menu of teacherOnly.keys()) taken.add(menu);

  // ④ 어느 메뉴에도 입구가 없는 화면(메뉴에서 뺀 화면 · 다른 역할 전용 화면).
  const rest = MENU_KEYS.filter((menu) => !taken.has(menu) && !isConnectedAppMenu(menu));
  if (rest.length > 0) out.push({ ...NO_MENU_GROUP, hiddenInMenu: false, rows: rest.map((menu) => newRow(menu)) });
  // ⑤ 연결 앱 — 메뉴(화면)가 아니라 바깥 앱 링크라 따로 묶는다. 화면에서는 '연결 앱 권한' 표에만 선다(아래 editable에서 뺀다).
  const apps = MENU_KEYS.filter((menu) => !taken.has(menu) && isConnectedAppMenu(menu));
  if (apps.length > 0) out.push({ ...CONNECTED_APP_GROUP, hiddenInMenu: false, rows: apps.map((menu) => newRow(menu)) });
  return out;
}

/**
 * **화면에 세우는** 묶음과 줄 — 탭 및 메뉴 구성(관리자뷰 · 강사뷰)에서 **쓰고 있는** 화면의 권한만. 위 목록에서 셋을 뺀다:
 *  · '메뉴에 없는 화면' 묶음(④) — 메뉴에서 뺀 화면 · 옮겨진 옛 화면.
 *  · 구성에서 **감춘** 메뉴(원장 2026-10-06 *"감춘 메뉴 줄도 표에서 빼"*) — 그 화면 안에서 쓰는 권한 줄(inner)도 함께 뺀다.
 *    관리자뷰에서 감췄어도 강사 '내 메뉴'에 보이는 메뉴는 쓰고 있는 것이라 남긴다(표식 `hiddenInMenu`는 그대로 — 화면이 '관리자뷰에서 감춤'으로 적는다).
 *    설정 권한은 관리자뷰만 따른다 — 강사뷰의 '설정' 묶음은 맡은 사람에게만 서는 자리라 '쓰는 메뉴'로 치지 않는다.
 *  · 역할 전용 화면(선생님 원스크린 · 내 학습) — 강사 · 학생의 홈 화면이라 어느 역할의 칸도 바꿀 수 없다.
 * 권한 자체와 저장된 값은 그대로다(표가 적용되는 값 전체를 들고 저장한다 — 줄을 안 세울 뿐이다).
 * ⚠️ 감춘 메뉴는 입구만 없을 뿐 주소로는 열린다 — 그 권한을 고치려면 메뉴 구성에서 다시 보이게 한 뒤 이 표에서 고친다.
 * ⚠️ 새 권한 키는 메뉴에 세우거나 `INNER_PARENT`에 속할 화면을 적어야 표에 선다(가드 `permission-rows.test.ts`가 ④의 목록을 잠근다).
 */
export function editablePermissionRowGroups(navigation?: PermissionNavigation, options?: { generic?: boolean }): PermissionRowGroup[] {
  const teacherMenus = navigation?.teacherMenus;
  const isSetting = (menu: MenuKey) => (SETTINGS_ROLE_KEYS as readonly string[]).includes(menu);
  const usedByTeacher = new Set(
    configuredHubGroups(teacherNavigationSource(), teacherMenus, navigation?.teacherGroups, true).flatMap((g) =>
      g.hidden === true ? [] : g.items.filter((d) => !isSetting(d.menuKey) && !isMenuHiddenByLayout(d.href, teacherMenus)).map((d) => d.menuKey),
    ),
  );
  const shown = (row: PermissionRow) => !isRoleOnlyMenu(row.menu) && (!row.hiddenInMenu || usedByTeacher.has(row.menu));
  return permissionRowGroups(navigation, options)
    .filter((group) => group.id !== NO_MENU_GROUP.id && group.id !== CONNECTED_APP_GROUP.id)
    .map((group) => {
      let parentShown = false;
      // 다른 화면 안에서 쓰는 권한(inner)은 바로 위 화면의 줄을 따라간다.
      return { ...group, rows: group.rows.filter((row) => (row.inner ? parentShown : (parentShown = shown(row)))) };
    })
    .filter((group) => group.rows.length > 0);
}
