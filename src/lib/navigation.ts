import {
  LayoutDashboard,
  Presentation,
  CalendarDays,
  ClipboardCheck,
  BookOpen,
  Users,
  ClipboardList,
  UserPlus,
  MessageSquare,
  UserMinus,
  ShieldAlert,
  Briefcase,
  Wallet,
  FileText,
  HelpCircle,
  Settings,
  Building2,
  type LucideIcon,
} from "lucide-react";
import type { MenuKey } from "@/lib/permissions";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  menuKey: MenuKey;
  // 사이드바·모바일내비·팰릿에선 숨기되 findNavItem(창 해석)·아이콘맵엔 남긴다.
  // 예: 등록상담은 "상담" 메뉴의 FaceTabs 면이라 사이드바엔 안 뜨지만 창/링크 해석은 필요.
  hidden?: boolean;
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
      { href: "/exams", label: "성적관리", icon: ClipboardList, menuKey: "exams" },
      // 상담 = 학생상담(/consultations) + 등록상담(/enrollment) 2면(상단 FaceTabs로 교차). 사이드바엔 "상담" 한 항목.
      { href: "/consultations", label: "상담", icon: MessageSquare, menuKey: "consultations" },
      // 등록상담은 "상담"의 FaceTabs 면 → 사이드바 숨김(hidden), 단 창 해석·아이콘맵엔 유지.
      { href: "/enrollment", label: "등록상담", icon: UserPlus, menuKey: "enrollment", hidden: true },
      { href: "/retention", label: "이탈 방어", icon: ShieldAlert, menuKey: "retention" },
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
      { href: "/owner", label: "학원 설정", icon: Building2, menuKey: "owner" },
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
