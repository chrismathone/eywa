"use client";

import { useMemo } from "react";
import type { AccessMatrix, MenuKey } from "@/lib/permissions";
import type { PermissionNavigation } from "@/features/owner/permission-rows";
import { teacherToggleRows } from "@/features/owner/teacher-toggle-rows";
import { SettingsCard } from "./settings-card";

/**
 * '강사 내 메뉴 표시' — 강사 화면 '내 메뉴'에 세울 탭을 켜고 끈다. 아래 '역할별 메뉴 권한' 표의 **강사 칸과 같은 값**이다
 * (따로 저장하는 칸이 아니다). 끄면 그 탭이 '내 메뉴'에서 빠지고 강사는 그 화면에 들어갈 수 없다.
 *
 * 칸의 차례는 강사 '내 메뉴'가 실제로 서는 그대로다([teacherToggleRows](@/features/owner/teacher-toggle-rows) — 강사뷰 구성).
 * 칸 이름은 권한 이름(탭 이름) 한 줄 — 강사뷰 구성에서 **이름을 바꾼** 입구만 바꾼 이름을 아래에 적는다(원장 2026-11-05 "항상 탭 이름을 기본으로").
 * 접어 둘 수 있다(원장 2026-10-06) — 접혀 있어도 값은 그대로 살아 저장에 실린다.
 */
export function TeacherMenuToggles({ matrix, navigation, onToggle }: {
  matrix: AccessMatrix;
  navigation?: PermissionNavigation;
  onToggle: (menu: MenuKey, shown: boolean) => void;
}) {
  const rows = useMemo(() => teacherToggleRows(navigation), [navigation]);
  const shown = rows.filter((row) => matrix[row.menu].teacher !== "none").length;
  return (
    <SettingsCard
      title="강사 ‘내 메뉴’ 표시"
      collapsible
      summary={`${shown}개 표시`}
      description="강사 화면 ‘내 메뉴’에 보여 줄 탭을 고릅니다. 끄면 그 탭이 숨고 강사는 그 화면에 들어갈 수 없습니다."
    >
      <p className="text-text-dim text-xs leading-relaxed">
        모든 강사에게 함께 적용됩니다. <b>선생님 원스크린</b>은 강사 홈이라 끌 수 없습니다. 세부 권한(담당·읽기 등)은 아래 표의
        강사 칸에서 조정합니다 — 여기서 켜고 끄는 값과 같은 칸입니다. 권한은 그대로 두고 <b>순서만 바꾸거나 메뉴에서만 감추려면</b>{" "}
        <b>탭 및 메뉴 구성 → 강사뷰</b>에서 합니다. 메뉴에서 뺀 탭은 여기 나오지 않습니다.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {rows.map((row) => {
          const on = matrix[row.menu].teacher !== "none";
          const locked = row.menu === "teacher_onescreen";
          return (
            <label
              key={row.menu}
              className={`border-border flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                locked ? "opacity-60" : "hover:bg-bg-soft cursor-pointer"
              }`}
            >
              <input
                type="checkbox"
                checked={on}
                disabled={locked}
                onChange={(e) => onToggle(row.menu, e.target.checked)}
                className="accent-primary mt-0.5 size-4 shrink-0"
              />
              <span className="min-w-0">
                <span className="block truncate">
                  {row.label}
                  {locked ? " · 고정" : ""}
                </span>
                {row.covers.length > 0 ? (
                  <span className="text-text-dim block truncate text-xs" title={row.covers.join(" · ")}>{row.covers.join(" · ")}</span>
                ) : null}
                {row.hiddenInMenu ? <span className="text-text-dim block text-xs">메뉴 구성에서 감춤</span> : null}
              </span>
            </label>
          );
        })}
      </div>
    </SettingsCard>
  );
}
