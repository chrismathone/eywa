import type { EywaIconName } from "@/components/icons/eywa-icons";
import type { MenuKey } from "@/lib/permissions";

export type NavItem = {
  href: string;
  label: string;
  icon: EywaIconName;
  menuKey: MenuKey;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

/**
 * 시안 NAV: 5그룹 (홈 / 수업 / 학생 / 운영 / 지원), botanical 아이콘.
 * 그룹 번호 (01~05)는 사이드바 헤더에서 자동 인덱스로 표시.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "홈",
    items: [{ href: "/dashboard", label: "대시보드", icon: "tree", menuKey: "dashboard" }],
  },
  {
    label: "수업",
    items: [
      { href: "/onescreen", label: "선생님 원스크린", icon: "check", menuKey: "teacher_onescreen" },
      { href: "/timetable", label: "시간표", icon: "leaf", menuKey: "timetable" },
      { href: "/attendance", label: "출석부", icon: "pulse", menuKey: "attendance" },
      { href: "/classes", label: "수업목록", icon: "branch", menuKey: "classes" },
    ],
  },
  {
    label: "학생",
    items: [
      { href: "/students", label: "학생목록", icon: "seed", menuKey: "students" },
      { href: "/enrollment", label: "등록상담", icon: "sprout", menuKey: "enrollment" },
      { href: "/consultations", label: "학생상담", icon: "wave", menuKey: "consultations" },
      { href: "/withdrawals", label: "퇴원관리", icon: "falling", menuKey: "withdrawals" },
    ],
  },
  {
    label: "운영",
    items: [
      { href: "/staff", label: "직원관리", icon: "roots", menuKey: "staff" },
      { href: "/billing", label: "수납관리", icon: "pollen", menuKey: "billing" },
      { href: "/meetings", label: "회의록", icon: "rings", menuKey: "meetings" },
    ],
  },
  {
    label: "지원",
    items: [
      { href: "/help", label: "도움말", icon: "spore", menuKey: "help" },
      { href: "/admin", label: "관리자 도구", icon: "rings", menuKey: "admin" },
    ],
  },
];

export function findNavItem(pathname: string): NavItem | undefined {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
        return item;
      }
    }
  }
  return undefined;
}

export function findNavGroup(pathname: string): NavGroup | undefined {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
        return group;
      }
    }
  }
  return undefined;
}
