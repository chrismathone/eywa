import {
  LayoutDashboard,
  Presentation,
  CalendarDays,
  ClipboardCheck,
  BookOpen,
  Users,
  UserPlus,
  MessageSquare,
  UserMinus,
  Briefcase,
  Wallet,
  FileText,
  HelpCircle,
  Settings,
  type LucideIcon,
} from "lucide-react";
import type { MenuKey } from "@/lib/permissions";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  menuKey: MenuKey;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

/**
 * NAV: 5그룹 (홈 / 수업 / 학생 / 운영 / 지원). 아이콘은 기능이 직관적으로 읽히는
 * lucide 표준 아이콘(레일·모바일nav·검색팰릿 공용). 그룹 번호는 사이드바에서 자동 인덱스.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "홈",
    items: [{ href: "/dashboard", label: "대시보드", icon: LayoutDashboard, menuKey: "dashboard" }],
  },
  {
    label: "수업",
    items: [
      { href: "/onescreen", label: "선생님 원스크린", icon: Presentation, menuKey: "teacher_onescreen" },
      { href: "/timetable", label: "시간표", icon: CalendarDays, menuKey: "timetable" },
      { href: "/attendance", label: "출석부", icon: ClipboardCheck, menuKey: "attendance" },
      { href: "/classes", label: "수업목록", icon: BookOpen, menuKey: "classes" },
    ],
  },
  {
    label: "학생",
    items: [
      { href: "/students", label: "학생목록", icon: Users, menuKey: "students" },
      { href: "/enrollment", label: "등록상담", icon: UserPlus, menuKey: "enrollment" },
      { href: "/consultations", label: "학생상담", icon: MessageSquare, menuKey: "consultations" },
      { href: "/withdrawals", label: "퇴원관리", icon: UserMinus, menuKey: "withdrawals" },
    ],
  },
  {
    label: "운영",
    items: [
      { href: "/staff", label: "직원관리", icon: Briefcase, menuKey: "staff" },
      { href: "/billing", label: "수납관리", icon: Wallet, menuKey: "billing" },
      { href: "/meetings", label: "회의록", icon: FileText, menuKey: "meetings" },
    ],
  },
  {
    label: "지원",
    items: [
      { href: "/help", label: "도움말", icon: HelpCircle, menuKey: "help" },
      { href: "/admin", label: "관리자 도구", icon: Settings, menuKey: "admin" },
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
