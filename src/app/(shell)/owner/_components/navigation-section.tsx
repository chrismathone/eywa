"use client";

import { useMemo, useState } from "react";

import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { HUB_GROUPS, SUPPORT_GROUPS, type HubDest, type HubGroup } from "@/lib/menu-hub";
import { TEACHER_MENU_LINKS } from "@/lib/teacher-menu-links";
import { isTeacherMenuEntranceOpen } from "@/lib/navigation";
import type { MenuKey } from "@/lib/permissions";
import {
  isLayoutHideLocked,
  moveInList,
  sortByMenuLayout,
  sparseLayoutRows,
  type MenuLayoutRow,
} from "@/features/owner/menu-layout";
import type { NavigationSettings } from "@/features/owner/settings-types";
import { SectionForm } from "./section-form";
import { AdminMenuEditor } from "./admin-menu-editor";
import { TeacherMenuEditor } from "./teacher-menu-editor";

/** 관리자뷰 편집 대상 = 사이드바·메뉴 판이 실제로 그리는 목록 그대로(권한으로 거르지 않은 원본). */
const ALL_GROUPS: HubGroup[] = [...HUB_GROUPS, ...SUPPORT_GROUPS];
/** 강사뷰 편집 대상 = '내 메뉴' 항목 표에서 입구가 열린 것(메뉴에서 뺀 캘린더 등은 강사 화면에도 없다). */
const TEACHER_LINKS = TEACHER_MENU_LINKS.filter((l) => isTeacherMenuEntranceOpen(l.menu));

type View = "admin" | "teacher";

/**
 * 탭 및 메뉴 구성 — 원장 2026-09-09 *"설정에서 탭 하나 추가해서 왼쪽 탭 설정이 있으면 좋겠네."* → 2026-09-22
 * *"왼쪽 탭 -> 탭 및 메뉴 구성으로 변경하고 '관리자뷰' '강사뷰' 메뉴를 따로 구성할 수 있게."*
 *
 * 두 목록은 **따로 저장**된다(`navigation.menus` / `navigation.teacherMenus`) — 한 폼이 둘을 함께 들고 있어서
 * 면을 오가며 고친 값이 한 번에 저장된다(한쪽을 저장하느라 다른 쪽이 지워지지 않는다).
 * 🔴 **권한이 아니다** — 여기서 켜도 권한이 없는 계정에겐 안 보이고, 꺼도 주소를 치면 열린다(안내 문구에도 그대로 적는다).
 * ⚠️ **권한으로 거르지 않은 원본 목록**을 보여준다 — 학원 전체 설정이라 지금 이 계정이 못 여는 화면도 정할 수 있어야 한다.
 */
export function NavigationSection({ initial, teacherOpen }: { initial: NavigationSettings; teacherOpen: readonly MenuKey[] }) {
  const [view, setView] = useState<View>("admin");
  // ── 관리자뷰 — 감춘 목적지(잠긴 목적지는 저장값이 뭐라 하든 안 들어온다) · 업무군별 순서 ──
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(initial.menus.filter((r) => r.hidden && !isLayoutHideLocked(r.href)).map((r) => r.href)),
  );
  const [order, setOrder] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(ALL_GROUPS.map((g) => [g.id, sortByMenuLayout(g.items, initial.menus).map((d) => d.href)])),
  );
  // ── 강사뷰 — 한 목록 ──
  const [tHidden, setTHidden] = useState<Set<string>>(
    () => new Set(initial.teacherMenus.filter((r) => r.hidden).map((r) => r.href)),
  );
  const [tOrder, setTOrder] = useState<string[]>(() =>
    sortByMenuLayout(TEACHER_LINKS, initial.teacherMenus).map((l) => l.href),
  );

  const destByHref = useMemo(() => {
    const m = new Map<string, HubDest>();
    for (const g of ALL_GROUPS) for (const d of g.items) m.set(d.href, d);
    return m;
  }, []);

  /** 저장 페이로드 = 두 목록 모두 **바뀐 줄만**(sparse) — 순서를 바꾼 목록은 그 목록 전체 순서(sparseLayoutRows 주석). */
  const payload = useMemo<NavigationSettings>(() => {
    const menus: MenuLayoutRow[] = ALL_GROUPS.flatMap((g) => {
      const codeOrder = g.items.map((d) => d.href);
      return sparseLayoutRows(order[g.id] ?? codeOrder, codeOrder, hidden);
    });
    const teacherMenus = sparseLayoutRows(tOrder, TEACHER_LINKS.map((l) => l.href), tHidden);
    return { menus, teacherMenus };
  }, [hidden, order, tHidden, tOrder]);

  const flip = (set: Set<string>, href: string) => {
    const next = new Set(set);
    if (next.has(href)) next.delete(href);
    else next.add(href);
    return next;
  };

  // ⚠️ 저장값엔 **지금 코드에 없는 주소**가 남아 있을 수 있다(옛 저장분) — 저장할 때 떨어져 나가므로 세지 않는다.
  const hiddenCount =
    view === "admin"
      ? [...hidden].filter((h) => destByHref.has(h)).length
      : [...tHidden].filter((h) => TEACHER_LINKS.some((l) => l.href === h)).length;

  return (
    <SectionForm section="navigation" payload={payload}>
      <div className="bg-card shadow-card space-y-3 rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-foreground text-sm font-bold">탭 및 메뉴 구성</h3>
          <ToolbarSegment label="구성할 화면">
            <ToolbarSegmentItem active={view === "admin"} onClick={() => setView("admin")}>
              관리자뷰
            </ToolbarSegmentItem>
            <ToolbarSegmentItem active={view === "teacher"} onClick={() => setView("teacher")}>
              강사뷰
            </ToolbarSegmentItem>
          </ToolbarSegment>
        </div>
        <p className="text-text-dim text-xs leading-relaxed">
          {view === "admin" ? (
            <>
              <b>관리자뷰</b> — 왼쪽 사이드바 · 첫 화면(메뉴) · 휴대폰 상단 메뉴가 <b>같은 목록</b>을 그립니다. 여기서 끈 항목은
              세 곳 모두에서 사라지고, 순서를 바꾸면 함께 바뀝니다.
            </>
          ) : (
            <>
              <b>강사뷰</b> — 강사 화면 오른쪽 위 <b>&lsquo;내 메뉴&rsquo;</b> 목록입니다. 선생님마다 담당 과목·권한에 따라 일부만
              보이고, 각 선생님의 홈(영어 전담은 영어 강사 시트, 그 외는 원스크린)은 늘 맨 위에 섭니다.
              <br />
              <b>강사 화면엔 사이드바가 없어 이 목록이 선생님들의 입구입니다</b> — 여기서 끈 메뉴는 권한이 있어도 선생님이
              찾아 들어갈 길이 없어집니다(특히 교재 요청·지출결의서는 이 목록이 유일한 입구입니다).
            </>
          )}
          <br />
          <b>이 설정은 권한이 아닙니다.</b> 여기서 켜도 그 메뉴에 권한이 없는 직원에게는 보이지 않고, 여기서 꺼도 주소를 직접
          입력하면 화면은 열립니다. 누가 무엇을 <i>할 수 있는지</i>는 <b>역할·권한</b> 면에서 정합니다. 학원(테넌트) 전체에 적용됩니다.
          <br />
          이 화면에서 지금 <span className="num">{hiddenCount}</span>개를 감추고 있습니다. 두 화면은 따로 저장되고, 아무것도 안
          건드리면 지금까지와 똑같이(전부 표시·기본 순서) 동작합니다.
        </p>
      </div>

      {view === "admin" ? (
        <AdminMenuEditor
          groups={ALL_GROUPS}
          order={order}
          hidden={hidden}
          destByHref={destByHref}
          onToggle={(href) => {
            if (isLayoutHideLocked(href)) return; // 자기잠금 방지 — 화면·스키마·적용 삼중 방어
            setHidden((prev) => flip(prev, href));
          }}
          onMove={(groupId, index, delta) =>
            setOrder((prev) => ({ ...prev, [groupId]: moveInList(prev[groupId] ?? [], index, delta) }))
          }
        />
      ) : (
        <TeacherMenuEditor
          links={TEACHER_LINKS}
          order={tOrder}
          hidden={tHidden}
          teacherOpen={teacherOpen}
          onToggle={(href) => setTHidden((prev) => flip(prev, href))}
          onMove={(index, delta) => setTOrder((prev) => moveInList(prev, index, delta))}
        />
      )}
    </SectionForm>
  );
}
