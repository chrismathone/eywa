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
  BookMarked,
  FileText,
  FolderOpen,
  HelpCircle,
  Settings,
  Building2,
  NotebookPen,
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

// 메뉴 하부탭(면) — 펼친 사이드바에서 현재 메뉴 아래 작게 노출. 클릭 시 같은 menuKey 창에서 면 전환.
// 면 정의는 각 페이지 FaceTabs와 동기 유지(여기 라벨/href는 표시·이동용 미러).
export type SubTab = { label: string; href: string };
export const SUBTABS_BY_MENU: Partial<Record<MenuKey, SubTab[]>> = {
  consultations: [
    { label: "학생상담", href: "/consultations" },
    { label: "등록상담", href: "/enrollment" },
  ],
  billing: [
    { label: "수납", href: "/billing" },
    { label: "교재", href: "/billing?tab=textbooks" },
    { label: "지출", href: "/billing?tab=expenses" },
    { label: "수강료 계산기", href: "/billing?tab=calculator" },
    { label: "회차 확정", href: "/billing?tab=sessions" },
    { label: "환불 요청서", href: "/billing?tab=refunds" },
  ],
  staff: [
    { label: "직원 목록", href: "/staff" },
    { label: "직원 이력서", href: "/staff?tab=resumes" },
  ],
  owner: [
    { label: "프로필·브랜드", href: "/owner" },
    { label: "운영 체계", href: "/owner?tab=operations" },
    { label: "과목 운영", href: "/owner?tab=subjects" },
    { label: "수납·청구", href: "/owner?tab=billing" },
    { label: "알림·약관", href: "/owner?tab=notifications" },
    { label: "역할·권한", href: "/owner?tab=permissions" },
    // 관리 그룹(구 /admin 흡수) — 팝업 공지·데이터 정리(고아+중복 통합)·감사·연동.
    { label: "팝업 공지", href: "/owner?tab=popups" },
    { label: "데이터 정리", href: "/owner?tab=data" },
    { label: "감사로그", href: "/owner?tab=audit" },
    { label: "연동", href: "/owner?tab=sheets" },
  ],
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
      // 수업보고서 = 학원 전체 보고서 발송 총괄(구 학원설정 ?tab=report_mgmt에서 승격, 옛 Edutrix 외부링크 대체).
      { href: "/lesson-reports", label: "수업보고서", icon: NotebookPen, menuKey: "lesson_reports" },
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
      // 교재 요청 = 강사 미니셸 '내 메뉴' 전용 진입(강사 스코프). 사이드바엔 숨김, 창/타이틀 해석용 유지.
      { href: "/textbook-requests", label: "교재 요청", icon: BookMarked, menuKey: "textbook_requests", hidden: true },
      { href: "/meetings", label: "회의록", icon: FileText, menuKey: "meetings" },
      // 데이터베이스 = 학원 각종 서식(빈 양식 파일·앱 작성 문서) 저장소 — 윈도우 탐색기형 뷰.
      { href: "/documents", label: "데이터베이스", icon: FolderOpen, menuKey: "documents" },
    ],
  },
  {
    label: "지원",
    items: [
      { href: "/help", label: "도움말", icon: HelpCircle, menuKey: "help" },
      { href: "/owner", label: "학원 설정", icon: Building2, menuKey: "owner" },
      // 관리자 도구는 학원 설정(/owner) "관리" 면들로 흡수 → 사이드바 숨김. menuKey는 /admin 리다이렉트 stub·창 해석용 유지.
      { href: "/admin", label: "관리자 도구", icon: Settings, menuKey: "admin", hidden: true },
    ],
  },
];

/**
 * 외부 링크 탭 — 내부 라우트(플로팅 창)가 아니라 **별도 앱(다른 오리진)**. menuKey가 없고 cross-origin
 * 이라 iframe(창) 불가 → NAV_GROUPS(내부 라우트 전용, 권한 게이트·창 해석 대상)와 **분리**한다.
 * 사이드바가 `group` 라벨을 맞춰 해당 섹션 하단에 새 탭(_blank) 앵커로 렌더(창·권한·findNavItem 무관).
 */
export type ExternalNavItem = { href: string; label: string; icon: LucideIcon; group: string };
// 옛 "수업보고서 = Edutrix 외부링크"는 내부 /lesson-reports 메뉴(수업 그룹)로 교체·제거(2026-07-10).
// 외부링크 렌더 인프라(app-sidebar ExternalRailItem)는 향후 다른 외부 앱용으로 보존 — 현재 항목 없음.
export const EXTERNAL_NAV: ExternalNavItem[] = [];

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
