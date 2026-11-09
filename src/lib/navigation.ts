import type { LucideIcon } from "@/components/icons/aywa-icon-compat";
import { MENU_ICON, type AywaIconName } from "@/components/icons/aywa-icons";
import { canAccess, TEACHER_MENU_KEYS, type AccessMatrix, type MenuKey, type SystemRole } from "@/lib/permissions";
import { OWNER_TABS } from "@/features/owner/tabs";
import { SETTINGS_ROLE_KEYS } from "@/lib/settings-role-catalog";

export type NavItem = {
  href: string;
  label: string;
  icon: AywaIconName;
  menuKey: MenuKey;
  /**
   * 데스크톱 셸에서 이 메뉴를 표시하는 방식. 생략하면 기존처럼 플로팅 창(`window`)으로 연다.
   * `desktop`은 셸의 main 자체가 작업면이며 iframe 창을 만들지 않는다.
   */
  presentation?: "desktop" | "window";
  // 사이드바·모바일내비·팰릿에선 숨기되 findNavItem(창 해석)·아이콘맵엔 남긴다.
  // 예: 등록상담은 "상담" 메뉴의 FaceTabs 면이라 사이드바엔 안 뜨지만 창/링크 해석은 필요.
  // 🔑 강사 '내 메뉴'도 이 표식을 따른다 — 메뉴에서 뺀 항목은 거기서도 닫힌다([teacherMenuKeysFor]).
  //    강사 드롭다운이 유일한 입구인 면은 아래 `teacherMenuEntry`로 남긴다.
  hidden?: boolean;
  /**
   * `hidden`이어도 **강사 '내 메뉴'에는 남는다** — 사이드바·팰릿엔 없고 강사 드롭다운이 유일한 입구인
   * 강사 전용 면(교재 요청·지출결의서)의 표식. `hidden` 없이 달면 아무 뜻이 없다(가드가 막는다).
   * 🔑 이 예외를 **NAV 표 한 곳**에 적는 이유: 강사 메뉴 쪽에 명단을 따로 두면 "메뉴에서 뺐다"가 입구마다
   *    갈린다 — 캘린더를 메뉴에서 뺐는데(원장 2026-09-10) 강사 드롭다운에만 남아 있던 게 그 실례다(2026-09-11).
   */
  teacherMenuEntry?: boolean;
  /**
   * **사이드바에서만** 이 메뉴를 부모 메뉴의 하부탭으로 내려 표시한다(독립 라우트·독립 창 유지).
   * `hidden`과 다른 점: 팰릿·모바일내비엔 그대로 남아 검색·이동이 된다(발견성 보존).
   * 창 id·권한키는 자기 menuKey를 그대로 쓰므로 창 크기(routeWindowSize)도 자기 것이다.
   * 현재 사용처 0 — English Class Sheet가 썼으나(2026-07-29) 독립 사이드바 탭으로 승격되며
   * 떼었다(원장 지시 2026-08-17). 메커니즘은 다음 하위 카테고리 메뉴를 위해 보존.
   */
  subOf?: MenuKey;
  /**
   * 검색 팰릿(Shift+F)에서만 쓰는 **다른 이름**. 화면엔 절대 안 나온다(라벨은 여전히 `label` 하나뿐).
   *
   * 계기(원장 2026-09-09): *"'신입생 관리' 탭을 만들었는데 찾을 수가 없네."* 라벨은 "신규생 관리"라
   * 팰릿 키워드(`라벨+그룹+영문키`)에 **"신입생"이 한 글자도 없어서 검색 결과가 0건**이었다.
   *
   * 🔴 **라벨 변경이 아니다** — 축이 다르다. 라벨은 "이 화면의 이름", 별칭은 "사람이 부르는 말"이라
   *    [[라벨만 바꾼다]] 규약(데이터 바인딩을 갈아끼우지 말 것)과 충돌하지 않는다.
   * 🔴 **추측 금지** — 근거 있는 것만 넣는다: ① 예전 라벨(개칭 전에 부르던 이름) ② 코드·결정 로그가
   *    그 화면을 실제로 그렇게 부르는 말. "이렇게 부를 것 같다"는 넣지 않는다(엉뚱한 화면이 검색에 뜬다).
   * ⚠️ 다른 메뉴의 **라벨과 같은 말**은 넣을 수 없다(가드가 막는다) — 넣으면 "출석부"를 쳤을 때
   *    엉뚱한 메뉴가 함께 서서 검색이 오히려 더 나빠진다.
   */
  aliases?: readonly string[];
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

// 시간표는 하부탭이 없다 — 숨겨 두었던 '시간표(개발중)·월별 비교' 두 면은 2026-10-23 화면째 지웠다(편집기로 대체).
export const SUBTABS_BY_MENU: Partial<Record<MenuKey, SubTab[]>> = {
  billing: [
    { label: "수납", href: "/billing" },
    { label: "교재", href: "/billing?tab=textbooks" },
    { label: "지출", href: "/billing?tab=expenses" },
    { label: "수강료 계산기", href: "/billing?tab=calculator" },
    { label: "회차 확정", href: "/billing?tab=sessions" },
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
    // 탑승 학생 시간표(2026-10-27) — 셔틀 타는 학생의 이번 주 수업·배차(관리자 전용 — 탭 줄은 shuttleFaces가 관리자에게만 세운다).
    // 노선 편성 바로 뒤(사용자 2026-10-29 "노선편성 뒤로 옮겨 줘").
    { label: "탑승 학생 시간표", href: "/shuttle/classes" },
    // 주간 시간표(원장 2026-10-08 — 구글 시트 탑승현황처럼 회차마다 정류장 × 요일 표). 편성의 **보기 전용** 면이라 바로 옆에 둔다.
    { label: "주간 시간표", href: "/shuttle/week" },
    { label: "오늘 등하원", href: "/shuttle/today" },
    // 학부모 등하원 — 오늘 등하원을 **학부모가 보는 말**로 바꿔 아이별로 확인하는 면(관리자 뷰).
    // 학부모 본인은 셸 밖 `/parent`에서 자기 아이 것만 본다. 두 화면이 같은 판정(parent-rides.ts)을 쓴다.
    { label: "학부모 등하원", href: "/shuttle/parent-rides" },
    // 관제(2026-09-02) — '오늘 등하원'이 **찍는 화면**이라면 이쪽은 **보는 화면**이다. 관리자는
    // 회차를 펼쳐 한 줄씩 다루는 게 아니라 차 전체를 한눈에 보고 이상한 것만 짚는다.
    { label: "운행 현황", href: "/shuttle/live" },
    // ⚠️ '학부모 관리 현황'(/shuttle/parents)은 **여기 두지 않는다** — 이 배열은 셔틀을 보는 모든 역할의
    //    탭 줄(shuttleFaces)이 되는데, 그 면은 원장·관리자 전용이다. 입구는 학원운영 메뉴판(menu-hub
    //    `adminOnly`) 하나이고, 그 화면에서만 탭 줄에 끼워 넣는다.
    // 실시간 위치(2026-09-03) — 🔒 2026-10-08부터 **원장·관리자·총괄 전용**. 여기(창 식별·경로 면의 단일 소스)엔 그대로 두고,
    //    탭 줄(`shuttleFaces`)이 관리자가 아니면 빼고, 메뉴판은 `adminOnly`, 화면은 `isShuttleAdmin`(404)이 막는다.
    { label: "실시간 위치", href: "/shuttle/track" },
    // 가까운 노선 찾기(2026-10-26) — 학부모 탭 4와 같은 화면을 관리자가 본다(상담·안내용). 🔒 실시간 위치와 같은 관리자 전용 규칙.
    { label: "가까운 노선 찾기", href: "/shuttle/nearby" },
  ],
  // 재고관리 — 면 4개(자산·대여·실사·소모품)는 **여기 두지 않는다**(원장 2026-09-02: *"재고관리 내부탭은 왼쪽 탭에서
  //    안보여도 돼. 의미 없음. 그냥 '재고관리' 1개"*). 면은 화면 안 탭바(`features/inventory/faces.ts`)로만 오간다.
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
 * Aywa 아이콘(레일·모바일nav·검색팰릿·창 전환 공용). 그룹 번호는 사이드바에서 자동 인덱스.
 *
 * ⚠️ 라벨 = 각 page.tsx `metadata.title`("<라벨> — aywa")과 **동일해야 한다** — 창(iframe) 타이틀바가
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
        label: "대시보드",
        icon: MENU_ICON.dashboard,
        menuKey: "dashboard",
        presentation: "desktop",
        // 2026-09-09 개칭 전 이름 — 이 문서·결정 로그가 아직 전부 "운영실"이라 직원도 그렇게 부른다.
        aliases: ["운영실"],
      },
      // 캘린더 — 학원 공용 일정(원장 2026-08-18 도입). 매일 여는 자리라 홈 그룹.
      // ⚠️ 별칭에 "달력"을 넣지 말 것 — 강사뷰 번역에서 캘린더와 달력은 **다른 것**으로 갈라 둔 말이다(lang-wiring 가드).
      // 🔴 메뉴에서 뺀다(원장 2026-09-10) — 구글 달력을 **한 방향으로 끌어와 내부 참고용**으로만 쓴다.
      //    `hidden`이라 사이드바·모바일내비·팰릿엔 안 뜨지만 라우트·창 해석·아이콘맵은 그대로다
      //    (주소를 아는 사람은 열 수 있고, 이 표를 읽는 다른 화면도 안 깨진다).
      {
        href: "/calendar",
        label: "캘린더",
        icon: MENU_ICON.calendar,
        menuKey: "calendar",
        aliases: ["일정"],
        hidden: true,
      },
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
      // 라벨은 영어·수학을 묶은 이름이라, 정작 "영어 강사 시트"로 찾으면 안 나왔다(버튼형 메뉴는 그 이름으로 그린다).
      { href: "/ecs", label: "강사 시트", icon: MENU_ICON.ecs, menuKey: "ecs", aliases: ["영어 강사 시트"] },
      { href: "/attendance", label: "출석부", icon: MENU_ICON.attendance, menuKey: "attendance", aliases: ["출결"] },
      // 🔴 자리 출석부(랩실·JJ실)는 **사이드바 항목이 아니다**(원장 2026-08-14: "따로 빼지말고").
      //    출석부 안 강사 드롭다운에서 [선생님] / [LAB·JJ] / [퇴직] 그룹으로 고른다 — 자리는 메뉴가
      //    아니라 **강사 축의 한 갈래**다. 라우트(/attendance/seat/*)와 권한 키는 그대로 있고
      //    진입만 그 드롭다운으로 좁힌다.
      { href: "/classes", label: "수업목록", icon: MENU_ICON.classes, menuKey: "classes", aliases: ["반 목록"] },
      { href: "/makeups", label: "보강관리", icon: MENU_ICON.makeups, menuKey: "makeups" },
      // 교재목록 — 교재(구분·페이지/시간·차수)와 차수별 진도·과제. 영어 강사 시트에 차수별로 자동기입하는
      // 재료다(원장 2026-09-16). ⚠️ 수납관리의 **교재 단가표**(textbook_catalog)와 다른 물건이다 —
      // 그쪽은 금액 표(makeedu 동기화)고 이쪽은 커리큘럼이다. 라벨을 서로 바꿔 부르지 말 것.
      { href: "/textbooks", label: "교재목록", icon: MENU_ICON.textbooks, menuKey: "textbooks" },
      // 수업보고서 = 학원 전체 보고서 발송 총괄(구 학원설정 ?tab=report_mgmt에서 승격, 옛 Edutrix 외부링크 대체).
      { href: "/lesson-reports", label: "수업보고서", icon: MENU_ICON.lesson_reports, menuKey: "lesson_reports" },
      // 비포클래스체크리스트(초안, 원장 2026-10-28) — 수업 전 숙제·준비 체크. 기본은 원장만, 나머지는 개인별 메뉴 권한으로 연다.
      { href: "/before-class", label: "비포클래스체크리스트", icon: MENU_ICON.before_class_checklist, menuKey: "before_class_checklist", aliases: ["수업 전 체크"] },
    ],
  },
  {
    // 🔴 라벨은 **원생**이다(원장 2026-09-09 *"메뉴와 관련된 모든 학생을 원생으로"*) — 화면 이름만 바뀌고
    //    데이터·권한키(`students`)는 그대로다(이름 변경 = 라벨만).
    label: "원생",
    items: [
      // 2026-09-09 개칭 전 이름(학생 → 원생) — 개칭 당일부터 한동안은 옛 이름으로 찾는다.
      { href: "/students", label: "원생목록", icon: MENU_ICON.students, menuKey: "students", aliases: ["학생목록", "학생"] },
      { href: "/student-contribution/ranking", label: "원생 충성도", icon: MENU_ICON.student_contribution, menuKey: "student_contribution", aliases: ["원생 기여도", "학생 기여도", "로열티 랭킹"] },
      { href: "/exams", label: "성적관리", icon: MENU_ICON.exams, menuKey: "exams", aliases: ["시험"] },
      { href: "/consultations", label: "원생상담", icon: MENU_ICON.consultations, menuKey: "consultations", aliases: ["학생상담"] },
      // 등록상담은 별도 권한(menuKey=enrollment)을 가지므로 숨기지 않고 독립 진입점을 제공한다.
      { href: "/enrollment", label: "신규 콜&상담", icon: MENU_ICON.enrollment, menuKey: "enrollment", aliases: ["등록상담"] },
      { href: "/retention", label: "이탈 방어", icon: MENU_ICON.retention, menuKey: "retention" },
      // 신규생 관리 — 신입 등록 후 7·30·60·90일 체크리스트(원장 2026-09-09). 이탈 방어와 축이 다르다:
      // 저쪽은 "지금 흔들리는 재원생", 이쪽은 "들어온 지 얼마 안 된 학생을 절차대로 챙겼나".
      // 🔴 원장이 부르는 이름은 **"신입생 관리"**다(2026-09-09 *"'신입생 관리' 탭을 만들었는데 찾을 수가 없네"*).
      //    라벨엔 "신입"이 없어 팰릿 검색이 0건이었다 — 이 별칭이 그 절반을 갚는다.
      { href: "/newcomers", label: "신규생 관리", icon: MENU_ICON.newcomers, menuKey: "newcomers", aliases: ["신입생", "신입", "온보딩"] },
      { href: "/withdrawals", label: "퇴원관리", icon: MENU_ICON.withdrawals, menuKey: "withdrawals" },
      { href: "/withdrawal-reports", label: "퇴원보고서", icon: MENU_ICON.withdrawal_reports, menuKey: "withdrawal_reports" },
    ],
  },
  {
    label: "운영",
    items: [
      { href: "/staff", label: "직원관리", icon: MENU_ICON.staff, menuKey: "staff", aliases: ["강사"] },
      { href: "/billing", label: "수납관리", icon: MENU_ICON.billing, menuKey: "billing", aliases: ["청구", "수강료"] },
      // 셔틀 — 노선 편성(행선지·승하차 배정)과 일별 등하원 기록. makeedu 노랑버스에서 이관(원장 2026-08-19).
      { href: "/shuttle", label: "셔틀", icon: MENU_ICON.shuttle, menuKey: "shuttle", aliases: ["노랑버스", "버스"] },
      // 재고관리 — 전자기기 자산관리대장(자산·대여·실사·소모품). 구글시트 시안 이식(원장 2026-09-02). 하부탭 없음.
      { href: "/inventory", label: "재고관리", icon: MENU_ICON.inventory, menuKey: "inventory", aliases: ["자산관리대장", "자산"] },
      // 교재 요청 = 강사 미니셸 '내 메뉴' 전용 진입(강사 스코프). 사이드바엔 숨김, 창/타이틀 해석용 유지.
      { href: "/textbook-requests", label: "교재 요청", icon: MENU_ICON.textbook_requests, menuKey: "textbook_requests", hidden: true, teacherMenuEntry: true },
      // 지출결의서(강사 제출) = 강사 '내 메뉴' 전용 진입. 사이드바엔 숨김(사무실은 /billing 지출 면), 창/타이틀 해석용 유지.
      { href: "/expense-requests", label: "지출결의서", icon: MENU_ICON.expense_requests, menuKey: "expense_requests", hidden: true, teacherMenuEntry: true },
      { href: "/meetings", label: "회의록", icon: MENU_ICON.meetings, menuKey: "meetings" },
      // 수업 평가 체크리스트(참관) — 테스트 단계: 기본 전원 none이라 개인 예외(이승엽)에게만 보인다.
      { href: "/class-review", label: "직원 평가", icon: MENU_ICON.class_review, menuKey: "class_review", aliases: ["참관", "수업 평가", "강사평가"] },
      // 전자결재(기안·결재함, 첫 양식 = 휴가신청서) — 기본 전원 none이라 역할 표나 개인별 메뉴 권한으로 연 계정에게만 보인다.
      // 첫 양식이 휴가신청서이고 옛 /leave 전용 화면은 폐기됐다 — 휴가를 내려면 여기뿐이라 "휴가"로도 찾아야 한다.
      { href: "/approvals", label: "전자결재", icon: MENU_ICON.approvals, menuKey: "approvals", aliases: ["기안", "휴가"] },
      // 데이터베이스 = 학원 각종 서식(빈 양식 파일·앱 작성 문서) 저장소 — 윈도우 탐색기형 뷰.
      // 라벨은 "데이터베이스"지만 실체는 학원 각종 **서식** 저장소다(permissions.ts 주석과 같은 말).
      { href: "/documents", label: "데이터베이스", icon: MENU_ICON.documents, menuKey: "documents", aliases: ["서식", "양식"] },
    ],
  },
  {
    label: "지원",
    items: [
      // 고객센터(0294a) — makeedu 고객센터처럼 공지사항·개선요청. 면은 화면 안 탭바(`features/support/faces.ts`)로만.
      // 지원 묶음 맨 위(원장 2026-09-28) — 사이드바(menu-hub SUPPORT_GROUPS)와 같은 순서.
      { href: "/support", label: "고객센터", icon: MENU_ICON.support, menuKey: "support", aliases: ["개선요청", "공지사항", "문의"] },
      { href: "/owner", label: "학원 설정", icon: MENU_ICON.owner, menuKey: "owner" },
      { href: "/help", label: "도움말", icon: MENU_ICON.help, menuKey: "help", aliases: ["F1", "화면 도움말"] },
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

/**
 * 권한키로 메뉴 정의 찾기 — 숨김 항목도 돌려준다(창·타이틀 해석용 정의라 존재 자체는 유효하다).
 * 🔴 목적지의 라벨·주소·아이콘은 **여기(NAV_GROUPS) 한 곳**이 진실이다 — 다른 표면(버튼형 메뉴 허브 등)이
 *    같은 값을 다시 적으면 이름을 바꿀 때 한쪽만 바뀐다.
 */
/**
 * 검색 팰릿이 이 메뉴를 찾는 데 쓰는 말 뭉치 — **단일 소스**.
 * 라벨 + 그룹 이름 + 영문 키(`billing` 같은 영문 입력) + [[별칭]](사람이 부르는 다른 이름).
 * 🔴 팰릿과 가드가 **같은 함수**를 봐야 "이 말로 찾아진다"는 테스트가 진짜 검증이 된다
 *    (규칙을 두 벌로 적으면 한쪽만 고쳐져도 초록이 뜬다).
 */
export function menuSearchKeywords(item: NavItem, groupLabel: string): string {
  return `${item.label} ${groupLabel} ${item.menuKey} ${(item.aliases ?? []).join(" ")}`.toLowerCase();
}

export function navItemByKey(menuKey: MenuKey): NavItem | undefined {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) if (item.menuKey === menuKey) return item;
  }
  return undefined;
}

/**
 * 강사 미니셸 '내 메뉴'에 세울 메뉴 키 — **이 목록이 곧 강사뷰의 입구**다(강사 화면엔 사이드바도 팰릿도 없다).
 * 레이아웃이 한 번 계산해 `TeacherMenu`에 키만 내려보낸다(클라에서 권한을 다시 판정하지 않는다). 세 축을 모두 지나야 선다:
 *  ① **강사 행** — 학원이 강사에게 연 메뉴(학원설정 '강사 내 메뉴 표시').
 *  ② **실제 역할** — 페이지 `requireAccess`가 여는 축. 겸직 강사뷰·'다른 강사 뷰'는 역할이 강사가 아니라서 ①만 보면
 *     메뉴는 서는데 누르면 강사 홈으로 튕겼다(2026-09-11 전수검사 — 상담사는 다섯 개). 실 강사는 ①과 같은 답이다.
 *     원스크린만 예외 — 그 페이지는 역할이 아니라 뷰(강사 미니셸인가)로 연다(관리자 계열은 이 칸이 none이다).
 *  ③ **입구 정책** — 메뉴에서 뺀 항목(`hidden`)은 여기서도 닫는다. 단 `teacherMenuEntry`는 남긴다
 *     ([isTeacherMenuEntranceOpen] — 학원설정 '강사 내 메뉴 표시' 토글과 같은 함수).
 *
 * `matrix`는 **현재 사용자 유효 매트릭스**(`getUserPermMatrix` — 개인 예외·super_admin 반영)여야 한다. 페이지 게이트가
 * 보는 것과 같은 값이어야 "보이면 열린다"가 성립한다(#58 — 그래서 기본값 없이 필수 인자로 받는다).
 * ⚠️ 담당 과목 축(영어·수학 시트는 그 과목을 맡았을 때만)은 여기가 아니라 레이아웃의 `showEcs`/`showMcs`다.
 */
export function teacherMenuKeysFor(realRole: SystemRole, matrix: AccessMatrix): MenuKey[] {
  return [...TEACHER_MENU_KEYS, ...SETTINGS_ROLE_KEYS].filter(
    (menu) =>
      canAccess("teacher", menu, matrix) &&
      (menu === "teacher_onescreen" || canAccess(realRole, menu, matrix)) &&
      isTeacherMenuEntranceOpen(menu),
  );
}

/**
 * 강사 '내 메뉴'의 **입구가 열려 있는** 메뉴인가 — 입구 정책의 단일 소스. 메뉴에서 뺀 항목(`hidden`)은 닫히고,
 * `teacherMenuEntry`(강사 드롭다운이 유일한 입구)는 열린다. NAV 표에 없는 키(수학 시트 — 하부탭뿐)는 열림.
 * 🔴 소비처가 둘이다 — 강사 '내 메뉴'([teacherMenuKeysFor])와 학원설정 '강사 내 메뉴 표시' 토글. **같은 함수**를
 *    써야 한다: 한쪽만 거르면 토글에 켜도 꺼도 메뉴가 안 바뀌는 칸이 남는다(2026-09-11 리뷰 — 캘린더).
 */
export function isTeacherMenuEntranceOpen(menu: MenuKey): boolean {
  const item = navItemByKey(menu);
  return !item?.hidden || item.teacherMenuEntry === true;
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

/**
 * 이 값이 **앱 안 절대경로**인가 — 화면이 준 문자열을 `location.replace`·`redirect` 대상으로 쓰기 전 게이트.
 *
 * 🔴 `startsWith("/")` 하나로는 부족하다: `//evil.com`은 **프로토콜 상대 URL**이라 브라우저가 외부 호스트로
 *    읽고(열린 리다이렉트), 백슬래시를 섞은 `/\\evil.com`도 일부 브라우저가 같게 취급한다. 스킴 구분자(`://`)와
 *    제어문자(구분자를 숨기는 우회)도 함께 막는다.
 * ⚠️ 쿼리·해시는 허용한다(`/students?tab=billing` 같은 정상 복귀 지점) — 막을 것은 **호스트가 바뀌는 것**뿐이다.
 */
export function isInternalPath(v: string | undefined | null): v is string {
  if (!v || typeof v !== "string") return false;
  if (!v.startsWith("/")) return false;
  if (v.startsWith("//") || v.startsWith("/\\")) return false;
  // 제어문자로 스킴 구분자를 숨기는 우회 차단(유니코드 이스케이프라 no-control-regex가 안 물린다).
  if (/[\u0000-\u001f\u007f]/.test(v)) return false;
  return !v.includes("://");
}
