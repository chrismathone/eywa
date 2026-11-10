import { menuSearchKeywords, navItemByKey, SUBTABS_BY_MENU, type NavItem } from "@/lib/navigation";
import { canAccess, MENU_LABEL, type AccessMatrix, type MenuKey, type SystemRole } from "@/lib/permissions";
import { MENU_ICON, type AywaIconName } from "@/components/icons/aywa-icons";
import { settingMenuForHref } from "@/lib/settings-role-catalog";
import { OWNER_FACES, type OwnerFaceKey } from "@/features/owner/tabs";
import {
  isMenuHiddenByLayout,
  sortByMenuLayout,
  applyMenuPresentation,
  normalizeMenuRows,
  normalizeGroupRows,
  FIXED_GROUP_IDS,
  isFixedDestination,
  type MenuGroupLayout,
  type MenuLayout,
} from "@/features/owner/menu-layout";
import { SHUTTLE_PARENTS_PATH } from "@/features/shuttle/parent-accounts/parent-access";
import { SEAT_NAME, USABLE_SEAT_KEYS } from "@/features/attendance/seat/seat";

/**
 * 버튼형 메뉴 — **왼쪽에서 업무군을 고르면 본문에 그 업무의 메뉴 버튼이 뜬다**(원장 2026-09-07 확정:
 * *"버튼형으로 갈꺼니까 그렇게 넘겨"*, 인수인계 `docs/_handoff/menu-compact-2026-09-07/`).
 *
 * 왼쪽에 상시로 서는 자리를 23개 → **업무군 8 + 즐겨찾기 4 + 지원 2**로 줄인다. 🔴 **기능을 지우는 게
 * 아니라 입구를 줄이는 것**이다 — 아래 목적지 목록에 기존 화면이 전부 남아 있고, 라우트·권한·창은 불변이다.
 *
 * 🔴 **라벨·주소·아이콘은 여기서 새로 적지 않는다** — `navItemByKey(menuKey)`로 [`NAV_GROUPS`](./navigation.ts)에서
 *    가져온다(이름을 바꿀 때 한쪽만 바뀌는 것을 구조로 막는다). 여기서 더하는 것은 **한 줄 설명**과 **묶음**뿐.
 * 설정 면은 settings-role-catalog의 개별 권한, 나머지 면은 부모 메뉴의 권한을 따른다.
 * 🔴 업무군은 **자식 중 하나라도 접근 가능할 때** 선다(그룹에 대표 메뉴 한 개의 권한을 재사용하지 않는다).
 *    ECS(영어)와 MCS(수학)는 **독립 권한**이라 한쪽만 있는 계정도 자기 시트 버튼을 봐야 한다.
 */

export type HubDest = {
  /** 접근 판정 키. 면이면 부모 메뉴 키(면에는 별도 권한이 없다). */
  menuKey: MenuKey;
  href: string;
  label: string;
  icon: AywaIconName;
  /** 버튼 아래 한 줄 설명 — 없으면 안 적는다(지어내지 않는다). */
  desc?: string;
  /** 담당 반을 전제로 만든 화면 — 담당 반이 0인 사무실 계정에겐 눌러도 빈 화면이라 감춘다(권한 아님). */
  teacherOnly?: boolean;
  /** 이 목적지만 master 전용(예: 강사 정산) — 메뉴 권한과 별개의 화면 안 게이트를 화면이 이미 건다. */
  masterOnly?: boolean;
  /**
   * 새 학원(일반판)에만 서는 목적지 — 학원 설정 '기능' 면(모듈 켜기·끄기). 🔴 침산 화면은 이 작업 전과
   * 같아야 해서(원장 2026-09-22) 게이트가 모르면(`isGenericTenant` 미지정) **안 세운다**(침산 쪽으로 기운다).
   */
  genericOnly?: boolean;
  /**
   * `menuKey` 권한에 **더해** 이 권한도 열려 있어야 선다 — 셔틀 관리자 화면(`shuttle_admin`)은 셔틀 권한 위 조건이다(원장 2026-11-10).
   * 판정은 서버 문(`canOpenShuttleAdmin`)과 같은 두 권한 — 부모(셔틀)를 못 보는 사람에게 대신 입구로도 서지 않는다(`standInsOf`가 이 판정을 지난다).
   * (전에는 `adminOnly` — 코드의 원장·관리자 역할 비교였다. 2026-11-10 권한 줄로 바꿨다.)
   */
  alsoNeeds?: MenuKey;
  /** 업체리스트 지정자 전용(학원 설정 '개인별 기능 권한 · 업체리스트') — 판정은 `canViewVendorsNow` 한 벌(레이아웃이 계산해 넘긴다). */
  vendorsOnly?: boolean;
  /** 부차 도구 — 큰 버튼이 아니라 아래 작은 줄로 그린다(자주 쓰는 것과 가끔 쓰는 것을 가른다). */
  tool?: boolean;
  /** 설명 줄 안에서의 묶음 제목(설정처럼 목적지가 많은 허브에서만). */
  section?: string;
  /** 검색은 개명 전 이름으로도 찾을 수 있다. */
  originalLabel?: string;
  /**
   * **대신 입구 전용** 내부 탭 — 부모 메뉴 권한이 없는 사람에게만 부모 자리에 선다(`standInsOf`). 부모를 볼 수 있는 사람의 메뉴 지도·검색에는
   * 세우지 않는다(`innerTabsOf`). 자리 출석부처럼 화면 위 탭바가 아니라 드롭다운으로 닿는 면이라 부모 화면 안에서 이미 고를 수 있다.
   */
  standInOnly?: boolean;
};

export type HubGroup = {
  /** 사이드바·허브가 함께 쓰는 식별자. 🔴 `menuKey`가 아니다 — 업무군은 권한 축이 아니다. */
  id: string;
  label: string;
  icon: AywaIconName;
  /** 허브 머리의 한 줄 안내. */
  note?: string;
  /**
   * `direct` = 버튼 화면을 거치지 않고 바로 그 화면으로(운영실·캘린더·도움말).
   * `hub` = 본문에 버튼 목록을 띄운다.
   */
  kind: "direct" | "hub";
  items: HubDest[];
  hidden?: boolean;
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
  return { menuKey: settingMenuForHref(href) ?? parent, href, label, icon: item.icon, desc, ...extra };
}

const keep = (xs: (HubDest | null)[]): HubDest[] => xs.filter((x): x is HubDest => x !== null);

/** 수납 면 목록 — 사이드바 하부탭과 **같은 배열**에서 라벨·주소를 가져온다(두 벌 금지). */
function billingFace(href: string, desc?: string, extra?: Partial<HubDest>): HubDest | null {
  const tab = (SUBTABS_BY_MENU.billing ?? []).find((t) => t.href === href);
  return tab ? face("billing", tab.href, tab.label, desc, extra) : null;
}

// 시안 이식 탭의 그룹 아이콘 = 그 탭 한 줄(면)의 그림과 같다 — 같은 메뉴라 한 번만 센다(menu-glyph 중복 검사는 면의 그림을 본다).
const SAMPLE_GROUP_ICON = { organization: "target", marketing: "barChart" } as const;

export const HUB_GROUPS: HubGroup[] = [
  {
    id: "dashboard",
    label: "대시보드",
    icon: MENU_ICON.dashboard,
    kind: "direct",
    items: keep([fromMenu("dashboard")]),
  },
  // 시안(aywa-next 이식): 스키마·지식그래프 — 경영 분석 화면의 한 면. 권한 = '경영 분석·지식그래프'(management · 2026-11-09 권한 줄 정비 —
  // 전엔 대시보드 권한 + 코드의 원장·관리자 판정이었다). 페이지도 같은 권한으로 막는다(features/mockup/access.ts).
  // ⚠️ 시안 키들은 메뉴 정의(NAV_GROUPS)가 없다 — 그림을 `MENU_ICON.<키>`로 받는다(문자열로 적으면 menu-glyph 중복 검사가 같은 그림을 두 번 센다).
  {
    id: "knowledge-model", label: "스키마·지식그래프", icon: MENU_ICON.dashboard, kind: "direct",
    items: keep([face("dashboard", "/dashboard/management/knowledge", "스키마·지식그래프", "시트 설계 사전·실제 관계 지도·미입력 점검", { icon: MENU_ICON.management, menuKey: "management" })]),
  },
  // 🔴 **캘린더는 메뉴에 세우지 않는다** (원장 2026-09-10: *"캘린더 탭은 메뉴에서 제외시켜. 그냥 내부
  //    구글 달력용으로 사용할예정임."* → *"즉, 동기화하지만 외부로 보여주지않고 내부 끌어오기 참고용으로만 할것"*).
  //    표(`calendar_events`, 6,533행)와 라우트는 **그대로 산다** — 다른 기능이 읽어 쓰는 **재료**로 남기고
  //    사람이 드나드는 입구만 닫는 것이다. 지우면 그 재료가 함께 사라진다.
  {
    id: "class",
    label: "수업",
    icon: MENU_ICON.timetable,
    kind: "hub",
    note: "수업 전 계획부터 수업 기록, 검토·전달까지 이어서 처리합니다.",
    items: keep([
      fromMenu("timetable", "과목별 수업 배치·조회", { section: "1. 수업 전 · 계획" }),
      // 강사 시트는 영어·수학이 **독립 권한**이라 버튼도 둘이다(사이드바에선 한 줄 + 하부탭이었다).
      // 아이콘은 형제 한 쌍(열/행) — 나란히 서므로 같은 글리프를 쓰지 말 것.
      face("ecs", "/ecs", "영어 강사 시트", "영어 반별 주간 수업·진도", { section: "1. 수업 전 · 계획" }),
      { menuKey: "mcs", href: "/mcs", label: "수학 강사 시트", icon: MENU_ICON.mcs, desc: "수학 반별 월간 진도", section: "1. 수업 전 · 계획" },
      fromMenu("classes", "반 목록·반 정보 관리", { section: "1. 수업 전 · 계획" }),
      fromMenu("textbooks", "교재·차수별 진도·과제", { section: "1. 수업 전 · 계획" }),
      fromMenu("before_class_checklist", "수업 전 숙제·준비 체크", { section: "1. 수업 전 · 계획" }),
      face("attendance", "/attendance/live", "오늘 출결", "오늘 등원·확인 큐", { section: "2. 수업 중 · 기록", icon: "clipboardList" }),
      fromMenu("attendance", "월별 출석·정산", { section: "2. 수업 중 · 기록" }),
      fromMenu("teacher_onescreen", "담당 학생 수업 마감", { teacherOnly: true, section: "2. 수업 중 · 기록" }),
      fromMenu("lesson_reports", "목록·작성률·발송 관리", { section: "3. 수업 후 · 검토·전달" }),
      fromMenu("makeups", "보강 일정·실시 검토·미처리 업무", { section: "3. 수업 후 · 검토·전달" }),
      fromMenu("class_review", "수업 참관·평가 기록", { section: "3. 수업 후 · 검토·전달" }),
      // 출석부의 다른 면 — 자주 쓰는 자리는 위 버튼이고, 나머지는 작은 줄로. 설명도 둔다 — 탭 및 메뉴 구성에서 묶음을 바꾸면 큰 카드로 서는데
      // 설명이 없으면 빈 줄이 남는다(점검 2026-10-19).
      face("attendance", "/attendance/quick", "출결 모드", "내 반 빠른 출결", { tool: true, teacherOnly: true, icon: "listChecks" }),
    ]),
  },
  {
    id: "student",
    label: "원생",
    icon: MENU_ICON.students,
    kind: "hub",
    note: "원생 기록을 보고 성적을 관리합니다.",
    items: keep([
      fromMenu("students", "원생 명단·상세 기록"),
      face("students", "/students/care", "상담 약속·인계", "담당자 인수·미완료 약속·90일 이후 계속 관리"),
      fromMenu("student_contribution", "학생별 운영 기여·학습 참여·연결 기록"),
      fromMenu("exams", "시험 성적 입력·분석"),
    ]),
  },
  // 시안(aywa-next 이식): 신규생 90일 관리 = 왼쪽 한 줄(상담·재원 묶음에서 꺼냈다).
  {
    id: "newcomers",
    label: "신규생 90일 관리",
    icon: MENU_ICON.newcomers,
    kind: "direct",
    items: keep([fromMenu("newcomers", "신규생 90일 체크리스트·적응 확인")]),
  },
  {
    id: "counsel",
    label: "상담·재원",
    icon: MENU_ICON.consultations,
    kind: "hub",
    note: "상담부터 재원 관리까지의 흐름입니다.",
    items: keep([
      fromMenu("consultations", "재원생 상담 기록"),
      fromMenu("enrollment", "상담 접수·반 배정"),
      fromMenu("retention", "이탈 위험 원생 관리"),
      fromMenu("withdrawals", "퇴원·수강 종료 기록"),
      fromMenu("withdrawal_reports", "강사 작성·순차 승인"),
    ]),
  },
  // 수납관리 = 수납 · 교재 · 지출 버튼(원장 2026-10-15 *"교재와 지출은 수납에서 따로 내부탭에서 빼서 이전처럼 만들것"* — 10-14에 내부 탭으로
  // 접었던 것을 되돌렸다). 환불 요청서·수강료 계산기·회차 확정은 그 화면 위 탭으로만 오간다(아래 `INNER_TABS`).
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
    ]),
  },
  {
    id: "operation",
    label: "학원운영",
    icon: MENU_ICON.staff,
    kind: "hub",
    note: "직원·차량·비품을 관리합니다.",
    items: keep([
      fromMenu("staff", "명부·급여·연차·휴가"),
      fromMenu("shuttle", "노선 편성·등하원 기록"),
      fromMenu("inventory", "자산·대여·실사·소모품"),
      // 업체리스트(거래처 연락처) — 재고관리 안의 탭이지만 지정자에겐 입구를 따로 세운다(원장 2026-10-26 *"안보임 추가해서
      // 나만 보게"* — 탭만 있으면 메뉴 판·검색에서 찾을 수 없었다). 지정자 아니면 안 선다(탭·조회 게이트와 같은 판정).
      face("inventory", "/inventory?tab=vendors", "업체리스트", "거래처 연락처", { vendorsOnly: true }),
      // 학부모 관리 현황 — 원장·관리자 전용. 셔틀 탭 줄에는 없고 입구는 여기 하나다(navigation.ts 주석).
      // ⚠️ 아이콘을 따로 안 준다 — 남은 스티커 중 '학부모'에 맞는 그림이 없어 셔틀 그림을 물려받는다.
      face("shuttle", SHUTTLE_PARENTS_PATH, "학부모 관리 현황", "학부모 계정·연결 원생", { tool: true, menuKey: "shuttle_admin", alsoNeeds: "shuttle" }),
    ]),
  },
  // 시안(aywa-next 이식): 조직·OKR · 홍보·마케팅. 권한 = 제 키(okr · marketing — 2026-11-09 권한 줄 정비. 전엔 대시보드 권한으로 메뉴만 세우고
  // 페이지는 코드의 원장·관리자·매니저 판정이라 상담·회계·열람은 메뉴를 눌러도 대시보드로 돌아갔다). 페이지도 같은 권한(각 sample-access.ts).
  {
    id: "organization", label: "조직·OKR", icon: SAMPLE_GROUP_ICON.organization, kind: "direct",
    items: keep([face("dashboard", "/organization/okr", "조직·OKR", "조직 목표·내 핵심결과·실행·주간 점검·피드백", { icon: MENU_ICON.okr, menuKey: "okr" })]),
  },
  {
    id: "marketing", label: "홍보·마케팅", icon: SAMPLE_GROUP_ICON.marketing, kind: "hub",
    note: "연간 홍보·행사 기록부터 채널 성과와 학생 유입까지 연결합니다.",
    items: keep([
      face("dashboard", "/marketing", "연간 운영계획", "행사 기획·준비 일정·담당 업무·초대와 참석·회고", { icon: "send", menuKey: "marketing" }),
      face("dashboard", "/billing/management/marketing", "홍보·마케팅", "연간 마케팅 지도·행사 기록·채널별 성과", { icon: MENU_ICON.marketing, menuKey: "marketing" }),
    ]),
  },
  // 🔴 **회의록은 업무군에 넣지 않고 왼쪽 탭 한 줄로 세운다** (원장 2026-09-10:
  //    *"회의록은 따로 왼쪽 탭으로 빼주고"*). `direct`라 누르면 메뉴 판을 거치지 않고 바로 열린다.
  //    ⚠️ 업무군에서 뺐다고 권한이 달라지지 않는다 — menuKey는 그대로 `meetings`다.
  {
    id: "meetings",
    label: "회의록",
    icon: MENU_ICON.meetings,
    kind: "direct",
    items: keep([fromMenu("meetings")]),
  },
  {
    id: "document",
    label: "문서·결재",
    // ⚠️ 회의록이 빠지면서 아이콘도 넘겨줬다 — 같은 글리프를 두 줄이 쓰면 어느 줄인지 안 읽힌다.
    icon: MENU_ICON.approvals,
    kind: "hub",
    note: "기록과 결재 문서입니다.",
    items: keep([
      fromMenu("approvals", "기안·결재함"),
      // 업무 작성센터(시안) — 권한 = 제 키(work_records · 2026-11-09). 전엔 메뉴는 데이터베이스 권한, 페이지는 대시보드 권한이라 둘이 갈렸다.
      face("documents", "/work-records", "업무 작성센터", "내 계정으로 수업·상담·업무 서식 작성", { icon: MENU_ICON.work_records, menuKey: "work_records" }),
      fromMenu("documents", "서식·문서 저장소"),
    ]),
  },
];

/**
 * 화면 안 **내부 탭**(면) — 메뉴(탭 및 메뉴 구성 · 사이드바 · 메뉴 판 · 휴대폰 메뉴)에 **따로 세우지 않는다**
 * (예외 = 수납의 교재·지출은 메뉴 버튼 — 원장 2026-10-15 *"이전처럼"*)
 * (원장 2026-10-14 *"내부 탭에 있는 메뉴는 따로 탭 및 메뉴 구성에 넣지 말것"* — 2026-09-02 재고관리 *"내부탭은 왼쪽 탭에서
 * 안보여도 돼 … 그냥 '재고관리' 1개"*와 같은 결). 그 화면 위 탭바(FaceTabs)로 오간다.
 * 🔴 여기 적는 것은 **부모 화면 위 탭바에 실제로 있는 면**뿐이다 — 탭바가 없는 화면(오늘 출결 `/attendance/live` · 출결 모드)은
 *    메뉴에서 빼면 갈 길이 없어 위 업무군에 그대로 둔다. 예외 = `standInOnly`(자리 출석부 — 부모 화면의 드롭다운으로 닿는 면, 대신 입구로만 쓴다).
 * 이 목록을 읽는 곳 = 검색 팰릿·메뉴 지도(Shift+F, `innerTabsOf` — 탭바의 버튼도 이름으로 찾혀야 한다 · 부모 메뉴가 보일 때만 · `standInOnly` 제외) ·
 * 글의 메뉴 링크(멘션) · 권한 표(같은 권한의 탭은 그 줄의 감춤 판정에 센다) · 부모 권한 없이 탭 권한만 받은 사람의 대신 입구(`hubGroupsFor`).
 * ⚠️ 메뉴 구성의 저장값은 이 주소들을 모른다(읽을 때 지워진다 — `normalizeNavigationSettings`). 이름·숨김은 그 화면의 탭이 정한다.
 */
export const INNER_TABS: { parent: string; items: HubDest[] }[] = [
  {
    // 자리 출석부(랩실·JJ실) — 출석부 화면 안 **강사 드롭다운의 한 갈래**라 메뉴에 따로 세우지 않는다(원장 2026-08-14 "따로 빼지말고").
    // 여기 적는 까닭은 **대신 입구**다: 출석부(`attendance`) 권한은 없고 `seat_attendance`만 받은 사람(아르바이트 등)은
    // 출석부 화면에 못 들어가 그 드롭다운까지 닿지 못했다 — 출석부를 열어 주면 다른 선생님 출석부가 다 보이고,
    // 닫으면 자리 출석부로 갈 길이 없었다(원장 2026-11-05). 이제 그런 사람에겐 출석부 자리에 이 둘이 대신 선다(`standInsOf`).
    // 출석부 권한이 있는 사람에겐 메뉴가 바뀌지 않는다 — 대신 입구는 부모를 못 볼 때만 서고, `standInOnly`라 메뉴 지도·검색(`innerTabsOf`)에도 안 선다.
    parent: "/attendance",
    items: keep(
      USABLE_SEAT_KEYS.map((k) =>
        face("attendance", `/attendance/seat/${k}`, `${SEAT_NAME[k]} 출석부`, undefined, {
          menuKey: "seat_attendance",
          icon: MENU_ICON.seat_attendance,
          standInOnly: true,
        }),
      ),
    ),
  },
  {
    parent: "/lesson-reports",
    items: keep([
      face("lesson_reports", "/lesson-reports?tab=report", "보고서 설정", undefined, { icon: MENU_ICON.report_settings }),
      face("lesson_reports", "/lesson-reports?tab=ai_ment", "AI 멘트", undefined, { icon: MENU_ICON.ai_ment }),
    ]),
  },
  {
    parent: "/billing",
    items: keep([
      // 교재·지출은 메뉴 버튼이다(위 수납관리 — 원장 2026-10-15) · 여기엔 탭으로만 오가는 면만.
      billingFace("/billing?tab=refunds", "환불 요청서 처리", { icon: "undo" }),
      billingFace("/billing?tab=calculator"),
      billingFace("/billing?tab=sessions"),
    ]),
  },
  {
    parent: "/shuttle",
    items: keep([
      // 탑승 학생 시간표(2026-10-27) — 노선 편성 바로 뒤 · 🔒 '셔틀 관리자 화면' 권한(shuttle_admin · 셔틀 권한 위 조건 — 화면은 isShuttleAdmin 404).
      face("shuttle", "/shuttle/classes", "탑승 학생 시간표", undefined, { icon: "layers", menuKey: "shuttle_admin", alsoNeeds: "shuttle" }),
      face("shuttle", "/shuttle/week", "주간 시간표", undefined, { icon: "calendarClock" }),
      face("shuttle", "/shuttle/today", "오늘 등하원", undefined, { icon: "busStop" }),
      face("shuttle", "/shuttle/parent-rides", "학부모 등하원"),
      face("shuttle", "/shuttle/live", "운행 현황", undefined, { icon: "steering" }),
      // 실시간 위치 — 같은 '셔틀 관리자 화면' 권한(전엔 표식이 없어 검색에 셔틀을 보는 모두에게 섰다가 눌러도 404였다).
      face("shuttle", "/shuttle/track", "실시간 위치", undefined, { icon: "mapPin", menuKey: "shuttle_admin", alsoNeeds: "shuttle" }),
      // 가까운 노선 찾기(2026-10-27) — 학부모 탭 4와 같은 화면 · 🔒 '셔틀 관리자 화면' 권한(화면은 isShuttleAdmin 404).
      face("shuttle", "/shuttle/nearby", "가까운 노선 찾기", undefined, { icon: "search", menuKey: "shuttle_admin", alsoNeeds: "shuttle" }),
    ]),
  },
];

/**
 * 설정 면마다의 그림 — 면 목록(tabs.ts)은 순수 상수 모듈이라 그림은 여기서 붙인다(면을 더하면 타입이 이 표를 요구한다).
 * ⚠️ 부모(설정) 그림을 물려받으면 버튼이 전부 같은 톱니가 된다(원장 캡처 2026-09-07).
 * 🔴 그림은 **다른 메뉴가 안 쓰는 것**으로 고른다(가드 `menu-glyph.test.ts`). 같은 메뉴(학원 설정) 안의 '데이터 가져오기'와
 *    '연동'은 같은 `sync`를 쓴다 — "옮겨 오기"에 맞는 남은 그림이 없다(upload는 탭 그림 파일이 없다).
 * 🔴 값을 `{ icon: "…" }` 모양으로 적는 것은 그 가드 때문이다 — 가드는 이 파일의 `icon: "이름"`을 읽어 그림이 있는지 ·
 *    다른 메뉴와 겹치는지를 본다. 값을 맨 문자열로 적으면 가드가 이 표를 못 본다(적대 리뷰 4 C2).
 */
const OWNER_FACE_ICON: Record<OwnerFaceKey, { icon: AywaIconName }> = {
  profile: { icon: MENU_ICON.profile_settings },
  operations: { icon: MENU_ICON.operations_settings },
  subjects: { icon: "tag" },
  makeups: { icon: MENU_ICON.makeups },
  evaluation: { icon: "gauge" },
  // 원생 기여도 설정 = 원생 기여도 메뉴의 설정이라 그 메뉴 그림을 물려받는다(makeups·dashboard 면과 같은 결).
  // clipboardList는 '오늘 출결' 면이 쓴다(2026-10-22 겹침 해소).
  contribution: { icon: MENU_ICON.student_contribution },
  billing: { icon: MENU_ICON.billing_settings },
  notifications: { icon: MENU_ICON.notification_settings },
  consultations: { icon: MENU_ICON.consultation_settings },
  permissions: { icon: "key" },
  navigation: { icon: MENU_ICON.navigation_settings },
  modules: { icon: "sparkle" },
  dashboard: { icon: MENU_ICON.dashboard },
  popups: { icon: MENU_ICON.popup_settings },
  data: { icon: "eraser" },
  import: { icon: "sync" },
  audit: { icon: "history" },
  sheets: { icon: "sync" },
};

/** 하단 지원 줄 — 고객센터 · 설정(면이 많아 허브) · 도움말(바로 연다). */
export const SUPPORT_GROUPS: HubGroup[] = [
  // 고객센터(0294a) — 지원 묶음 **맨 위**(원장 2026-09-28 *"고객센터, 지원, 도움말 순서로"* → 고객센터 · 설정 · 도움말).
  // 공지사항·개선요청은 화면 안 탭바로 오간다(면이 둘뿐이라 허브를 거치지 않고 바로 연다).
  {
    id: "support",
    label: "고객센터",
    icon: MENU_ICON.support,
    kind: "direct",
    items: keep([fromMenu("support")]),
  },
  {
    id: "owner",
    label: "설정",
    icon: MENU_ICON.owner,
    kind: "hub",
    note: "학원 설정을 범주별로 고릅니다.",
    // 🔴 버튼·범주는 **설정 면 목록**(`OWNER_FACES`, features/owner/tabs.ts)에서 파생한다 — 여기에 면을 다시 적지 않는다.
    //    전에는 이 판이 같은 면을 제 목록으로 따로 들고 있어 라벨과 묶음이 화면 탭과 갈렸다. 주소·권한·화면은 그대로다
    //    (면을 합치지 않는다 — 합치면 라우트·조회가 바뀐다). 권한 키는 `face()`가 주소에서 정한다(면별 설정 권한).
    items: keep([
      ...OWNER_FACES.map((f) =>
        face("owner", f.href, f.label, undefined, {
          section: f.category,
          icon: OWNER_FACE_ICON[f.key].icon,
          ...(f.masterOnly ? { masterOnly: true } : {}),
          ...(f.genericOnly ? { genericOnly: true } : {}),
        }),
      ),
      // 키오스크 설정 — 설정의 면이 아니라 따로 선 화면(`/kiosk-settings`)이고 권한도 따로다(`kiosk_settings`).
      // 입구가 키오스크 화면 안의 링크 하나뿐이라 관리 화면에서는 갈 길이 없었다(2026-10-06). 기능을 끈 학원에서는 그 권한이
      // 닫혀 버튼이 서지 않는다(권한 표가 꺼진 기능을 반영한다).
      { menuKey: "kiosk_settings", href: "/kiosk-settings", label: MENU_LABEL.kiosk_settings, icon: MENU_ICON.kiosk_settings, section: "관리" },
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

export type HubGate = Gate;

type Gate = {
  systemRole: SystemRole;
  permMatrix?: AccessMatrix;
  /** 겸직(담당 반 보유) — `teacherOnly` 목적지의 쓸모 판정(사이드바와 같은 규약). */
  canTeacherView?: boolean;
  /**
   * master 전용 목적지 노출 — 🔴 **'master 이상'이라는 뜻이다**(총괄 포함). 총괄(super_admin)은 역할이
   * 아니라 별도 표라 `users.system_role`이 'admin'인 사람이 실제로 있고, 여기에 `systemRole === "master"`만
   * 넣으면 총괄이 자기 시스템에서 잠긴다(결정 로그 2026-08-13). 호출부는 `|| isSuperAdmin`을 함께 준다.
   */
  isMaster?: boolean;
  /**
   * 학원 설정 '왼쪽 탭'(`navigation.menus`) — **보기만** 정한다. 권한이 아니다:
   * 여기서 켜도 권한이 없으면 안 서고, 여기서 꺼도 주소를 치면 열린다([[#77]]).
   * 비면(기본) 지금과 글자 그대로 같다 — 전부 표시·코드 순서. 규약 = [`menu-layout.ts`](@/features/owner/menu-layout).
   */
  menuLayout?: MenuLayout;
  groupLayout?: MenuGroupLayout;
  /** 새 학원(일반판)인가 — `genericOnly` 목적지('기능' 면)의 노출. 모르면 false(침산처럼). */
  isGenericTenant?: boolean;
  /** 업체리스트 지정자인가 — `vendorsOnly` 목적지의 노출. 모르면 false(닫힌 쪽). */
  canViewVendors?: boolean;
};

function allowed(dest: HubDest, gate: Gate): boolean {
  if (!canAccess(gate.systemRole, dest.menuKey, gate.permMatrix)) return false;
  if (dest.teacherOnly && !gate.canTeacherView) return false;
  if (dest.masterOnly && !gate.isMaster) return false;
  if (dest.genericOnly && !gate.isGenericTenant) return false;
  if (dest.vendorsOnly && !gate.canViewVendors) return false;
  // 셔틀 관리자 화면 = 셔틀 권한 위 조건(서버 canOpenShuttleAdmin과 같은 두 권한).
  if (dest.alsoNeeds && !canAccess(gate.systemRole, dest.alsoNeeds, gate.permMatrix)) return false;
  // 🔴 권한 **뒤에** 본다 — 순서를 바꿔도 결과는 같지만, "권한이 먼저 거른다"가 이 설정의 정의다.
  if (isMenuHiddenByLayout(dest.href, gate.menuLayout)) return false;
  return true;
}

/**
 * 이 사람에게 보이는 업무군 — 자식이 하나도 없으면 그 업무군은 서지 않는다(죽은 입구 금지).
 * 업무군 **안**의 순서는 학원 설정을 따른다(`menuLayout`) — 저장값이 없으면 코드 순서 그대로.
 */
export function hubGroupsFor(groups: HubGroup[], gate: Gate): HubGroup[] {
  return configuredHubGroups(groups, gate.menuLayout, gate.groupLayout)
    .filter((g) => !g.hidden)
    .map((g) => ({
      ...g,
      // 대신 입구는 부모 자리에 선다(정렬 뒤에 바꾼다 — 탭 주소엔 저장된 순서가 없다).
      items: sortByMenuLayout(g.items.filter((d) => allowed(d, gate) || standInsOf(d, gate).length > 0), gate.menuLayout)
        .flatMap((d) => (allowed(d, gate) ? [d] : standInsOf(d, gate))),
    }))
    .filter((g) => g.items.length > 0);
}

/**
 * 부모 메뉴 권한은 없는데 그 화면 위 탭 중 **따로 권한이 있는 면**(보고서 설정 · AI 멘트)만 받은 사람의 입구 — 그 탭을 부모 자리에 대신 세운다.
 * 내부 탭은 메뉴에 따로 세우지 않지만(원장 2026-10-14), 이런 사람은 부모 화면(수업보고서)에 못 들어가 탭바까지 닿지 못한다(리뷰 2026-10-14).
 * 부모를 볼 수 있으면(권한 있음) 대신 세우지 않는다 · 부모를 메뉴 구성에서 감췄으면 이 사람에게도 감춘다.
 */
function standInsOf(parent: HubDest, gate: Gate): HubDest[] {
  if (canAccess(gate.systemRole, parent.menuKey, gate.permMatrix) || isMenuHiddenByLayout(parent.href, gate.menuLayout)) return [];
  // 대신 입구 전용 탭(`standInOnly`)도 여기선 선다 — 그래서 `innerTabsOf`(전용 탭을 뺀다)가 아니라 목록을 직접 거른다.
  return (INNER_TABS.find((t) => t.parent === parent.href)?.items ?? []).filter((t) => t.menuKey !== parent.menuKey && allowed(t, gate));
}

/** 모든 표면이 공유하는 배치 해석. 외부 입력으로 목적지/권한을 만들지 않는다. */
export function configuredHubGroups(groups: readonly HubGroup[], menus?: MenuLayout, layout?: MenuGroupLayout, includeCustomGroups = groups.some((g) => g.id === "dashboard")): HubGroup[] {
  const rows = normalizeMenuRows(menus);
  const groupRows = normalizeGroupRows(layout);
  const overrides = new Map(groupRows.map((r) => [r.id, r]));
  const definitions = [...groups];
  // 새 탭은 업무 영역에만 더한다. 지원 목록만 해석하는 호출에는 더하지 않는다.
  if (includeCustomGroups) {
    for (const row of groupRows) {
      if (!definitions.some((g) => g.id === row.id) && row.id.startsWith("custom-") && row.label) {
        definitions.push({ id: row.id, label: row.label, icon: row.icon ?? "folder", kind: "hub", items: [] });
      }
    }
  }
  const result = definitions.map((g) => {
    const row = overrides.get(g.id);
    return { ...g, label: row?.label ?? g.label, icon: row?.icon ?? g.icon,
      ...(row?.label ? { note: undefined } : {}), hidden: row?.hidden, items: [] as HubDest[] };
  });
  const byId = new Map(result.map((g) => [g.id, g]));
  for (const originalGroup of groups) for (const item of originalGroup.items) {
    const row = rows.find((r) => r.href === item.href);
    const target = !isFixedDestination(item.href) && row?.groupId && byId.has(row.groupId) && !FIXED_GROUP_IDS.has(row.groupId)
      ? byId.get(row.groupId)! : byId.get(originalGroup.id)!;
    const customized = applyMenuPresentation(item, rows);
    // 명시적 재배치는 사용자가 지정한 목록 순서를 그대로 그린다(도구/범주 재분류 방지).
    target.items.push({ ...customized, originalLabel: item.label,
      ...(row?.groupId ? { tool: false, section: undefined } : {}) });
  }
  return result.map((g) => ({ ...g,
    kind: g.kind === "direct" && (g.items.length !== 1 || g.items[0]?.href !== definitions.find((d) => d.id === g.id)?.items[0]?.href) ? "hub" as const : g.kind,
    items: sortByMenuLayout(g.items, rows),
  })).sort((a, b) => {
    if (a.id === "dashboard") return -1;
    if (b.id === "dashboard") return 1;
    // 지원 고정 항목은 항상 아래에 남는다.
    const supportRank = (id: string) => id === "support" ? 1 : id === "owner" ? 2 : id === "help" && overrides.get(id)?.order === undefined ? 3 : 0;
    if (supportRank(a.id) !== supportRank(b.id)) return supportRank(a.id) - supportRank(b.id);
    return (overrides.get(a.id)?.order ?? 199) - (overrides.get(b.id)?.order ?? 199);
  });
}

/**
 * 이 메뉴 화면 위 탭바의 면 — 검색 팰릿이 그 메뉴 바로 뒤에 싣는다. 권한(면마다의 권한 키)·꺼진 모듈의 면은 메뉴와 같은 게이트로 거른다.
 * `parentHref`는 **이 사람에게 보이는** 메뉴의 주소여야 한다(부모가 안 보이면 면도 안 선다 — 호출부가 `hubGroupsFor`의 결과로 부른다).
 */
export function innerTabsOf(parentHref: string, gate: Gate): HubDest[] {
  return (INNER_TABS.find((t) => t.parent === parentHref)?.items ?? []).filter((d) => !d.standInOnly && allowed(d, gate));
}

/**
 * '자주 방문한 메뉴' 줄 — 방문 기록 순서(`keys`)를 목적지로 바꾼다. 권한이 없으면 그 줄만 빠진다.
 * ⚠️ 기록이 비면 첫 화면용 기본값으로 떨어진다(빈 자리를 남기지 않는다).
 */
export function frequentFor(gate: Gate, keys?: readonly MenuKey[]): HubDest[] {
  const source = keys && keys.length > 0 ? keys : DEFAULT_FREQUENT_KEYS;
  const configured = configuredHubGroups([...HUB_GROUPS, ...SUPPORT_GROUPS], gate.menuLayout, gate.groupLayout).filter((g) => !g.hidden).flatMap((g) => g.items);
  return keep(source.map((k) => {
    const original = fromMenu(k);
    return original ? configured.find((d) => d.href === original.href) ?? null : null;
  }))
    .filter((d) => allowed(d, gate))
    // 🔴 **메뉴에서 감춘 항목은 여기에도 안 뜬다** — 감추기 전에 쌓인 방문 기록이 남아 있어서,
    //    이 줄이 없으면 사이드바에서 뺀 메뉴가 '자주 방문한 메뉴'로 되살아난다(캘린더가 그랬다,
    //    원장 2026-09-10 *"캘린더 탭은 메뉴에서 제외시켜"*). 앞으로 감출 메뉴도 이 규칙을 그냥 물려받는다.
    //    ⚠️ `navItemByKey`는 **첫 항목**을 돌려주므로, 하위 면만 hidden인 메뉴(수납·셔틀 등)는 안 걸린다.
    .filter((d) => navItemByKey(d.menuKey)?.hidden !== true);
}

/**
 * 검색 팰릿(Shift+F)이 이 **목적지**를 찾는 데 쓰는 말 뭉치.
 *
 * 🔴 팰릿의 메뉴 축은 이제 여기(HUB 목적지)를 읽는다 — 전엔 `NAV_GROUPS`만 읽어서, 메뉴 화면엔 있는데
 *    검색으론 못 가는 목적지가 23개 있었다(수학 강사 시트 · 수납 6면 · 학원 설정 11면 · 오늘 출결·출결 모드 · 셔틀 3면).
 *    사람이 눈으로 본 버튼은 이름으로도 찾혀야 한다 — 메뉴에서 뺀 화면 위 탭(`INNER_TABS`)도 팰릿이 부모 메뉴 뒤에 싣는다.
 * 🔴 **별칭은 그 메뉴 자신에게만** 붙인다(`href`가 메뉴 정의와 같을 때) — 면(`/billing?tab=…`)이 부모
 *    별칭을 물려받으면 "청구" 한 번에 수납 면 7개가 통째로 선다. 별칭 규칙 자체는
 *    [`menuSearchKeywords`](./navigation.ts) 한 곳이 정한다(두 벌로 적지 않는다).
 */
export function hubSearchKeywords(dest: HubDest, groupLabel: string): string {
  const item = navItemByKey(dest.href === "/owner" ? "owner" : dest.menuKey);
  const own = item && item.href === dest.href ? menuSearchKeywords(item, groupLabel) : "";
  // 면은 제 라벨 + 업무군 + 부모 권한키로 찾는다(부모 라벨은 own이 있을 때만 실린다).
  return `${dest.label} ${dest.originalLabel ?? ""} ${groupLabel} ${dest.menuKey} ${own}`.toLowerCase();
}

/** 메뉴 검색의 한 줄 — 목적지 + 업무군 이름 + 찾는 말 뭉치. */
export type HubSearchEntry = {
  dest: HubDest;
  group: string;
  /** 업무군 식별자·아이콘 — 사이드바 '메뉴 지도'가 업무군별로 묶어 그린다. */
  groupId: string;
  groupIcon: AywaIconName;
  keywords: string;
};

/**
 * 메뉴 검색이 찾는 **전체 목록** — 검색 팰릿(Shift+F)과 사이드바 메뉴 검색이 함께 쓴다(원장 2026-10-19
 * *"좌측 메뉴에서 메뉴 검색하는 검색창"*). 🔴 두 곳이 목록을 따로 만들면 한쪽에서만 찾히는 화면이 생긴다.
 * 차례 = 업무군 순서대로 메뉴 판의 버튼 → 그 뒤에 그 화면 위 탭(`innerTabsOf`, 부모 메뉴가 보일 때만).
 */
export function hubSearchEntries(gate: Gate): HubSearchEntry[] {
  return hubGroupsFor([...HUB_GROUPS, ...SUPPORT_GROUPS], gate).flatMap((group) =>
    [...group.items, ...group.items.flatMap((item) => innerTabsOf(item.href, gate))].map((dest) => ({
      dest,
      group: group.label,
      groupId: group.id,
      groupIcon: group.icon,
      keywords: hubSearchKeywords(dest, group.label),
    })),
  );
}

/**
 * 검색어로 거른다 — 부분 일치(대소문자 무시). **띄어쓰기는 무시한다**("학생 목록"으로 "학생목록"도, 그 반대도).
 * 순서 = 라벨이 검색어로 **시작** → 라벨에 **포함** → 별칭·업무군으로만 걸림(같은 칸 안에선 원래 차례 유지).
 */
export function matchHubSearch(entries: readonly HubSearchEntry[], query: string): HubSearchEntry[] {
  const compact = (v: string) => v.toLowerCase().replace(/\s+/g, "");
  const q = compact(query);
  if (!q) return [];
  const rank = (e: HubSearchEntry) => {
    const label = compact(e.dest.label);
    return label.startsWith(q) ? 0 : label.includes(q) ? 1 : 2;
  };
  return entries
    .filter((e) => e.keywords.includes(query.trim().toLowerCase()) || compact(e.keywords).includes(q))
    .map((e, i) => ({ e, i, r: rank(e) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.e);
}

/** 메뉴 지도의 한 묶음 — 업무군 하나와 그 안의 (걸러진) 메뉴. */
export type HubSearchGroup = { id: string; label: string; icon: AywaIconName; items: HubSearchEntry[] };

/**
 * 사이드바 **메뉴 지도**(원장 2026-10-19 *"수업) 수업목록·시간표 / 원생) 원생목록 … 지도처럼 촤라락 펼쳐지게 + 검색"*)의
 * 묶음 — 검색어가 없으면 **전부**(업무군 순서 그대로), 있으면 `matchHubSearch`가 고른 것만.
 * 검색 중엔 가장 잘 맞는 메뉴가 든 업무군이 앞으로 온다(업무군 안 순서도 매칭 순위). `flat` = 키보드 이동 순서(그린 순서와 같다).
 */
export function groupHubSearch(entries: readonly HubSearchEntry[], query: string): { groups: HubSearchGroup[]; flat: HubSearchEntry[] } {
  const picked = query.trim() ? matchHubSearch(entries, query) : [...entries];
  const byId = new Map<string, HubSearchGroup>();
  for (const e of picked) {
    let g = byId.get(e.groupId);
    if (!g) byId.set(e.groupId, (g = { id: e.groupId, label: e.group, icon: e.groupIcon, items: [] }));
    g.items.push(e);
  }
  const groups = [...byId.values()];
  return { groups, flat: groups.flatMap((g) => g.items) };
}

/**
 * 지금 보고 있는 주소가 속한 업무군 — 사이드바의 현재 위치 표시와 '← …으로 돌아가기'에 쓴다.
 * 접두가 겹치면 **더 긴 경로**가 이긴다(`/attendance` ⊂ `/attendance/live`, 사이드바 하부탭과 같은 규약).
 */
export function hubGroupOfPath(pathname: string, groups: HubGroup[] = [...HUB_GROUPS, ...SUPPORT_GROUPS]): HubGroup | undefined {
  const dest = hubDestinationForPath(pathname, groups.flatMap((g) => g.items));
  return dest ? groups.find((g) => g.items.includes(dest)) : undefined;
}

/** query 면은 더 구체적인 목적지가 이긴다. embed·날짜·필터는 목적지 정체성을 바꾸지 않는다. */
export function hubDestinationForPath(href: string, items: readonly HubDest[] = [...HUB_GROUPS, ...SUPPORT_GROUPS].flatMap((g) => g.items)): HubDest | undefined {
  let url: URL;
  try { url = new URL(href, "https://navigation.invalid"); } catch { return undefined; }
  let best: HubDest | undefined;
  let score = -1;
  for (const item of items) {
    const candidate = new URL(item.href, url.origin);
    if (url.pathname !== candidate.pathname && !url.pathname.startsWith(`${candidate.pathname}/`)) continue;
    if ([...candidate.searchParams].some(([k, v]) => url.searchParams.get(k) !== v)) continue;
    const next = candidate.pathname.length * 100 + candidate.searchParams.size;
    if (next > score) { best = item; score = next; }
  }
  return best;
}
