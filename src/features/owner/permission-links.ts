/**
 * 역할·권한 표의 **연동된 권한** — 이 권한이 실제로 열리려면 함께 열려 있어야 하는 권한(서버 문이 둘 다 본다). 순수(Vitest).
 *
 * 원장 2026-11-12 *"연동된 권한이 있으면 '해당 권한도 함께 권한을 허용할까요?' 라고 물어보고 승인할것"* — 하위 권한 칸을 열 때
 * 필요한 권한이 그 역할(또는 그 사람)에서 모자라면 화면이 묻고, 승인하면 같이 연다 · 취소하면 아무것도 바꾸지 않는다
 * (혼자 열어 봐야 화면이 열리지 않는 '저장만 되는 칸'을 만들지 않는다 — 적대 리뷰).
 *
 * 🔴 **서버 문이 실제로 둘 다 보는 것만** 적는다(문을 바꾸면 이 표도 함께):
 *   · 강사별 퇴원율 → 퇴원관리(열림) = `withdrawals/server/teacher-churn.ts` `getTeacherChurnGate`
 *   · 셔틀 관리자 화면 → 셔틀(열림) = `shuttle/admin-access.ts` · `menu-hub.ts`의 `alsoNeeds: "shuttle"`
 *   · 원생목록 - 영어이름 → 영어 강사 시트(열림) = `students/server/english-name.ts`(편집 칸은 영어 강사 시트에만 있다)
 *   · 구글 시트 연동 → 시간표(열림) = '시트로 보내기'·'시트 반영'이 있는 시간표 화면의 문(`requireAccess("timetable")`) — 가져오기에만 쓰는
 *     수업목록 '전체'(`canManageTimetableImport`)는 묻지 않고 줄 설명에 적는다(보내기만 맡기는 역할에 반 일괄 관리를 강요하지 않게 · 재리뷰)
 *   · 홍보·마케팅 → 수납관리(보기 = 열림 · 저장 = 쓰기 — 저장은 원장·관리자 역할만이라 그 역할에만 쓰기를 요구) = `marketing-archive/server.ts`
 *     `archiveGate` — **행사 자료를 옮겨 둔 학원에서만**(다른 학원은 이 화면이 없어 수납관리를 열 까닭이 없다).
 * 🔴 **요구가 커질 때만 묻는다** — '없음'에서 열 때 · 필요한 수준이 올라갈 때. 좁히는 쪽('전체 → 담당')은 묻지 않는다(취소가 '그대로'라 닫지도 못했다).
 */
import { isPermissionLocked, isScopedForbiddenRole, type Access, type AccessMatrix, type MenuKey, type SystemRole } from "@/lib/permissions";
import { permissionAccessOptions } from "./permission-edit";

/** 필요한 수준 — 열림(읽기 이상) · 쓰기(전체·담당) · 전체. */
export type LinkNeed = "open" | "write" | "full";
export type LinkRequirement = { menu: MenuKey; need: LinkNeed };
/** `openOnly` = 화면이 **열리는 데** 필요한 것만 본다 — 역할 표는 칸이 '없음 → 전체 → 담당 → 읽기'로 돌아서 첫 걸음('전체')에 쓰기를 물으면 '읽기'까지 가지 못한다(재리뷰). */
export type LinkContext = { marketingArchive?: boolean; openOnly?: boolean };
const NEED_RANK: Record<LinkNeed, number> = { open: 1, write: 2, full: 3 };

const BASE: Partial<Record<MenuKey, readonly LinkRequirement[]>> = {
  withdrawals_churn: [{ menu: "withdrawals", need: "open" }],
  shuttle_admin: [{ menu: "shuttle", need: "open" }],
  student_english_name: [{ menu: "ecs", need: "open" }],
  sheet_sync: [{ menu: "timetable", need: "open" }],
};

const isWrite = (a: Access) => a === "full" || a === "scoped";

/** 이 권한을 `access`로 열 때 함께 필요한 권한들. `role`을 주면 그 역할이 실제로 할 수 있는 일만(홍보·마케팅 저장 = 원장·관리자). */
export function requirementsOf(menu: MenuKey, access: Access, ctx: LinkContext = {}, role?: SystemRole): LinkRequirement[] {
  if (access === "none") return [];
  if (menu === "marketing") {
    if (!ctx.marketingArchive) return [];
    const canSave = !role || role === "master" || role === "admin";
    return [{ menu: "billing", need: isWrite(access) && canSave && !ctx.openOnly ? "write" : "open" }];
  }
  return [...(BASE[menu] ?? [])];
}

export function satisfies(access: Access, need: LinkNeed): boolean {
  return need === "open" ? access !== "none" : need === "write" ? isWrite(access) : access === "full";
}

/** 함께 열 권한과 그 값. 값은 필요한 수준을 채우는 값 가운데 **가장 좁은** 것(읽기 → 담당 → 전체). */
export type LinkedGrant = { menu: MenuKey; access: Access; from: Access };

function narrowestGrant(menu: MenuKey, role: SystemRole, need: LinkNeed): Access | null {
  const order: readonly Access[] = need === "open" ? ["readonly", "scoped", "full"] : need === "write" ? ["scoped", "full"] : ["full"];
  return (
    order.find((v) => permissionAccessOptions(menu).includes(v) && !isPermissionLocked(menu, role, v) && !(v === "scoped" && isScopedForbiddenRole(role))) ??
    null
  );
}

/**
 * 칸을 `next`로 바꿀 때 함께 열자고 물을 권한. `accessOf` = 그 역할(또는 그 사람)의 지금 값.
 * 이미 채워져 있거나, 채울 수 있는 값이 없는(잠긴) 권한은 빼고 — 채울 수 없는 것이 하나라도 있으면 null(물을 수 없다 · 그대로 바꾼다).
 */
export function linkedGrants(
  menu: MenuKey,
  role: SystemRole,
  next: Access,
  accessOf: (menu: MenuKey) => Access,
  ctx: LinkContext = {},
  current: Access = "none",
): LinkedGrant[] | null {
  const out: LinkedGrant[] = [];
  const before = new Map(requirementsOf(menu, current, ctx, role).map((r) => [r.menu, NEED_RANK[r.need]]));
  for (const req of requirementsOf(menu, next, ctx, role)) {
    // 요구가 커질 때만 — 지금 값에서 이미 같은 수준을 요구하던 권한은 묻지 않는다(좁히기·같은 수준 돌리기).
    if ((before.get(req.menu) ?? 0) >= NEED_RANK[req.need]) continue;
    const from = accessOf(req.menu);
    if (satisfies(from, req.need)) continue;
    const access = narrowestGrant(req.menu, role, req.need);
    if (!access) return null;
    out.push({ menu: req.menu, access, from });
  }
  return out;
}

/** 표에서 **효과 없는 칸** — 열려 있는데 함께 필요한 권한이 모자라 화면이 열리지 않는 칸(반대 방향: 필요 권한을 닫았을 때 · 옛 저장값). */
export type LinkGap = { menu: MenuKey; role: SystemRole; missing: MenuKey[] };

export function linkGaps(matrix: AccessMatrix, roles: readonly SystemRole[], ctx: LinkContext = {}): LinkGap[] {
  const out: LinkGap[] = [];
  for (const menu of [...Object.keys(BASE), "marketing"] as MenuKey[]) {
    for (const role of roles) {
      const access = matrix[menu]?.[role];
      if (!access || access === "none") continue;
      // 화면이 **열리는가**만 본다(쓰기 부족은 저장만 막는다 — '열리지 않는 칸'이 아니다 · 재리뷰).
      const missing = requirementsOf(menu, access, ctx, role)
        .filter((r) => !satisfies(matrix[r.menu]?.[role] ?? "none", "open"))
        .map((r) => r.menu);
      if (missing.length > 0) out.push({ menu, role, missing });
    }
  }
  return out;
}
