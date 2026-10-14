"use client";

import type { MenuKey } from "@/lib/permissions";
import { teacherEditorSource } from "@/features/owner/navigation-editor-source";
import type { MenuLayoutRow, MenuGroupLayoutRow } from "@/features/owner/menu-layout";
import { useMemo } from "react";
import { AdminMenuEditor } from "./admin-menu-editor";

const NONE: readonly MenuKey[] = [];

/** 같은 폴더 편집기·배치 규칙을 사용하되 강사 입구 표와 저장 배열은 독립적이다. */
export function TeacherMenuEditor({ menus, groups, teacherOpen, teacherPersonal = NONE, onMenus, onGroups }: {
  menus: MenuLayoutRow[]; groups: MenuGroupLayoutRow[];
  teacherOpen: readonly MenuKey[];
  teacherPersonal?: readonly MenuKey[];
  onMenus: (rows: MenuLayoutRow[]) => void;
  onGroups: (rows: MenuGroupLayoutRow[]) => void;
}) {
  // '설정' 폴더(학원 설정 등의 내부 탭)와 선생님이 열 수 없는 메뉴는 세우지 않는다(원장 2026-10-14) — 규칙은 navigation-editor-source.ts.
  const source = useMemo(() => teacherEditorSource(teacherOpen, teacherPersonal), [teacherOpen, teacherPersonal]);
  return <AdminMenuEditor menus={menus} groups={groups} onMenus={onMenus} onGroups={onGroups}
    source={source}
    fixedContent={<><span className="text-text-dim text-xs font-bold">기본 사용</span><span className="text-sm font-semibold">선생님 홈 · 내 정보</span><span className="text-text-faint text-xs">홈은 숨기거나 탭에 담아도 맨 위에 표시됩니다. 만든 탭은 ‘내 메뉴’ 안의 폴더로 나타납니다. ‘설정’ 폴더는 설정을 맡은 선생님에게만 나타납니다. 선생님이 열 수 없는 메뉴는 여기 나오지 않습니다(역할·권한에서 열면 나타납니다).</span></>}
    menuHint={(d) => [
      // 목적지로 가른다 — 영상 제출 현황도 같은 menuKey(teacher_onescreen)라 menuKey로는 홈 안내가 두 줄에 붙는다.
      d.href === "/onescreen" ? "영어 전담이 아닌 선생님의 홈 · 해당 선생님에게 항상 맨 위 표시" : null,
      d.href === "/onescreen/video-homework" ? "내가 '영상 과제 있음'으로 낸 숙제만 보고 체크 · 한국어 화면에서만 표시" : null,
      d.menuKey === "ecs" ? "영어 반 담당·부담임에게만 표시 · 영어 전담 선생님의 홈" : null,
      d.menuKey === "mcs" ? "수학 반 담당에게만 표시" : null,
      teacherOpen.includes(d.menuKey) ? null : "개인별 메뉴 권한을 받은 선생님에게만 보입니다 · 역할·권한에서 변경",
    ].filter(Boolean).join(" · ") || undefined}
  />;
}
