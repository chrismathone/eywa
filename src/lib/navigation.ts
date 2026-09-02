import type { LucideIcon } from "@/components/icons/eywa-icon-compat";
import { MENU_ICON, type EywaIconName } from "@/components/icons/eywa-icons";
import type { MenuKey } from "@/lib/permissions";
import { OWNER_TABS } from "@/features/owner/tabs";

export type NavItem = {
  href: string;
  label: string;
  icon: EywaIconName;
  menuKey: MenuKey;
  /**
   * 데스크톱 셸에서 이 메뉴를 표시하는 방식. 생략하면 기존처럼 플로팅 창(`window`)으로 연다.
   * `desktop`은 셸의 main 자체가 작업면이며 iframe 창을 만들지 않는다.
   */
  presentation?: "desktop" | "window";
  // 사이드바·모바일내비·팰릿에선 숨기되 findNavItem(창 해석)·아이콘맵엔 남긴다.
  // 예: 등록상담은 "상담" 메뉴의 FaceTabs 면이라 사이드바엔 안 뜨지만 창/링크 해석은 필요.
  hidden?: boolean;
  /**
   * **사이드바에서만** 이 메뉴를 부모 메뉴의 하부탭으로 내려 표시한다(독립 라우트·독립 창 유지).
   * `hidden`과 다른 점: 팰릿·모바일내비엔 그대로 남아 검색·이동이 된다(발견성 보존).
   * 창 id·권한키는 자기 menuKey를 그대로 쓰므로 창 크기(routeWindowSize)도 자기 것이다.
   * 현재 사용처 0 — English Class Sheet가 썼으나(2026-07-29) 독립 사이드바 탭으로 승격되며
   * 떼었다(원장 지시 2026-08-17). 메커니즘은 다음 하위 카테고리 메뉴를 위해 보존.
   */
  subOf?: MenuKey;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export function navPresentation(item: Pick<NavItem, "presentation">): "desktop" | "window" {
  return item.presentation ?? "window";
}

// 메뉴 하부탭(면) — 펼친 사이드바에서 현재 메뉴 아래 작게 노출. 클릭 시 같은 menuKey 창에서 면 전환.
// 면 정의는 각 페이지 FaceTabs와 동기 유지(여기 라벨/href는 표시·이동용 미러).
//
// `menuKey`가 있으면 그 하부탭은 **독립 메뉴**(별도 라우트·별도 창·별도 권한)다 — 부모 창에서 면만
// 바꾸는 게 아니라 자기 창(자기 크기)으로 열리고, 사이드바가 그 키로 접근권한을 검사한다.
// (없으면 기존처럼 부모 menuKey 창의 면 전환. `?tab=` 면들이 여기 해당.)
//
// `teacherOnly`는 **권한이 아니라 쓸모** 판정이다 — 담당 반을 전제로 만든 면(자기 반만 그리는 화면)은
// 담당 반이 0인 사무실 계정에게 눌러도 빈 화면이라, 사이드바가 `canTeacherView`(겸직 판정)로 감춘다.
// 라우트는 그대로 열려 있다(URL·강사 미니셸 '내 메뉴'는 불변) — 여기서 지우는 건 **사이드바 줄 하나**뿐.
export type SubTab = { label: string; href: string; menuKey?: MenuKey; teacherOnly?: boolean };
/**
 * 시간표(개발중) 사이드바 노출 스위치 — **원장 지시 2026-08-31로 일단 숨김**.
 *
 * 🔴 숨김은 **잠금이 아니다**([[#77]]) — 라우트(`/timetable-dev`)·권한(`menuKeyForPath` → timetable)·
 *    격리 가드는 그대로 살아 있어서, 주소를 직접 치면 지금도 들어간다(개발 중 확인용으로 그게 맞다).
 *    "아무도 못 들어가게" 하려면 그때는 라우트 게이트를 따로 걸어야 한다.
 * 되돌리기 = 이 값을 true로. 아래 배열은 그대로 두므로 한 글자만 바꾸면 하부탭 3면이 다시 선다.
 */
const TIMETABLE_DEV_NAV_VISIBLE = false;

/** 시간표 하부탭(본 시간표 / 개발중 / 월별 비교) — 위 스위치가 켜졌을 때만 사이드바에 선다. */
const TIMETABLE_SUBTABS: SubTab[] = [
  { label: "시간표", href: "/timetable" },
  { label: "시간표(개발중)", href: "/timetable-dev" },
  // 월별 비교 — 개발중의 하위 면. activeSubTabHref가 **가장 긴 경로**를 이기게 두므로
  // `/timetable-dev/compare`에서 '시간표(개발중)'이 같이 켜지지 않는다(출석부 월별/오늘과 같은 규약).
  { label: "월별 비교", href: "/timetable-dev/compare" },
];

export const SUBTABS_BY_MENU: Partial<Record<MenuKey, SubTab[]>> = {
  // ⚠️ 폰엔 사이드바가 없어 하부탭으로 갈 길이 없다 — 개발중 면이 상시 기능이 되면 화면 안 탭도 필요하다
  //    (셔틀에서 겪은 그대로, faces.ts 선례).
  ...(TIMETABLE_DEV_NAV_VISIBLE ? { timetable: TIMETABLE_SUBTABS } : {}),
  billing: [
    { label: "수납", href: "/billing" },
    { label: "교재", href: "/billing?tab=textbooks" },
    { label: "지출", href: "/billing?tab=expenses" },
    { label: "수강료 계산기", href: "/billing?tab=calculator" },
    { label: "회차 확정", href: "/billing?tab=sessions" },
    { label: "시수 검증", href: "/billing?tab=verify" },
    { label: "환불 요청서", href: "/billing?tab=refunds" },
  ],
  // 출석부 — 오늘 출결을 하부탭 위에 두되, **부모 메뉴·기본 착지는 월별**(`/attendance`).
  // 오늘 출결을 부모 href로 올리면 월별 장부를 열던 손이 끊긴다(원장 2026-08-14).
  // 라우트가 `/attendance/*`라 menuKeyForPath(첫 세그먼트)가 그대로 attendance로 푼다.
  attendance: [
    { label: "오늘 출결", href: "/attendance/live" },
    // 출결 모드(2026-08-20) — 강사 본인 반만·터치 몇 번으로 끝내는 모바일 1순위 면.
    // ⚠️ **여기가 유일한 입구가 되면 안 된다** — 폰엔 사이드바가 없어 하부탭으로 갈 길이 아예 없다
    //    (셔틀에서 겪은 그대로). 강사 홈(원스크린 상단 바·ECS 툴바)에 같은 링크가 함께 있어야 한다.
    // 🔴 `teacherOnly` — 사이드바는 **관리자뷰에만** 있는데 이 면은 자기 담당 반만 그린다. 담당 반이
    //    0인 사무실 계정(원장 포함)에겐 눌러도 빈 화면이라 줄만 늘었다(원장 지적 2026-08-20:
    //    *"강사뷰가 아닌데 왜 메뉴에 '출결 모드'가 있지..?"*). 겸직(담당 반 있는 관리자)에겐 남는다.
    { label: "출결 모드", href: "/attendance/quick", teacherOnly: true },
    { label: "월별 출석부", href: "/attendance" },
  ],
  // 강사 시트 — 영어/수학 두 시트(원장 2026-08-31). 부모 href·기본 착지는 **영어**(/ecs, 종전 그대로).
  // 🔴 수학은 `menuKey`를 달아 **독립 메뉴**로 둔다 — 별도 라우트·별도 창·**별도 권한**이라
  //    수학 담임에게만 열거나 닫는 게 가능하다(하부탭 라벨만 바꾼 게 아니다).
  // ⚠️ 폰엔 사이드바가 없어 하부탭으로 갈 길이 없다 — 두 시트를 폰에서 오가야 하면 화면 안 탭이
  //    따로 필요하다(셔틀 faces.ts 선례, 출석부에 남아 있는 같은 함정).
  ecs: [
    { label: "영어", href: "/ecs" },
    { label: "수학", href: "/mcs", menuKey: "mcs" },
  ],
  // 셔틀 — 부모 href·기본 착지는 **노선 편성**(/shuttle). 매일 찍는 건 '오늘 등하원'이지만
  // 편성이 셔틀의 본체라 출석부(월별 착지)와 같은 결로 둔다.
  shuttle: [
    { label: "노선 편성", href: "/shuttle" },
    { label: "오늘 등하원", href: "/shuttle/today" },
  ],
  // 재고 관리 — 시안(자산관리대장 개편)의 시트 4개 = 면 4개. 부모 href·기본 착지는 **자산**.
  // 🔴 여기 라벨·순서가 화면 안 FaceTabs의 단일 소스다(`features/inventory/faces.ts`가 파생) —
  //    폰엔 사이드바가 없어 화면 안 탭이 유일한 통로다(셔틀 faces.ts 선례).
  inventory: [
    { label: "자산", href: "/inventory" },
    { label: "대여", href: "/inventory?tab=loans" },
    { label: "실사", href: "/inventory?tab=audits" },
    { label: "소모품", href: "/inventory?tab=supplies" },
  ],
  // 직원 이력서 면은 2026-07-28 직원 목록에 통합(이름 클릭=이력서, 등록=이력서 작성) — 하위 메뉴 제거.
  // ⚠️ 면이 이거 하나뿐이라 **사이드바엔 안 나온다**(subTabsForMenu의 "면 하나 = 하부탭 아님" 규칙).
  //    면을 하나 더 만들면 그때 자동으로 다시 보인다.
  staff: [{ label: "직원 목록", href: "/staff" }],
  help: [
    { label: "도움말", href: "/help" },
    { label: "아이콘 시스템", href: "/help/icons" },
  ],
  // 🔴 여기에 면 목록을 다시 적지 말 것 — 상단 FaceTabs와 **같은 배열**(features/owner/tabs.ts)에서
  //    파생한다. 예전엔 양쪽을 각각 하드코딩해 한쪽만 고치면 사이드바가 stale이었고, 실제로
  //    '상담 양식'이 오래 빠져 있었다(원장 지적 2026-08-07).
  owner: OWNER_TABS.map((t) => ({ label: t.label, href: t.href })),
};

/**
 * NAV: 5그룹 (홈 / 수업 / 학생 / 운영 / 지원). 아이콘은 식물 비유가 아닌 기능 중심
 * Eywa 아이콘(레일·모바일nav·검색팰릿·창 전환 공용). 그룹 번호는 사이드바에서 자동 인덱스.
 *
 * ⚠️ 라벨 = 각 page.tsx `metadata.title`("<라벨> — eywa")과 **동일해야 한다** — 창(iframe) 타이틀바가
 * 문서 제목을 실시간 표시(observeIframe)하므로, 여기만 바꾸면 사이드바와 창 이름이 어긋난다
 * (2026-07-16 원장 지적: 6962b14 개편이 사이드바만 대량 리네임 → 전부 원복. 라벨을 바꾸려면 페이지
 * metadata.title과 함께 바꿀 것). 대시보드만 예외적으로 "운영실"로 개칭(페이지 제목도 운영실).
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "홈",
    items: [
      {
        href: "/dashboard",
        label: "운영실",
        icon: MENU_ICON.dashboard,
        menuKey: "dashboard",
        presentation: "desktop",
      },
      // 캘린더 — 학원 공용 일정(원장 2026-08-18 도입). 매일 여는 자리라 홈 그룹.
      { href: "/calendar", label: "캘린더", icon: MENU_ICON.calendar, menuKey: "calendar" },
    ],
  },
  {
    label: "수업",
    items: [
      { href: "/onescreen", label: "선생님 원스크린", icon: MENU_ICON.teacher_onescreen, menuKey: "teacher_onescreen" },
      { href: "/timetable", label: "시간표", icon: MENU_ICON.timetable, menuKey: "timetable" },
      // English Class Sheet(ECS) — 영어 반별 주간 수업계획서/출석부(구글시트 이식). 라벨은 원장 확정 명칭.
      // 시간표 하위 카테고리(subOf, 2026-07-29)였다가 **독립 사이드바 탭으로 승격**(원장 지시 2026-08-17)
      // — 시간표와 같은 급. 권한은 기존 menuKey "ecs" 그대로(사이드바 canAccess + 페이지 requireEcsClassAccess).
      // 강사 시트 — 영어(ECS)·수학(MCS)을 **한 줄로 묶고 하부탭으로 가른다**(원장 2026-08-31:
      // *"영어 강사 시트와 수학 강사 시트를 함께 묶어서 강사 시트의 세부 탭으로 2개 배정"*).
      // 둘은 축이 다른 화면이지만(영어=영역×날짜 / 수학=학생×날짜) 사이드바에서 같은 성격으로 읽힌다.
      // ⚠️ **부모의 권한키는 `ecs`다** — `ecs`가 none인 사람은 이 줄 자체가 안 보여 수학 시트로도
      //    못 간다(두 키의 기본값이 같아서 지금은 그런 사람이 없다). 영어만 닫을 일이 생기면
      //    그때 부모를 중립 라우트로 빼야 한다.
      { href: "/ecs", label: "강사 시트", icon: MENU_ICON.ecs, menuKey: "ecs" },
      { href: "/attendance", label: "출석부", icon: MENU_ICON.attendance, menuKey: "attendance" },
      // 🔴 자리 출석부(랩실·JJ실)는 **사이드바 항목이 아니다**(원장 2026-08-14: "따로 빼지말고").
      //    출석부 안 강사 드롭다운에서 [선생님] / [LAB·JJ] / [퇴직] 그룹으로 고른다 — 자리는 메뉴가
      //    아니라 **강사 축의 한 갈래**다. 라우트(/attendance/seat/*)와 권한 키는 그대로 있고
      //    진입만 그 드롭다운으로 좁힌다.
      { href: "/classes", label: "수업목록", icon: MENU_ICON.classes, menuKey: "classes" },
      // 수업보고서 = 학원 전체 보고서 발송 총괄(구 학원설정 ?tab=report_mgmt에서 승격, 옛 Edutrix 외부링크 대체).
      { href: "/lesson-reports", label: "수업보고서", icon: MENU_ICON.lesson_reports, menuKey: "lesson_reports" },
    ],
  },
  {
    label: "학생",
    items: [
      { href: "/students", label: "학생목록", icon: MENU_ICON.students, menuKey: "students" },
      { href: "/exams", label: "성적관리", icon: MENU_ICON.exams, menuKey: "exams" },
      { href: "/consultations", label: "학생상담", icon: MENU_ICON.consultations, menuKey: "consultations" },
      // 등록상담은 별도 권한(menuKey=enrollment)을 가지므로 숨기지 않고 독립 진입점을 제공한다.
      { href: "/enrollment", label: "등록상담", icon: MENU_ICON.enrollment, menuKey: "enrollment" },
      { href: "/retention", label: "이탈 방어", icon: MENU_ICON.retention, menuKey: "retention" },
      { href: "/withdrawals", label: "퇴원관리", icon: MENU_ICON.withdrawals, menuKey: "withdrawals" },
    ],
  },
  {
    label: "운영",
    items: [
      { href: "/staff", label: "직원관리", icon: MENU_ICON.staff, menuKey: "staff" },
      { href: "/billing", label: "수납관리", icon: MENU_ICON.billing, menuKey: "billing" },
      // 셔틀 — 노선 편성(행선지·승하차 배정)과 일별 등하원 기록. makeedu 노랑버스에서 이관(원장 2026-08-19).
      { href: "/shuttle", label: "셔틀", icon: MENU_ICON.shuttle, menuKey: "shuttle" },
      // 재고 관리 — 전자기기 자산관리대장(자산·대여·실사·소모품). 구글시트 시안 이식(원장 2026-09-02).
      { href: "/inventory", label: "재고 관리", icon: MENU_ICON.inventory, menuKey: "inventory" },
      // 교재 요청 = 강사 미니셸 '내 메뉴' 전용 진입(강사 스코프). 사이드바엔 숨김, 창/타이틀 해석용 유지.
      { href: "/textbook-requests", label: "교재 요청", icon: MENU_ICON.textbook_requests, menuKey: "textbook_requests", hidden: true },
      // 지출결의서(강사 제출) = 강사 '내 메뉴' 전용 진입. 사이드바엔 숨김(사무실은 /billing 지출 면), 창/타이틀 해석용 유지.
      { href: "/expense-requests", label: "지출결의서", icon: MENU_ICON.expense_requests, menuKey: "expense_requests", hidden: true },
      { href: "/meetings", label: "회의록", icon: MENU_ICON.meetings, menuKey: "meetings" },
      // 수업 평가 체크리스트(참관) — 테스트 단계: 기본 전원 none이라 개인 예외(이승엽)에게만 보인다.
      { href: "/class-review", label: "수업 평가", icon: MENU_ICON.class_review, menuKey: "class_review" },
      // 전자결재(기안·결재함, 첫 양식 = 휴가신청서) — 테스트 단계: 기본 전원 none이라 코드 명단(이승엽·김예원)에게만 보인다.
      { href: "/approvals", label: "전자결재", icon: MENU_ICON.approvals, menuKey: "approvals" },
      // 데이터베이스 = 학원 각종 서식(빈 양식 파일·앱 작성 문서) 저장소 — 윈도우 탐색기형 뷰.
      { href: "/documents", label: "데이터베이스", icon: MENU_ICON.documents, menuKey: "documents" },
    ],
  },
  {
    label: "지원",
    items: [
      { href: "/help", label: "도움말", icon: MENU_ICON.help, menuKey: "help" },
      { href: "/owner", label: "학원 설정", icon: MENU_ICON.owner, menuKey: "owner" },
      // 관리자 도구는 학원 설정(/owner) "관리" 면들로 흡수 → 사이드바 숨김. menuKey는 /admin 리다이렉트 stub·창 해석용 유지.
      { href: "/admin", label: "관리자 도구", icon: MENU_ICON.admin, menuKey: "admin", hidden: true },
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

function routePath(value: string): string {
  return value.split(/[?#]/, 1)[0] ?? value;
}

/**
 * 하부탭 중 **지금 주소에 맞는 하나**. 접두가 겹치면(예 `/attendance` ⊂ `/attendance/live`)
 * 더 긴 경로가 이긴다 — 짧은 쪽이 같이 켜지면 "오늘 출결을 눌렀는데 월별도 선택"이 된다.
 */
export function activeSubTabHref(
  tabs: readonly { href: string }[],
  currentHref: string,
): string | null {
  const currentPath = routePath(currentHref);
  const currentTab = new URLSearchParams(currentHref.split("?")[1] ?? "").get("tab");
  let best: string | null = null;
  let bestScore = -1;
  for (const t of tabs) {
    const [rawPath, rawQuery] = t.href.split("?");
    const path = routePath(rawPath ?? "");
    if (!path) continue;
    const tab = rawQuery ? new URLSearchParams(rawQuery).get("tab") : null;
    if (tab === null) continue;
    if (currentPath === path && currentTab === tab) {
      const score = path.length + 1_000;
      if (score > bestScore) {
        best = t.href;
        bestScore = score;
      }
    }
  }
  if (best) return best;
  for (const t of tabs) {
    const path = routePath(t.href);
    if (!path || t.href.includes("?")) continue;
    if (currentPath === path || currentPath.startsWith(`${path}/`)) {
      if (path.length > bestScore) {
        best = t.href;
        bestScore = path.length;
      }
    }
  }
  return best;
}

export function findNavItem(pathname: string): NavItem | undefined {
  const path = routePath(pathname);
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (path === item.href || path.startsWith(`${item.href}/`)) {
        return item;
      }
    }
  }
  return undefined;
}

export function findNavGroup(pathname: string): NavGroup | undefined {
  const path = routePath(pathname);
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (path === item.href || path.startsWith(`${item.href}/`)) {
        return group;
      }
    }
  }
  return undefined;
}

/**
 * 사이드바 하부탭 = 정적 면(`SUBTABS_BY_MENU`) + **부모를 지정한 독립 라우트 메뉴**(`subOf`).
 * subOf 항목은 `menuKey`를 달고 나오므로 사이드바가 그 키로 권한을 검사하고, 클릭 시 부모 창이
 * 아니라 자기 창(자기 크기)으로 열린다. 부모에 면이 하나도 없어도 subOf만으로 하부탭이 생긴다.
 *
 * 🔴 **면이 하나뿐이면 하부탭이 아니다**(원장 2026-08-03: 직원관리가 '직원 목록' 하나만 남은 뒤 그 줄이
 *    노이즈가 됐다). 그 한 줄은 부모 메뉴를 눌렀을 때 이미 열리는 바로 그 화면이라, 그려 봐야 갈 수 있는
 *    곳이 늘지 않는다. 면이 줄어든 메뉴가 또 생겨도 자동으로 사라지도록 데이터가 아니라 **여기서** 판정한다.
 * ⚠️ 단 **독립 메뉴(`menuKey` 有)는 하나여도 남긴다** — subOf 자식은 최상위 목록에서 빠져 있어서,
 *    여기서 지우면 사이드바에서 그 메뉴로 갈 길이 통째로 사라진다(ECS가 그랬다 — 2026-08-17 독립 승격 전).
 */
export function subTabsForMenu(menuKey: MenuKey): SubTab[] {
  const faces = SUBTABS_BY_MENU[menuKey] ?? [];
  const childMenus: SubTab[] = [];
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (item.subOf === menuKey && !item.hidden) {
        childMenus.push({ label: item.label, href: item.href, menuKey: item.menuKey });
      }
    }
  }
  // 부모 자신의 면이 있으면 그 뒤에 자식 메뉴를 붙인다(면 → 독립 메뉴 순).
  const all = childMenus.length === 0 ? faces : [...faces, ...childMenus];
  if (all.length <= 1 && !all.some((s) => s.menuKey)) return [];
  return all;
}
