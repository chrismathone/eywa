import { MENU_KEYS, SYSTEM_ROLES, type MenuKey, type SystemRole } from "@/lib/permissions";
import { sortKeysDeep } from "@/lib/stable-json";
import type { PermissionsSettings } from "./settings-types";
import { effectivePayslipManagerIds } from "./payslip-permissions";
import { studentStatusManagerIds } from "./student-status-permissions";

/**
 * 역할·권한 설정의 표준 문자열 — "같은 저장값인가"를 가리는 기준(기준 token의 재료). 순수 함수.
 *
 * 역할·권한 섹션은 쓰는 곳이 여럿이다(역할·권한 면 · 화면마다 있는 '역할 설정' 대화상자 · 운영자 스크립트). 면은 연 시점의
 * 값 전체를 되돌려 보내므로, 그사이 다른 곳의 저장이 있었는지를 이 문자열로 견준다(다르면 저장하지 않는다 — actions.ts).
 *
 * 🔴 **저장된 줄을 그대로 견준다**(줄의 차례만 무시한다) — "적용해 보면 같은 표"라는 이유로 같다고 치지 않는다.
 *    같은 저장값을 앱과 DB가 다르게 읽는 자리가 있다: 같은 칸(메뉴·직급)의 줄이 둘이면 앱은 마지막 줄을(`resolveMatrix`),
 *    DB의 권한 함수(`auth_menu_access`)는 먼저 걸리는 한 줄을 쓴다. 기본값과 같은 줄도 DB에는 뜻이 있다(DB의 기본값 표에
 *    없는 메뉴는 줄이 없으면 '없음'이다). 표로 접어서 견주면 그런 저장이 "안 바뀜"으로 보여, 옛 화면의 저장이 그 줄들을
 *    조용히 지운다(적대 리뷰 2 C1). 모양이 달라졌으면 다른 저장으로 보고 거절하는 쪽이 안전하다.
 *  · 줄의 차례: 서로 다른 칸의 줄은 차례가 뜻이 없어 칸 순으로 놓는다. **같은 칸의 줄끼리는 저장된 차례를 지킨다**(위 이유).
 *  · 담당자 명단은 포함 여부만 뜻이 있어 정렬한다.
 * ⚠️ 저장되는 칸(역할별 · 개인별 메뉴 · 개인별 기능의 네 칸) 전부가 들어간다 — 한 칸이라도 빠지면 그 칸의 다른 저장이 조용히 되돌아간다.
 * ⚠️ 저장값은 스키마를 거치지 않고 읽힌다(resolve.ts) — 깨진 줄(null 등)에도 던지지 않고, 그 줄을 그대로 실어 다른 값으로 본다.
 */
export function permissionsCanonical(permissions: PermissionsSettings): string {
  return JSON.stringify({
    roles: rowsByCell(permissions?.overrides, ["menu", "role"]),
    people: rowsByCell(permissions?.userOverrides, ["userId", "menu"]),
    payslip: sortedIds(permissions?.specialAccess?.payslipViewerIds),
    payslipManagement: sortedIds(effectivePayslipManagerIds(permissions?.specialAccess)),
    leave: sortedIds(permissions?.specialAccess?.leaveAdjusterIds),
    split: sortedIds(permissions?.specialAccess?.classSplitterIds),
    dates: sortedIds(permissions?.specialAccess?.enrollmentDateEditorIds),
    tasks: sortedIds(permissions?.specialAccess?.staffTaskMonitorIds),
    vendors: sortedIds(permissions?.specialAccess?.vendorViewerIds),
    jj: sortedIds(permissions?.specialAccess?.jjReportManagerIds),
    beforeClass: sortedIds(permissions?.specialAccess?.beforeClassReportIds),
    withdrawal: sortedIds(permissions?.specialAccess?.withdrawalApproverIds),
    withdrawalDesk: sortedIds(permissions?.specialAccess?.withdrawalDeskIds),
    studentStatus: studentStatusManagerIds(permissions?.specialAccess) === undefined ? "legacy" : sortedIds(studentStatusManagerIds(permissions?.specialAccess)),
    scopes: rowsByCell(permissions?.specialAccess?.staffSubjectScopes, ["userId"]),
  });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value ?? null));

/** 줄을 칸 순으로 놓는다 — 같은 칸의 줄끼리는 저장된 차례 그대로(차례가 곧 "어느 줄이 적용되나"다). */
function rowsByCell(rows: unknown, cellKeys: readonly string[]): unknown[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row, index) => ({ row, index, cell: isRecord(row) ? cellKeys.map((key) => text(row[key])).join("|") : "" }))
    .sort((a, b) => (a.cell < b.cell ? -1 : a.cell > b.cell ? 1 : a.index - b.index))
    .map((entry) => sortKeysDeep(entry.row));
}

function sortedIds(ids: unknown): string[] {
  return Array.isArray(ids) ? ids.map(text).sort() : [];
}

/**
 * 같은 칸(메뉴·직급)이 **서로 다른 값으로** 두 번 이상 저장된 칸 — 화면에 알린다(역할·권한 면).
 * 면의 표는 마지막 줄을 보여 주고, 저장하면 표의 값 하나로 정리된다. 그 전까지는 읽는 곳에 따라 다른 값이 적용될 수 있다.
 * 면의 저장은 이런 줄을 만들지 않는다(저장 액션이 거절한다) — 손으로 넣은 값·스크립트에서만 생긴다.
 */
export function ambiguousRoleCells(overrides: unknown): { menu: MenuKey; role: SystemRole }[] {
  if (!Array.isArray(overrides)) return [];
  const seen = new Map<string, Set<string>>();
  for (const row of overrides) {
    if (!isRecord(row)) continue;
    const cell = `${text(row.menu)}|${text(row.role)}`;
    seen.set(cell, (seen.get(cell) ?? new Set()).add(text(row.access)));
  }
  return MENU_KEYS.flatMap((menu) =>
    SYSTEM_ROLES.filter((role) => (seen.get(`${menu}|${role}`)?.size ?? 0) > 1).map((role) => ({ menu, role })),
  );
}

/** 요청이 같은 칸(메뉴·직급)을 두 번 지정했는가 — 저장 액션이 거절한다(어느 줄이 적용될지 읽는 곳마다 달라진다). */
export function hasDuplicateRoleCells(overrides: readonly { menu: string; role: string }[]): boolean {
  const cells = overrides.map((row) => `${row.menu}|${row.role}`);
  return new Set(cells).size !== cells.length;
}
