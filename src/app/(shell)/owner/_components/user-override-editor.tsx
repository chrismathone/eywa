"use client";

import { useId, useState } from "react";
import { PERMISSION_ACCESS_CYCLE, permissionAccessOptions } from "@/features/owner/permission-edit";
import type { PermissionRowGroup } from "@/features/owner/permission-rows";
import {
  applyUserOverrides,
  isConnectedAppMenu,
  isOnOffMenu,
  isPermissionLocked,
  isRoleOnlyMenu,
  isScopedForbiddenRole,
  MENU_LABEL,
  SCOPED_FORBIDDEN_MESSAGE,
  storedScopedAccess,
  type Access,
  type AccessMatrix,
  type MenuKey,
  type SystemRole,
  type UserPermissionOverride,
} from "@/lib/permissions";
import { SettingsCard } from "./settings-card";
import type { PendingLinkedGrant } from "./linked-grant-dialog";
import { linkedGrants, type LinkContext } from "@/features/owner/permission-links";
import { ACCESS_LABEL, ROLE_LABEL } from "./permission-ui";

type StaffOption = { id: string; name: string; role: string };
/** 한 학원이 저장할 수 있는 개인별 권한 줄 수(저장 스키마의 상한과 같다). */
const MAX_ROWS = 80;

/**
 * 개인별 메뉴 권한 — 역할 표 아래에서 **한 사람에게만** 메뉴를 열거나 닫는다(원장 2026-10-06
 * *"원장이 개인 부여 권한 지급할 수 있도록 역할 하단에 개인 권한 지급기"* · *"x 버튼으로 제거 가능하게"*).
 * 역할별 권한보다 먼저 적용된다. 이 면은 원장만 들어오고 저장도 원장만 한다(저장 액션이 다시 확인한다).
 *
 * 🔴 화면에 안 보이는 줄(`hiddenUserIds`)은 손대지 않고 그대로 둔다 — 지우거나 바꾸는 요청은 저장이 거절한다.
 * ⚠️ 메뉴 고르기의 차례·묶음은 위 표와 같다(`groups` — 왼쪽 탭과 그 내부 메뉴 순).
 */
export function UserOverrideEditor({ overrides, roleMatrix, hiddenUserIds, staffOptions, nameOf, groups, onChange, linkCtx, onLinkedAsk, linkBusy }: {
  /** 저장되는 줄 전부(안 보이는 줄 포함). */
  overrides: readonly UserPermissionOverride[];
  /** 위 역할 표(편집 중인 값) — 옛 '담당' 줄이 실제로 어떤 값으로 적용되는지 적는 데 쓴다(그 사람 역할 칸이 '없음'이면 '없음'). */
  roleMatrix: AccessMatrix;
  hiddenUserIds: readonly string[];
  staffOptions: readonly StaffOption[];
  nameOf: (userId: string) => string;
  groups: readonly PermissionRowGroup[];
  onChange: (next: (rows: UserPermissionOverride[]) => UserPermissionOverride[]) => void;
  /** 연동된 권한(원장 2026-11-12) — 하위 권한을 줄 때 그 사람에게 필요한 권한이 모자라면 묻는다(역할 표와 같은 판정 · `permission-links.ts`). */
  linkCtx?: LinkContext;
  onLinkedAsk?: (p: PendingLinkedGrant) => void;
  /** 묻는 중 · 막 닫은 창 뒤 누름을 받지 않는다(창 단추 두 번 누름이 추가·삭제를 누르지 않게). */
  linkBusy?: () => boolean;
}) {
  const [pickedUser, setPickedUser] = useState("");
  const [wantedMenu, setWantedMenu] = useState<MenuKey>("staff");
  const [pickedAccess, setPickedAccess] = useState<Access>("full");
  const idPrefix = useId();
  const hidden = new Set(hiddenUserIds);
  const visible = overrides.filter((row) => !hidden.has(row.userId));
  const staff = staffOptions.filter((s) => !hidden.has(s.id));
  const roleOf = (userId: string) => staffOptions.find((s) => s.id === userId)?.role as SystemRole | undefined;
  const pickedRole = roleOf(pickedUser);
  // 고를 수 있는 메뉴 — 역할 전용 화면은 빼고(위 표에도 없다 — 여기서 한 번 더 거른다), 그 사람 역할에서 칸 전체가 잠긴 메뉴(강사의 대시보드·학원 비서 · 원장·관리자가 아닌 사람의 셔틀 관리자 화면 등)는 줄 수 없다(권한 표의 잠금과 같다 — isPermissionLocked).
  const menuGroups = groups
    .map((group) => ({ ...group, rows: group.rows.filter((row) => !isRoleOnlyMenu(row.menu) && !(pickedRole && isPermissionLocked(row.menu, pickedRole, "full") && isPermissionLocked(row.menu, pickedRole, "none"))) }))
    .filter((group) => group.rows.length > 0);
  const selectable = menuGroups.flatMap((group) => group.rows.map((row) => row.menu));
  // 직원을 바꿔 골라 둔 메뉴가 목록에서 빠지면(강사 + 대시보드) 화면에 보이는 첫 메뉴로 맞춘다 — 보이는 값과 추가되는 값이 같아야 한다.
  const pickedMenu: MenuKey = selectable.includes(wantedMenu) ? wantedMenu : (selectable[0] ?? wantedMenu);
  const full = overrides.length >= MAX_ROWS && !overrides.some((r) => r.userId === pickedUser && r.menu === pickedMenu);
  const blocked = !pickedUser || !pickedRole || full || isPermissionLocked(pickedMenu, pickedRole, pickedAccess);
  // 강사보다 낮은 직급(열람·아르바이트)에게 '담당'을 고르면 단추만 꺼 두지 않고 까닭을 바로 아래에 알린다(원장 2026-11-05 "알림메시지도 배선").
  const scopedForbidden = !!pickedRole && pickedAccess === "scoped" && isScopedForbiddenRole(pickedRole);

  /**
   * 한 사람의 칸을 바꾼다 — 그 사람(역할 + 개인 줄)에게 함께 필요한 권한이 모자라면 먼저 묻고, 승인하면 그 권한의 개인 줄도 함께 넣는다.
   * 취소하면 아무것도 바꾸지 않는다(혼자 줘 봐야 화면이 열리지 않는다).
   */
  function setWithLinks(userId: string, menu: MenuKey, access: Access, write: (rows: UserPermissionOverride[]) => UserPermissionOverride[]) {
    if (linkBusy?.()) return;
    const role = roleOf(userId);
    // 그 사람의 실제 값 = 적용하는 쪽과 같은 함수(옛 '담당' 줄을 '읽기'·'없음'으로 내리는 규칙 포함 · 재리뷰).
    const applied = role ? applyUserOverrides(roleMatrix, userId, role, overrides) : null;
    const accessOf = (m: MenuKey): Access => (applied && role ? applied[m][role] : "none");
    const grants = role && onLinkedAsk ? linkedGrants(menu, role, access, accessOf, linkCtx, accessOf(menu)) : null;
    if (!grants || grants.length === 0) return onChange(write);
    onLinkedAsk!({
      menu,
      who: nameOf(userId),
      grants,
      onConfirm: () =>
        onChange((rows) =>
          grants.reduce(
            (acc, g) => [...acc.filter((r) => r.userId !== userId || r.menu !== g.menu), { userId, menu: g.menu, access: g.access }],
            write(rows),
          ),
        ),
    });
  }

  function add() {
    if (blocked) return;
    setWithLinks(pickedUser, pickedMenu, pickedAccess, (rows) => [
      ...rows.filter((r) => r.userId !== pickedUser || r.menu !== pickedMenu),
      { userId: pickedUser, menu: pickedMenu, access: pickedAccess },
    ]);
  }

  const select = "border-border bg-card rounded border px-2 py-1.5 text-xs";
  return (
    <SettingsCard
      title={`개인별 메뉴 권한 ${visible.length}건`}
      collapsible
      defaultOpen
      description="한 사람에게만 메뉴를 열거나 닫습니다. 역할별 권한보다 먼저 적용되고, 같은 사람의 같은 메뉴는 새 값으로 바뀝니다."
    >
      {staff.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="직원 선택" value={pickedUser} onChange={(e) => setPickedUser(e.target.value)} className={select}>
            <option value="">직원 선택</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select aria-label="메뉴 선택" value={pickedMenu} onChange={(e) => { const menu = e.target.value as MenuKey; setWantedMenu(menu); if (!permissionAccessOptions(menu).includes(pickedAccess)) setPickedAccess(permissionAccessOptions(menu).includes("readonly") ? "readonly" : "full"); }} className={select}>
            {menuGroups.map((group) => (
              <optgroup key={group.id} label={group.label}>
                {group.rows.map((row) => <option key={row.menu} value={row.menu}>{row.label}</option>)}
              </optgroup>
            ))}
          </select>
          <select aria-label="접근 수준" value={pickedAccess} onChange={(e) => setPickedAccess(e.target.value as Access)} className={select}>
            {permissionAccessOptions(pickedMenu).map((access) => <option key={access} value={access}>{ACCESS_LABEL[access]}</option>)}
          </select>
          <button type="button" onClick={add} disabled={blocked} className="border-border bg-card rounded border px-3 py-1.5 text-xs font-bold disabled:opacity-40">
            추가·변경
          </button>
          {full ? <span className="text-text-dim text-xs">개인별 권한은 {MAX_ROWS}건까지 둘 수 있습니다.</span> : null}
        </div>
      ) : null}
      {staff.length > 0 && scopedForbidden ? (
        <p role="alert" className="text-danger mt-2 text-xs leading-relaxed">
          {ROLE_LABEL[pickedRole!]}: {SCOPED_FORBIDDEN_MESSAGE}
        </p>
      ) : null}
      {/* 직원 평가는 개인에게 주면 수준과 관계없이 평가자 실명이 보이고(강사 제외 — class-review `getReviewPrivileges`),
          쓰기 수준(전체·담당)이면 문항 편집 · 최종 총평도 열린다(그 둘은 쓰기 게이트를 먼저 지난다). 역할 표의 같은 수준과
          다르게 동작하므로 고르는 자리에서 알린다. */}
      {staff.length > 0 && pickedMenu === "class_review" && pickedAccess !== "none" && pickedRole !== "teacher" ? (
        <p className="text-text-dim mt-2 text-xs">
          {MENU_LABEL.class_review}를 개인에게 주면 수준과 관계없이 평가자 실명이 보이고, 전체·담당으로 주면 평가 문항 편집 · 최종 총평 작성까지 열립니다.
        </p>
      ) : null}
      {visible.length > 0 ? (
        <div className={`overflow-x-auto ${staff.length > 0 ? "mt-3" : ""}`}>
          <table aria-label="개인별 메뉴 권한" className="w-full min-w-[32rem] table-fixed text-left text-xs">
            <colgroup>
              <col className="w-36" />
              <col className="w-20" />
              <col />
              <col className="w-24" />
              <col className="w-12" />
            </colgroup>
            <thead className="bg-bg-soft text-text-dim border-border border-b">
              <tr>{["직원", "역할", "메뉴", "권한", "삭제"].map((label) => <th key={label} scope="col" className="px-2 py-2 font-medium">{label}</th>)}</tr>
            </thead>
            <tbody>
          {visible.map((row) => {
            const name = nameOf(row.userId);
            const role = roleOf(row.userId);
            // 역할이 바뀌어 강사보다 낮은 직급이 된 사람의 옛 '담당' 줄 — '읽기'(그 사람 역할 칸이 '없음'이면 '없음')로 내려 적용된다
            // (storedScopedAccess — 적용하는 쪽과 같은 함수로 적는다). 말없이 두지 않는다.
            // 까닭은 보이는 글로 적고 고르기 칸과 묶는다(title만 두면 터치·키보드·화면낭독기에서 안 보인다 — 리뷰 2026-11-05).
            // 연결 앱·학원 비서 칸은 전체·없음만 쓴다(isOnOffMenu) — 손으로 넣은 '읽기'·'담당' 줄은 적용 단계가 건너뛴다(역할 표 값 그대로 · applyUserOverrides).
            // 그 값 그대로 보이고 까닭을 적는다('담당 → 읽기로 적용' 안내는 붙이지 않는다 — 연결 앱은 '읽기'도 잠겨 있다 · 재리뷰 2026-11-06).
            const inertApp = isOnOffMenu(row.menu) && row.access !== "full" && row.access !== "none";
            const demoted = !inertApp && !!role && row.access === "scoped" && row.menu !== "teacher_view" && isScopedForbiddenRole(role);
            const applied = demoted ? storedScopedAccess(row.menu, role!, row.access, roleMatrix[row.menu][role!]) : row.access;
            const noteId = `${idPrefix}-${row.userId}-${row.menu}`;
            return (
              <tr key={`${row.userId}-${row.menu}`} className="border-border border-b last:border-b-0">
                <th scope="row" className="text-foreground break-words px-2 py-2 font-medium">{name}</th>
                <td className="text-text-dim px-2 py-2">{role ? ROLE_LABEL[role] : "—"}</td>
                <td className="text-text-dim break-words px-2 py-2">{MENU_LABEL[row.menu]}</td>
                <td className="px-2 py-2">
                <select
                  aria-label={`${name} ${MENU_LABEL[row.menu]} 권한`}
                  aria-describedby={demoted || inertApp ? noteId : undefined}
                  value={row.access}
                  onChange={(e) => {
                    const access = e.target.value as Access;
                    setWithLinks(row.userId, row.menu, access, (rows) => rows.map((r) => (r === row ? { ...r, access } : r)));
                  }}
                  className="border-border bg-card min-h-8 w-full rounded border px-2 py-1 text-xs"
                >
                  {/* 그 사람의 역할에서 잠긴 수준은 고를 수 없다(지금 값은 남긴다 — 사라지면 다른 값으로 보인다 · 그 메뉴의 선택지에 없는 값이어도). */}
                  {PERMISSION_ACCESS_CYCLE.filter((access) => access === row.access || permissionAccessOptions(row.menu).includes(access)).filter((access) => access === row.access || !role || !isPermissionLocked(row.menu, role, access)).map((access) => (
                    <option key={access} value={access}>{ACCESS_LABEL[access]}</option>
                  ))}
                </select>
                {demoted ? (
                  <span id={noteId} className="text-danger mt-1 block text-xs leading-relaxed">
                    {applied === "none" ? "‘없음’으로 적용됩니다(역할 표의 이 칸이 ‘없음’)" : "‘읽기’로 적용됩니다"} — {ROLE_LABEL[role!]}에는 ‘담당’을 줄 수 없습니다(맡은 반이 없어 ‘전체’처럼 열림). 다른 수준을 고르세요.
                  </span>
                ) : null}
                {inertApp ? (
                  <span id={noteId} className="text-danger mt-1 block text-xs leading-relaxed">
                    적용되지 않습니다(역할 표의 이 칸 값이 그대로 적용) — {isConnectedAppMenu(row.menu) ? "연결 앱은" : "이 권한은"} ‘전체’·‘없음’만 씁니다. 다른 수준을 고르세요.
                  </span>
                ) : null}
                </td>
                <td className="px-2 py-2">
                <button
                  type="button"
                  aria-label={`${name} ${MENU_LABEL[row.menu]} 권한 제거`}
                  title="제거"
                  onClick={() => !linkBusy?.() && onChange((rows) => rows.filter((r) => r !== row))}
                  className="text-text-dim hover:bg-bg-soft hover:text-danger flex size-8 items-center justify-center rounded text-sm leading-none"
                >
                  ×
                </button>
                </td>
              </tr>
            );
          })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={`text-text-dim text-xs ${staff.length > 0 ? "mt-3" : ""}`}>지정된 개인별 권한이 없습니다.</p>
      )}
    </SettingsCard>
  );
}
