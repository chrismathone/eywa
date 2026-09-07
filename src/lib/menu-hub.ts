import { navItemByKey, SUBTABS_BY_MENU, type NavItem } from "@/lib/navigation";
import { canAccess, type AccessMatrix, type MenuKey, type SystemRole } from "@/lib/permissions";
import { MENU_ICON, type EywaIconName } from "@/components/icons/eywa-icons";

/**
 * 버튼형 메뉴 — **왼쪽에서 업무군을 고르면 본문에 그 업무의 메뉴 버튼이 뜬다**(원장 2026-09-07 확정:
 * *"버튼형으로 갈꺼니까 그렇게 넘겨"*, 인수인계 `docs/_handoff/menu-compact-2026-09-07/`).
 *
 * 왼쪽에 상시로 서는 자리를 23개 → **업무군 8 + 즐겨찾기 4 + 지원 2**로 줄인다. 🔴 **기능을 지우는 게
 * 아니라 입구를 줄이는 것**이다 — 아래 목적지 목록에 기존 화면이 전부 남아 있고, 라우트·권한·창은 불변이다.
 *
 * 🔴 **라벨·주소·아이콘은 여기서 새로 적지 않는다** — `navItemByKey(menuKey)`로 [`NAV_GROUPS`](./navigation.ts)에서
 *    가져온다(이름을 바꿀 때 한쪽만 바뀌는 것을 구조로 막는다). 여기서 더하는 것은 **한 줄 설명**과 **묶음**뿐.
 * 🔴 면(탭) 목적지(`/billing?tab=…`·`/owner?tab=…`)는 부모 메뉴의 권한키를 그대로 쓴다 — 면에 별도 권한이
 *    없기 때문이고, 있는 것처럼 새 키를 지어내면 게이트가 두 벌이 된다.
 * 🔴 업무군은 **자식 중 하나라도 접근 가능할 때** 선다(그룹에 대표 메뉴 한 개의 권한을 재사용하지 않는다).
 *    ECS(영어)와 MCS(수학)는 **독립 권한**이라 한쪽만 있는 계정도 자기 시트 버튼을 봐야 한다.
 */

export type HubDest = {
  /** 접근 판정 키. 면이면 부모 메뉴 키(면에는 별도 권한이 없다). */
  menuKey: MenuKey;
  href: string;
  label: string;
  icon: EywaIconName;
  /** 버튼 아래 한 줄 설명 — 없으면 안 적는다(지어내지 않는다). */
  desc?: string;
  /** 담당 반을 전제로 만든 화면 — 담당 반이 0인 사무실 계정에겐 눌러도 빈 화면이라 감춘다(권한 아님). */
  teacherOnly?: boolean;
  /** 이 목적지만 master 전용(예: 강사 정산) — 메뉴 권한과 별개의 화면 안 게이트를 화면이 이미 건다. */
  masterOnly?: boolean;
  /** 부차 도구 — 큰 버튼이 아니라 아래 작은 줄로 그린다(자주 쓰는 것과 가끔 쓰는 것을 가른다). */
  tool?: boolean;
  /** 설명 줄 안에서의 묶음 제목(설정처럼 목적지가 많은 허브에서만). */
  section?: string;
};

export type HubGroup = {
  /** 사이드바·허브가 함께 쓰는 식별자. 🔴 `menuKey`가 아니다 — 업무군은 권한 축이 아니다. */
  id: string;
  label: string;
  icon: EywaIconName;
  /** 허브 머리의 한 줄 안내. */
  note?: string;
  /**
   * `direct` = 버튼 화면을 거치지 않고 바로 그 화면으로(운영실·캘린더·도움말).
   * `hub` = 본문에 버튼 목록을 띄운다.
   */
  kind: "direct" | "hub";
  items: HubDest[];
};

/** NAV_GROUPS의 정의를 그대로 쓰되 설명만 더한다. 정의가 사라지면 그 목적지도 사라진다(조용한 죽은 링크 방지). */
function fromMenu(menuKey: MenuKey, desc?: string, extra?: Partial<HubDest>): HubDest | null {
  const item: NavItem | undefined = navItemByKey(menuKey);
  if (!item) return null;
  return { menuKey, href: item.href, label: item.label, icon: item.icon, desc, ...extra };
}

/**
 * 면(탭) 목적지 — 권한은 부모 메뉴 것을 쓰고, 라벨은 그 면 이름이다.
 * ⚠️ **아이콘은 면마다 준다**(`extra.icon`) — 부모 것을 그대로 물려받으면 설정 11칸이 전부 같은 톱니가 된다
 *    (원장 캡처 2026-09-07). 안 주면 부모 아이콘으로 떨어진다.
 */
function face(parent: MenuKey, href: string, label: string, desc?: string, extra?: Partial<HubDest>): HubDest | null {
  const item = navItemByKey(parent);
  if (!item) return null;
  return { menuKey: parent, href, label, icon: item.icon, desc, ...extra };
}

const keep = (xs: (HubDest | null)[]): HubDest[] => xs.filter((x): x is HubDest => x !== null);

/** 수납 면 목록 — 사이드바 하부탭과 **같은 배열**에서 라벨·주소를 가져온다(두 벌 금지). */
function billingFace(href: string, desc?: string, extra?: Partial<HubDest>): HubDest | null {
  const tab = (SUBTABS_BY_MENU.billing ?? []).find((t) => t.href === href);
  return tab ? face("billing", tab.href, tab.label, desc, extra) : null;
}

export const HUB_GROUPS: HubGroup[] = [
  {
    id: "dashboard",
    label: "운영실",
    icon: MENU_ICON.dashboard,
    kind: "direct",
    items: keep([fromMenu("dashboard")]),
  },
  {
    id: "calendar",
    label: "캘린더",
    icon: MENU_ICON.calendar,
    kind: "direct",
    items: keep([fromMenu("calendar")]),
  },
  {
    id: "class",
    label: "수업",
    icon: MENU_ICON.timetable,
    kind: "hub",
    note: "수업 운영에 필요한 메뉴를 선택하세요.",
    items: keep([
      fromMenu("timetable", "과목별 수업 배치·조회"),
      // 강사 시트는 영어·수학이 **독립 권한**이라 버튼도 둘이다(사이드바에선 한 줄 + 하부탭이었다).
      face("ecs", "/ecs", "영어 강사 시트", "영어 반별 주간 수업·진도", { icon: "spreadsheet" }),
      { menuKey: "mcs", href: "/mcs", label: "수학 강사 시트", icon: MENU_ICON.ecs, desc: "수학 반별 월간 진도" },
      fromMenu("attendance", "월별 출석부·오늘 출결"),
      fromMenu("classes", "반 목록·반 정보 관리"),
      fromMenu("lesson_reports", "수업보고서 작성·발송"),
      fromMenu("class_review", "수업 참관·평가 기록"),
      fromMenu("teacher_onescreen", "담당 학생 수업 마감", { teacherOnly: true }),
      // 출석부의 다른 면 — 자주 쓰는 자리는 위 버튼이고, 나머지는 작은 줄로.
      face("attendance", "/attendance/live", "오늘 출결", undefined, { tool: true, icon: "clipboardList" }),
      face("attendance", "/attendance/quick", "출결 모드", undefined, { tool: true, teacherOnly: true, icon: "listChecks" }),
    ]),
  },
  {
    id: "student",
    label: "학생",
    icon: MENU_ICON.students,
    kind: "hub",
    note: "학생 기록을 보고 성적을 관리합니다.",
    items: keep([
      fromMenu("students", "학생 명단·상세 기록"),
      fromMenu("exams", "시험 성적 입력·분석"),
    ]),
  },
  {
    id: "counsel",
    label: "상담·재원",
    icon: MENU_ICON.consultations,
    kind: "hub",
    note: "상담부터 재원 관리까지의 흐름입니다.",
    items: keep([
      fromMenu("consultations", "재원생 상담 기록"),
      fromMenu("enrollment", "신규 등록상담 접수·배정"),
      fromMenu("retention", "이탈 위험 학생 관리"),
      fromMenu("withdrawals", "퇴원·수강 종료 기록"),
    ]),
  },
  {
    id: "billing",
    label: "수납관리",
    icon: MENU_ICON.billing,
    kind: "hub",
    note: "청구·수납과 관련 도구입니다.",
    items: keep([
      billingFace("/billing", "월별 청구·수납 현황", { icon: "wallet" }),
      billingFace("/billing?tab=textbooks", "교재 신청·정산", { icon: "bookMarked" }),
      billingFace("/billing?tab=expenses", "지출 결의·집행", { icon: "receipt" }),
      billingFace("/billing?tab=refunds", "환불 요청서 처리", { icon: "undo" }),
      billingFace("/billing?tab=calculator", undefined, { tool: true }),
      billingFace("/billing?tab=sessions", undefined, { tool: true }),
      billingFace("/billing?tab=verify", undefined, { tool: true }),
    ]),
  },
  {
    id: "operation",
    label: "학원운영",
    icon: MENU_ICON.staff,
    kind: "hub",
    note: "직원·차량·비품을 관리합니다.",
    items: keep([
      fromMenu("staff", "직원 명부·근무 설정"),
      fromMenu("shuttle", "노선 편성·등하원 기록"),
      fromMenu("inventory", "자산·대여·실사·소모품"),
      face("shuttle", "/shuttle/today", "오늘 등하원", undefined, { tool: true, icon: "bus" }),
      face("shuttle", "/shuttle/live", "운행 현황", undefined, { tool: true, icon: "clock" }),
      // ⚠️ 실시간 위치는 아직 준비 화면이다(인수인계 §7) — 그래도 **입구는 남긴다**(사이드바 하부탭에 있던 자리).
      face("shuttle", "/shuttle/track", "실시간 위치", undefined, { tool: true, icon: "mapPin" }),
    ]),
  },
  {
    id: "document",
    label: "문서·결재",
    icon: MENU_ICON.meetings,
    kind: "hub",
    note: "기록과 결재 문서입니다.",
    items: keep([
      fromMenu("meetings", "회의 녹음·AI 정리"),
      fromMenu("approvals", "기안·결재함"),
      fromMenu("documents", "서식·문서 저장소"),
    ]),
  },
];

/** 하단 지원 줄 — 설정은 면이 많아 허브로, 도움말은 바로 연다. */
export const SUPPORT_GROUPS: HubGroup[] = [
  {
    id: "owner",
    label: "설정",
    icon: MENU_ICON.owner,
    kind: "hub",
    note: "학원 설정을 범주별로 고릅니다.",
    // ⚠️ 인수인계의 '11 → 5 범주'는 **제안**이라 면을 합치지 않았다(면을 합치면 라우트·조회가 바뀐다).
    //    여기서는 같은 11면을 **범주 제목으로 묶어** 고르게만 한다 — 주소·권한·화면 모두 그대로다.
    items: keep([
      face("owner", "/owner", "프로필·브랜드", undefined, { section: "학원 정보", icon: "palette" }),
      face("owner", "/owner?tab=operations", "운영 체계", undefined, { section: "수업·운영", icon: "clock" }),
      face("owner", "/owner?tab=subjects", "과목 운영", undefined, { section: "수업·운영", icon: "book" }),
      face("owner", "/owner?tab=billing", "수납·청구", undefined, { section: "청구·안내", icon: "wallet" }),
      face("owner", "/owner?tab=notifications", "알림·약관", undefined, { section: "청구·안내", icon: "bellRing" }),
      face("owner", "/owner?tab=consultations", "상담 양식", undefined, { section: "청구·안내", icon: "messages" }),
      face("owner", "/owner?tab=popups", "팝업 공지", undefined, { section: "청구·안내", icon: "megaphone" }),
      face("owner", "/owner?tab=permissions", "역할·권한", undefined, { section: "계정·권한", icon: "key" }),
      face("owner", "/owner?tab=data", "데이터 정리", undefined, { section: "시스템", icon: "eraser" }),
      face("owner", "/owner?tab=audit", "감사로그", undefined, { section: "시스템", icon: "history" }),
      face("owner", "/owner?tab=sheets", "연동", undefined, { section: "시스템", icon: "sync" }),
    ]),
  },
  {
    id: "help",
    label: "도움말",
    icon: MENU_ICON.help,
    kind: "direct",
    items: keep([fromMenu("help")]),
  },
];

/**
 * 왼쪽 맨 위 **'자주 방문한 메뉴'** — 업무군을 거치지 않고 한 번에 여는 자리.
 *
 * 🔴 목록은 **사람이 고르지 않는다** — 연 횟수로 자동 정렬한다(원장 2026-09-07:
 *    *"즐겨찾기 말고 사용자가 자주 방문한 탭이 알아서 리스트에 올라가도록"*). 집계·순위는
 *    [`menu-visits.ts`](src/features/nav/menu-visits.ts), 저장은 계정(`users.ui_prefs.nav.visits`).
 * ⚠️ 아래 배열은 **기록이 아직 없을 때의 첫 화면**일 뿐이다(신규 계정·첫 로그인). 한 번이라도 메뉴를 열면
 *    그때부터 실제 기록이 이 자리를 대신한다.
 */
export const DEFAULT_FREQUENT_KEYS: MenuKey[] = ["timetable", "ecs", "attendance", "students"];

type Gate = {
  systemRole: SystemRole;
  permMatrix?: AccessMatrix;
  /** 겸직(담당 반 보유) — `teacherOnly` 목적지의 쓸모 판정(사이드바와 같은 규약). */
  canTeacherView?: boolean;
  /** master 전용 목적지 노출. */
  isMaster?: boolean;
};

function allowed(dest: HubDest, gate: Gate): boolean {
  if (!canAccess(gate.systemRole, dest.menuKey, gate.permMatrix)) return false;
  if (dest.teacherOnly && !gate.canTeacherView) return false;
  if (dest.masterOnly && !gate.isMaster) return false;
  return true;
}

/** 이 사람에게 보이는 업무군 — 자식이 하나도 없으면 그 업무군은 서지 않는다(죽은 입구 금지). */
export function hubGroupsFor(groups: HubGroup[], gate: Gate): HubGroup[] {
  return groups
    .map((g) => ({ ...g, items: g.items.filter((d) => allowed(d, gate)) }))
    .filter((g) => g.items.length > 0);
}

/**
 * '자주 방문한 메뉴' 줄 — 방문 기록 순서(`keys`)를 목적지로 바꾼다. 권한이 없으면 그 줄만 빠진다.
 * ⚠️ 기록이 비면 첫 화면용 기본값으로 떨어진다(빈 자리를 남기지 않는다).
 */
export function frequentFor(gate: Gate, keys?: readonly MenuKey[]): HubDest[] {
  const source = keys && keys.length > 0 ? keys : DEFAULT_FREQUENT_KEYS;
  return keep(source.map((k) => fromMenu(k))).filter((d) => allowed(d, gate));
}

const routePath = (href: string): string => href.split(/[?#]/, 1)[0] ?? href;

/**
 * 지금 보고 있는 주소가 속한 업무군 — 사이드바의 현재 위치 표시와 '← …으로 돌아가기'에 쓴다.
 * 접두가 겹치면 **더 긴 경로**가 이긴다(`/attendance` ⊂ `/attendance/live`, 사이드바 하부탭과 같은 규약).
 */
export function hubGroupOfPath(pathname: string, groups: HubGroup[] = [...HUB_GROUPS, ...SUPPORT_GROUPS]): HubGroup | undefined {
  const path = routePath(pathname);
  let best: HubGroup | undefined;
  let bestLen = -1;
  for (const g of groups) {
    for (const d of g.items) {
      const p = routePath(d.href);
      if ((path === p || path.startsWith(`${p}/`)) && p.length > bestLen) {
        best = g;
        bestLen = p.length;
      }
    }
  }
  return best;
}
