"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { hubDestinationForPath } from "@/lib/menu-hub";
import { navItemByKey } from "@/lib/navigation";
import { useMenuPresentation, useNavigationSettings } from "./navigation-context";

/** 메뉴 자체의 제목만 개명한다. 학생 이름·문서 제목·기간처럼 실제 내용인 제목은 그대로 둔다. */
export function MenuPageTitle({ title }: { title: string }) {
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
