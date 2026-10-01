"use client";

import { useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { hubDestinationForPath } from "@/lib/menu-hub";
import { navItemByKey } from "@/lib/navigation";
import { PageHeaderLead } from "@/components/page-header-lead";
import { useMenuPresentation, useNavigationSettings } from "./navigation-context";
import { menuGroupLabelFor, pageHeaderEyebrow } from "./page-eyebrow";

/** 메뉴 자체의 제목만 개명한다. 학생 이름·문서 제목·기간처럼 실제 내용인 제목은 그대로 둔다. */
function useMenuPageTitle(title: string): string {
  const pathname = usePathname();
  const search = useSearchParams();
  const { menus, source } = useNavigationSettings();
  const present = useMenuPresentation();
  const href = `${pathname}?${search}`;
  const original = hubDestinationForPath(href, source.flatMap((g) => g.items));
  if (!original || original.href.split("?")[0] !== pathname || !menus.some((r) => r.href === original.href && r.label)) return title;
  if (title !== original.label && title !== navItemByKey(original.menuKey)?.label) return title;
  return present(href)?.label ?? title;
}

export function MenuPageTitle({ title }: { title: string }) {
  return useMenuPageTitle(title);
}

/**
 * PageHeader 앞머리(`eyebrow - 제목`) — 제목은 학원 설정의 메뉴 이름으로, 앞부분은 **사이드바에서 이 메뉴가 속한 그룹 이름**으로
 * ([`page-eyebrow.ts`](./page-eyebrow.ts), 원장 2026-10-01 *"상담.재원 - 콜&상담 같은데"*). 사이드바와 같은 내비 설정 공급자를 읽어,
 * 원장이 그룹 이름을 바꾸거나 메뉴를 다른 그룹으로 옮기면 머리글도 같이 바뀐다. 화면이 적은 `eyebrow`는 폴백이다.
 * 서버 렌더와 같은 값(주소·공급자 값뿐 — `window`를 안 읽는다)이라 하이드레이션이 갈리지 않는다([[#108]]).
 */
export function MenuPageLead({ eyebrow, title, hasCompactLabel }: { eyebrow?: string; title: string; hasCompactLabel: boolean }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const { menus, groups, source } = useNavigationSettings();
  const shownTitle = useMenuPageTitle(title);
  const href = `${pathname}?${search}`;
  const group = useMemo(() => menuGroupLabelFor(href, source, menus, groups), [href, source, menus, groups]);
  return <PageHeaderLead eyebrow={pageHeaderEyebrow(group, eyebrow, shownTitle)} title={shownTitle} hasCompactLabel={hasCompactLabel} />;
}
