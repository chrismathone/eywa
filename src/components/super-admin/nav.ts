import type { AywaIconName } from "@/components/icons/aywa-icons";

/**
 * 슈퍼관리자 메뉴 — 데스크톱 사이드바([`sidebar.tsx`](./sidebar.tsx))와 폰 상단 바([`mobile-bar.tsx`](./mobile-bar.tsx))가
 * **같은 목록**을 읽는다(한쪽에만 메뉴를 더하면 폰에서 그 화면으로 갈 길이 없다).
 * ⚠️ 서버·클라 공용 일반 모듈 — `"use client"`를 붙이지 말 것([[#81]]).
 */
export type SuperAdminNavItem = { href: string; label: string; icon: AywaIconName };

export const SUPER_ADMIN_NAV: SuperAdminNavItem[] = [
  { href: "/super-admin", label: "대시보드", icon: "layoutGrid" },
  { href: "/super-admin/tenants", label: "전 지점 운영", icon: "building" },
  { href: "/super-admin/usage", label: "이용 분석", icon: "barChart" },
  { href: "/super-admin/audit", label: "감사 로그", icon: "history" },
];

/** 지금 경로가 속한 메뉴 — 대시보드는 정확히 같을 때만, 나머지는 하위 경로(`/tenants/…`)까지. */
export function activeSuperAdminNav(pathname: string): SuperAdminNavItem | null {
  return (
    SUPER_ADMIN_NAV.find((item) =>
      item.href === "/super-admin"
        ? pathname === item.href
        : pathname === item.href || pathname.startsWith(`${item.href}/`),
    ) ?? null
  );
}
