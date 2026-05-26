import {
  BadgeCheck,
  BookOpen,
  Calendar,
  ClipboardCheck,
  HelpCircle,
  LayoutDashboard,
  MessagesSquare,
  NotebookPen,
  UserMinus,
  UserPlus,
  Users,
  Wallet,
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
  label?: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    items: [{ href: "/", label: "대시보드", icon: LayoutDashboard, menuKey: "dashboard" }],
  },
  {
    label: "수업",
    items: [
      { href: "/timetable", label: "시간표", icon: Calendar, menuKey: "timetable" },
      { href: "/attendance", label: "출석부", icon: ClipboardCheck, menuKey: "attendance" },
      { href: "/classes", label: "수업목록", icon: BookOpen, menuKey: "classes" },
    ],
  },
  {
    label: "학생",
    items: [
      { href: "/students", label: "학생목록", icon: Users, menuKey: "students" },
      { href: "/enrollment", label: "등록상담", icon: UserPlus, menuKey: "enrollment" },
      { href: "/consultations", label: "학생상담", icon: MessagesSquare, menuKey: "consultations" },
      { href: "/withdrawals", label: "퇴원관리", icon: UserMinus, menuKey: "withdrawals" },
    ],
  },
  {
    label: "운영",
    items: [
      { href: "/staff", label: "직원관리", icon: BadgeCheck, menuKey: "staff" },
      { href: "/billing", label: "수납관리", icon: Wallet, menuKey: "billing" },
      { href: "/meetings", label: "회의록", icon: NotebookPen, menuKey: "meetings" },
    ],
  },
  {
    items: [{ href: "/help", label: "도움말", icon: HelpCircle, menuKey: "help" }],
  },
];

export function findNavItem(pathname: string): NavItem | undefined {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (item.href === "/") {
        if (pathname === "/") return item;
        continue;
      }
      if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
        return item;
      }
    }
  }
  return undefined;
}
