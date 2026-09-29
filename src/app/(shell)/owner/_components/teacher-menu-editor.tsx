"use client";

import type { MenuKey } from "@/lib/permissions";
import { TEACHER_NAV_GROUPS } from "@/lib/teacher-navigation";
import type { MenuLayoutRow, MenuGroupLayoutRow } from "@/features/owner/menu-layout";
import { AdminMenuEditor } from "./admin-menu-editor";

/** 같은 폴더 편집기·배치 규칙을 사용하되 강사 입구 표와 저장 배열은 독립적이다. */
export function TeacherMenuEditor({ menus, groups, teacherOpen, onMenus, onGroups }: {
  menus: MenuLayoutRow[]; groups: MenuGroupLayoutRow[];
  teacherOpen: readonly MenuKey[];
  onMenus: (rows: MenuLayoutRow[]) => void;
  onGroups: (rows: MenuGroupLayoutRow[]) => void;
}) {
  return <AdminMenuEditor menus={menus} groups={groups} onMenus={onMenus} onGroups={onGroups}
    source={TEACHER_NAV_GROUPS}
    fixedContent={<><span className="text-text-dim text-xs font-bold">기본 사용</span><span className="text-sm font-semibold">선생님 홈 · 내 정보</span><span className="text-text-faint text-xs">홈은 숨기거나 탭에 담아도 맨 위에 표시됩니다. 만든 탭은 ‘내 메뉴’ 안의 폴더로 나타납니다.</span></>}
    menuHint={(d) => [
      d.menuKey === "teacher_onescreen" ? "영어 전담이 아닌 선생님의 홈 · 해당 선생님에게 항상 맨 위 표시" : null,
      d.menuKey === "ecs" ? "영어 반 담당·부담임에게만 표시 · 영어 전담 선생님의 홈" : null,
      d.menuKey === "mcs" ? "수학 반 담당에게만 표시" : null,
      teacherOpen.includes(d.menuKey) ? null : "강사 권한이 꺼져 있어 지금은 안 보입니다 · 역할·권한에서 변경",
    ].filter(Boolean).join(" · ") || undefined}
  />;
}
