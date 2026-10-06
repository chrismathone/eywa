"use client";

import { useState } from "react";
import { PERMISSION_ACCESS_CYCLE as CYCLE } from "@/features/owner/permission-edit";
import type { PermissionRowGroup } from "@/features/owner/permission-rows";
import { isPermissionLocked, isRoleOnlyMenu, MENU_LABEL, type Access, type MenuKey, type SystemRole, type UserPermissionOverride } from "@/lib/permissions";
import { SettingsCard } from "./settings-card";
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
export function UserOverrideEditor({ overrides, hiddenUserIds, staffOptions, nameOf, groups, onChange }: {
  /** 저장되는 줄 전부(안 보이는 줄 포함). */
  overrides: readonly UserPermissionOverride[];
  hiddenUserIds: readonly string[];
  staffOptions: readonly StaffOption[];
  nameOf: (userId: string) => string;
  groups: readonly PermissionRowGroup[];
  onChange: (next: (rows: UserPermissionOverride[]) => UserPermissionOverride[]) => void;
}) {
  const [pickedUser, setPickedUser] = useState("");
  const [wantedMenu, setWantedMenu] = useState<MenuKey>("staff");
  const [pickedAccess, setPickedAccess] = useState<Access>("full");
  const hidden = new Set(hiddenUserIds);
  const visible = overrides.filter((row) => !hidden.has(row.userId));
  const staff = staffOptions.filter((s) => !hidden.has(s.id));
  const roleOf = (userId: string) => staffOptions.find((s) => s.id === userId)?.role as SystemRole | undefined;
  const pickedRole = roleOf(pickedUser);
  // 고를 수 있는 메뉴 — 역할 전용 화면은 빼고(위 표에도 없다 — 여기서 한 번 더 거른다), 강사에게는 대시보드를 줄 수 없다(권한 표의 잠금과 같다).
  const menuGroups = groups
    .map((group) => ({ ...group, rows: group.rows.filter((row) => !isRoleOnlyMenu(row.menu) && !(row.menu === "dashboard" && pickedRole === "teacher")) }))
    .filter((group) => group.rows.length > 0);
  const selectable = menuGroups.flatMap((group) => group.rows.map((row) => row.menu));
  // 직원을 바꿔 골라 둔 메뉴가 목록에서 빠지면(강사 + 대시보드) 화면에 보이는 첫 메뉴로 맞춘다 — 보이는 값과 추가되는 값이 같아야 한다.
  const pickedMenu: MenuKey = selectable.includes(wantedMenu) ? wantedMenu : (selectable[0] ?? wantedMenu);
  const full = overrides.length >= MAX_ROWS && !overrides.some((r) => r.userId === pickedUser && r.menu === pickedMenu);
  const blocked = !pickedUser || !pickedRole || full || isPermissionLocked(pickedMenu, pickedRole, pickedAccess);

  function add() {
    if (blocked) return;
    onChange((rows) => [...rows.filter((r) => r.userId !== pickedUser || r.menu !== pickedMenu), { userId: pickedUser, menu: pickedMenu, access: pickedAccess }]);
  }

  const select = "border-border bg-card rounded border px-2 py-1.5 text-xs";
  return (
    <SettingsCard
      title={`개인별 메뉴 권한 ${visible.length}건`}
      description="한 사람에게만 메뉴를 열거나 닫습니다. 역할별 권한보다 먼저 적용되고, 같은 사람의 같은 메뉴는 새 값으로 바뀝니다."
    >
      {staff.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="직원 선택" value={pickedUser} onChange={(e) => setPickedUser(e.target.value)} className={select}>
            <option value="">직원 선택</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select aria-label="메뉴 선택" value={pickedMenu} onChange={(e) => setWantedMenu(e.target.value as MenuKey)} className={select}>
            {menuGroups.map((group) => (
              <optgroup key={group.id} label={group.label}>
                {group.rows.map((row) => <option key={row.menu} value={row.menu}>{row.label}</option>)}
              </optgroup>
            ))}
          </select>
          <select aria-label="접근 수준" value={pickedAccess} onChange={(e) => setPickedAccess(e.target.value as Access)} className={select}>
            {CYCLE.map((access) => <option key={access} value={access}>{ACCESS_LABEL[access]}</option>)}
          </select>
          <button type="button" onClick={add} disabled={blocked} className="border-border bg-card rounded border px-3 py-1.5 text-xs font-bold disabled:opacity-40">
            추가·변경
          </button>
          {full ? <span className="text-text-dim text-xs">개인별 권한은 {MAX_ROWS}건까지 둘 수 있습니다.</span> : null}
        </div>
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
        <ul className={`space-y-1 ${staff.length > 0 ? "mt-3" : ""}`}>
          {visible.map((row) => {
            const name = nameOf(row.userId);
            const role = roleOf(row.userId);
            return (
              <li key={`${row.userId}-${row.menu}`} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-foreground min-w-20 font-medium">{name}</span>
                {role ? <span className="text-text-faint">{ROLE_LABEL[role]}</span> : null}
                <span className="text-text-dim">{MENU_LABEL[row.menu]}</span>
                <select
                  aria-label={`${name} ${MENU_LABEL[row.menu]} 권한`}
                  value={row.access}
                  onChange={(e) => onChange((rows) => rows.map((r) => (r === row ? { ...r, access: e.target.value as Access } : r)))}
                  className="border-border bg-card rounded border px-2 py-1 text-xs"
                >
                  {/* 그 사람의 역할에서 잠긴 수준은 고를 수 없다(지금 값은 남긴다 — 사라지면 다른 값으로 보인다). */}
                  {CYCLE.filter((access) => access === row.access || !role || !isPermissionLocked(row.menu, role, access)).map((access) => (
                    <option key={access} value={access}>{ACCESS_LABEL[access]}</option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label={`${name} ${MENU_LABEL[row.menu]} 권한 제거`}
                  title="제거"
                  onClick={() => onChange((rows) => rows.filter((r) => r !== row))}
                  className="text-text-dim hover:bg-bg-soft hover:text-danger rounded px-1.5 py-0.5 text-sm leading-none"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={`text-text-dim text-xs ${staff.length > 0 ? "mt-3" : ""}`}>지정된 개인별 권한이 없습니다.</p>
      )}
    </SettingsCard>
  );
}
