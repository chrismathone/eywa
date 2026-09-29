import { HUB_GROUPS, SUPPORT_GROUPS } from "@/lib/menu-hub";
import { TEACHER_NAV_GROUPS, TEACHER_DEFAULT_GROUP } from "@/lib/teacher-navigation";
import { normalizeGroupRows, normalizeMenuRows } from "./menu-layout";

/** 읽기/동시 저장 비교의 같은 정규화: 폐기한 메뉴와 그룹이 다음 저장을 막지 않게 한다. */
export function normalizeNavigationSettings(raw: unknown) {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const source = [...HUB_GROUPS, ...SUPPORT_GROUPS];
  const knownHrefs = new Set(source.flatMap((g) => g.items.map((d) => d.href)));
  const knownGroups = new Set(source.map((g) => g.id));
  const groups = normalizeGroupRows(value.groups).filter((g) => knownGroups.has(g.id) || (g.id.startsWith("custom-") && !!g.label));
  const groupIds = new Set([...knownGroups, ...groups.map((g) => g.id)]);
  const menus = normalizeMenuRows(value.menus).filter((r) => knownHrefs.has(r.href)).map((row) => {
    if (!row.groupId || groupIds.has(row.groupId)) return row;
    const rest = { ...row };
    delete rest.groupId;
    return rest;
  });
  const teacherGroups = normalizeGroupRows(value.teacherGroups).filter((g) => g.id === TEACHER_DEFAULT_GROUP || (g.id.startsWith("custom-") && !!g.label));
  const teacherGroupIds = new Set([TEACHER_DEFAULT_GROUP, ...teacherGroups.map((g) => g.id)]);
  const teacherHrefs = new Set(TEACHER_NAV_GROUPS.flatMap((g) => g.items.map((d) => d.href)));
  const teacherMenus = normalizeMenuRows(value.teacherMenus).filter((r) => teacherHrefs.has(r.href)).map((row) => {
    if (!row.groupId || teacherGroupIds.has(row.groupId)) return row;
    const rest = { ...row };
    delete rest.groupId;
    return rest;
  });
  return { menus, groups, teacherMenus, teacherGroups };
}

/** 속성 순서는 위 정규화가 결정한다. 구버전의 필드 누락도 빈 기본값으로 비교한다. */
export function navigationRevision(raw: unknown): string {
  return JSON.stringify(normalizeNavigationSettings(raw));
}
