import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Suspense, type ReactNode } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { CommandPalette } from "@/components/command-palette";
import { MobileTopNav } from "@/components/mobile-top-nav";
import { UserMenu } from "@/components/user-menu";
import { TeacherMenu } from "@/components/teacher-menu";
import { NotificationBell } from "@/features/notifications/components/notification-bell";
import { NotifyPermissionBanner } from "@/features/notifications/components/notify-permission-banner";
import { EyIcon } from "@/components/icons/eywa-icons";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTenantSettings } from "@/features/owner/server/queries";
import { resolveBrandingSrc } from "@/lib/storage/media-storage";
import { getActivePopups } from "@/features/notices/server/queries";
import { NoticePopupLayer } from "@/features/notices/components/notice-popup-layer";
import { OperationsProvider } from "@/features/owner/operations-context";
// 강사뷰 화면 언어(2026-09-03) — **미니셸(강사)에만** 주입한다. 관리자 풀셸은 한국어 고정(원장 지시).
import { SheetLangProvider } from "@/features/teacher-view/lang-context";
import { DEFAULT_SHEET_LANG, sheetMenuLabel, sheetT } from "@/features/teacher-view/i18n";
import { getTeacherViewLang } from "@/features/teacher-view/server/lang";
import { getTeacherEnglishNames } from "@/features/teacher-view/server/teacher-names";
import { TeacherNamesProvider } from "@/features/teacher-view/teacher-names-context";
import { EditPresenceProvider } from "@/features/presence/edit-presence";
import { getUserPermMatrix } from "@/lib/auth/perm-matrix";
import { getShellView, canUseTeacherView, canUseOtherTeacherView, isFullShellRole, effectiveTeacherScope, viewAsTeacher } from "@/lib/auth/view-mode";
import { ViewAsChip } from "@/components/other-teacher-view";
import { teacherViewHome } from "@/lib/auth/teacher-home";
import { ecsAssistantClassIds } from "@/features/class-sheets/server/access";
import { canAccess, menuKeyForPath } from "@/lib/permissions";
import { findNavItem, teacherMenuKeysFor } from "@/lib/navigation";
import { brandColorVars } from "@/lib/color-utils";
import { WorkspaceCanvas } from "@/components/workspace/workspace-canvas";
import { MenuHubPanel } from "@/components/workspace/menu-hub-panel";
import { getMyMenuVisits } from "@/features/nav/server/visits";
import { topVisitedMenus } from "@/features/nav/menu-visits";
import { MENU_KEYS } from "@/lib/permissions";
import { WorkspaceEnabledProvider } from "@/components/workspace/workspace-enabled";
import { EmbedProvider } from "@/components/workspace/embed-context";
import { EmbedMainMarker } from "@/components/workspace/embed-main-marker";
import { PaletteHotkeyForward } from "@/components/workspace/palette-hotkey-forward";
import { EmbedFocusSignal } from "@/components/workspace/embed-focus-signal";
import { EmbedUrlKeeper } from "@/components/workspace/embed-url-keeper";
import { WindowMinSizeNotice } from "@/components/workspace/window-min-size-notice";
import { HideInFrame } from "@/components/workspace/hide-in-frame";

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // '다른 강사 뷰'(열람 전용, 2026-08-19) — 검증된 대상 강사(아니면 null). 쿠키 없으면 검증 쿼리 0.
  // 소비처 셋: ① presence track 전면 차단(대상 강사가 열람을 모르게 — 원장 지시) ② 미니셸 헤더 배지
  // ③ 데이터 스코프는 effectiveTeacherId가 같은 판정을 공유하므로 여기선 크롬만 다룬다.
  const viewAs = await viewAsTeacher();

  // 학원 브랜드·색 — owner 설정(없으면 기본값). 셸 크롬(사이드바·헤더·미니셸)에 테넌트별 적용.
  // getTenantSettings는 React cache라 아래 분기들이 같은 라운드트립을 공유(임베드 포함).
  const settings = await getTenantSettings();
  // 브랜드 색을 --primary 등 CSS 변수로 주입(기본색이면 undefined → 주입 생략). 모든 셸 분기에 적용.
  const brandStyle = brandColorVars(settings.profile.brandColor) ?? undefined;

  // Stage Manager 임베드(?embed=1 → proxy가 x-embed 주입): 사이드바·헤더·캔버스·팰릿 전부
  // 생략하고 본문만(크롬리스). 창 안엔 캔버스가 없으니 무한중첩 불가. RLS는 페이지가 자체 게이트.
  const embed = (await headers()).get("x-embed") === "1";
  if (embed) {
    // 🔴 창(iframe)에도 **같은 언어**를 흘린다 — 안 흘리면 서버 컴포넌트(`getTeacherViewLang`)는 영어인데
    //    클라 컴포넌트는 provider가 없어 한국어인 **반반 화면**이 된다. 관리자에겐 이 값이 항상 한국어라
    //    (그 함수가 `getShellView()!=="teacher"`에서 조회 없이 즉시 반환) 풀셸 동작은 한 글자도 안 바뀐다.
    return (
      <EmbedProvider embed>
        <TeacherNamesProvider names={await getTeacherEnglishNames()}>
        <SheetLangProvider lang={await getTeacherViewLang()}>
        <EditPresenceProvider trackDisabled={!!viewAs} user={{ id: user.id, displayName: user.displayName, tenantId: user.tenantId }}><OperationsProvider subjects={settings.operations.subjects} gradeLevels={settings.operations.gradeLevels} jobTitles={settings.operations.jobTitles} jobTitlesByDepartment={settings.operations.jobTitlesByDepartment}>
          {/* .embed-main = 창 컴팩트 마커 — PageHeader 등이 CSS 변형([.embed-main_&])으로 소비. soft nav에서
              layout(<main>)은 재렌더되지 않아 창 안 내비가 embed 파라미터를 흘려도 컴팩트가 유지된다(요청 단위
              x-embed로 판정하면 내비마다 풀 헤더로 플립 — 적대 리뷰 major). */}
          {/* pt-3(창 전용) — 타이틀바가 바로 위에 있어 상단 여백을 조인다(2026-07-20 세로 회수). */}
          {/* pb — 스크롤 끝에서 마지막 줄이 창 바닥에 딱 붙어 "빠듯"했다(원장 2026-08-14, 강사 ECS 시트).
              세 셸(창·미니셸·풀셸)에 같은 여백을 준다 — 한 곳만 주면 화면마다 끝이 다르게 느껴진다. */}
          {/* 창 본문 — **베젤을 없앤다**(원장 2026-09-08: *"창 열었을때 여백을 정말 최소화"* · *"좌우는 특히"* ·
              *"베젤이 있으니까 오히려 공간낭비"* · *"시간표는 특히"* · *"베젤 필요한 곳에만 베젤을 남겨둬야할거같은데"*).
              종전 `px-3 lg:px-6`(12/24px)은 **모든 창에 일률적으로** 붙던 여백이라, 넓은 화면에서 좌우 48px을
              먹었다. 지금은 셸이 여백을 만들지 않고, **베젤이 필요한 화면은 자기가 준다** — 실제로 문서형 26개
              라우트(전자결재·수업평가·이력서·문서·설정 등)가 이미 `p-6`·`p-4 md:p-6`를 스스로 갖고 있어서
              그동안 **이중 여백**이었다(그게 원장이 본 공간낭비다). 시간표·출석부·강사 시트처럼 폭이 곧 정보인
              화면은 이제 창 끝까지 쓴다.
              🔴 **0이 아니라 `px-1`(4px)인 이유가 셋이다 — 0으로 내리지 말 것**(전수 조사 2026-09-08):
               ① 카드 테두리는 `border`가 아니라 **박스 밖에 그려지는 그림자 링**이고 이 `<main>`은 `overflow-auto`라,
                  여백이 0이면 전폭 카드의 **좌·우 세로선만 잘린다**([[#114]]). 특히 `loading.tsx` 스켈레톤은
                  거의 전부가 전폭 `shadow-card` 띠라 로딩 화면이 통째로 테두리 없는 회색 덩어리가 된다.
               ② 플로팅 창은 **리사이즈 핸들(좌·우 각 6px)을 콘텐츠 위에 겹쳐** 깐다 — 여백이 0이면 맨 좌우가
                  클릭 불가가 된다.
               ③ `[scrollbar-gutter:stable]`은 **inline-end 한쪽에만** 자리를 판다 — 0이면 좌우가 눈에 띄게 비대칭이 된다.
              ⚠️ 라우트마다 다른 값을 주고 싶어도 **여기서 `x-pathname`으로 가르지 말 것**: 이 `<main>`은 soft nav에서
                 재렌더되지 않아 창을 처음 연 라우트 값에 굳는다(같은 이유로 `x-embed` 판정이 한 번 폐기됐다 —
                 `page-header.tsx` 주석). 꼭 필요하면 `WindowMinSizeNotice`처럼 **창 안에서 `usePathname()`으로** 읽어야 한다.
              🔑 **베젤이 아예 필요 없는 화면은 여기가 아니라 화면이 말한다** — 페이지 루트에 `.edge-to-edge`를 달면
                 globals.css `main.embed-main:has(.edge-to-edge)`가 그 창만 좌우·아래 0 + 거터 해제로 만든다
                 (`.sticky-save-bar`와 같은 결, 시간표 선례 — 원장 2026-09-08 *"좌우와 하단 여백이 거의 느껴지지 않도록 딱"*). */}
          <main style={brandStyle} className="embed-main bg-background text-foreground h-screen overflow-auto px-1.5 pt-2 pb-8 lg:pb-10 [scrollbar-gutter:stable]">
            <EmbedFocusSignal />
            {/* 창 안 소프트 이동(맨 Link·router.push)이 주소에서 embed=1을 지우면 되붙인다 — 안 붙이면 뒤이은
                refresh·서버 액션·reload가 embed 없는 주소로 이 레이아웃을 다시 받아 창 안에 전체 셸이 뜬다
                (전수검사 2026-09-11, embed-url-keeper.tsx). useSearchParams라 Suspense로 감싼다. */}
            <Suspense fallback={null}>
              <EmbedUrlKeeper />
            </Suspense>
            {/* 창 안에서도 Shift+F/Ctrl·Cmd+K로 검색 팰릿 — keydown은 프레임을 못 넘어 postMessage 포워딩. */}
            <PaletteHotkeyForward />
            {/* 창이 그 메뉴의 최소 크기(ROUTE_WINDOW_SIZE)보다 작으면 맨 위에 안내 — 화면은 접지 않는다(원장 2026-09-03). */}
            <WindowMinSizeNotice />
            {children}
          </main>
        </OperationsProvider></EditPresenceProvider>
        </SheetLangProvider>
        </TeacherNamesProvider>
      </EmbedProvider>
    );
  }

  // 공지 팝업(셸 진입 시 창처럼 노출) — 임베드(iframe 창)엔 위에서 이미 return했으므로 최상위 프레임에서만
  // 1회 fetch(테넌트별 unstable_cache·역할 audience 필터). 대부분 0건이라 비용 거의 없음.
  const popups = await getActivePopups(user.systemRole, user.tenantId, user.id);

  const brand = settings.profile.logoText || "EYWA";
  const academyLine =
    [settings.profile.name, settings.profile.branchLabel].filter(Boolean).join(" · ") || brand;
  // 학원 로고 이미지(GCS 비공개 path는 signed URL, 외부 http URL은 그대로). 셸 크롬(사이드바·미니셸·모바일내비)에
  // 공유. 미업로드/실패면 null → 각 표면이 학원 building 마크로 폴백. 임베드는 위에서 이미 return(크롬 없음).
  const logoSrc = await resolveBrandingSrc(settings.profile.logoUrl, user.tenantId);

  // 테넌트 권한 override + **개인 예외(userOverrides)** 반영 매트릭스 — 강사 '내 메뉴'(여기서 teacherMenuKeysFor로
  // 계산해 키만 내린다)·사이드바·팰릿·모바일내비 메뉴 필터가 쓴다. getUserPermMatrix = getTenantSettings(위에서 이미 fetch,
  // cache 공유) + override + 현재 사용자 예외 + **super_admin 우회**(owner override 무시 = 코드 기본값).
  // 페이지 requireAccess와 같은 캐시를 공유해 추가 쿼리 0. 개인 예외는 자기 역할 행만 패치하므로
  // 아래 강사뷰 가드(canAccess("teacher", …))는 겸직 관리자에게 영향 없음.
  const permMatrix = await getUserPermMatrix();

  // 셸 크롬 결정 — student=학생 미니셸, teacher(실 강사 or 겸직-강사뷰)=강사 미니셸, 그 외=풀셸.
  // 겸직(관리자 계열 + 담당 반)이 '강사뷰' 쿠키를 켜면 view="teacher"라 아래 미니셸을 탄다(권한은 실 role 유지).
  const view = await getShellView();

  // ── 뷰-경로 정합성 가드 — 강사 미니셸은 "강사가 접근 가능한 페이지"만 감싼다. ──
  // 겸직(관리자 계열)이 '강사뷰로 전환' 후 브라우저 **뒤로가기**로 관리자 전용 URL(대시보드 등)로 돌아오면,
  // 쿠키는 teacher라 미니셸이 관리자 페이지를 감싸 "강사뷰인데 관리자 화면"인 깨진 렌더가 났다(심각 버그).
  // 강사 접근 불가 경로(canAccess("teacher", menu)=false)는 강사 홈(/onescreen)으로 되돌린다. 이건 **뷰 기준
  // 크롬 정합성**이지 권한 변경이 아니다 — 실 system_role은 그대로라 관리자뷰로 전환하면 그대로 접근 가능.
  // 원스크린이 관리자뷰에서 뜨는 반대 케이스는 onescreen 페이지 자체 가드가 이미 방어(대칭). menu=null(모르는
  // 경로)은 fail-open — 페이지 requireAccess가 판정(신규 라우트 과잉 차단 방지).
  if (view === "teacher") {
    const pathname = (await headers()).get("x-pathname") ?? "";
    const menu = menuKeyForPath(pathname);
    if (menu && !canAccess("teacher", menu, permMatrix)) {
      // 강사 홈은 담당 과목으로 갈린다(영어 전담=ECS·그 외=원스크린, 2026-08-07) — 하드코딩 금지.
      redirect(await teacherViewHome());
    }
  }

  // English Class Sheet 메뉴는 **영어 반 담당·부담임 강사**에게만(원장 지시 2026-07-29 + 부담임 확장 승인).
  // 권한(ecs=scoped)은 전 강사가 가지므로 그것만으론 못 거르고, 담당 과목은 서버에서만 안다.
  // 스코프 null은 fail-open(표시) — 모른다고 감추면 정작 영어 담당이 메뉴를 잃는다.
  // 부담임 확인(ecsAssistantClassIds)은 반담당 영어가 없을 때만 평가(|| 단락 — 영어 담당은 추가 쿼리 0).
  // + 실 역할 축(2026-08-19): /ecs 페이지 requireAccess는 실 역할로 판정한다 — '다른 강사 뷰'를 켠
  //   counselor처럼 실 역할이 ecs를 못 열면 메뉴를 보여줘도 눌러봤자 홈으로 튕긴다(거짓 항목). 실 강사
  //   (teacher=scoped)·겸직 관리자(full)는 이 조건이 항상 참이라 기존 동작 불변.
  const ecsForTeacher =
    view === "teacher"
      ? ((((await effectiveTeacherScope())?.subjects.includes("english") ?? true) ||
          (await ecsAssistantClassIds()).length > 0) &&
        canAccess(user.systemRole, "ecs", permMatrix))
      : false;

  // Math Class Sheet 메뉴는 **수학 반 담당 강사**에게만(영어와 대칭). 이 줄이 없어서 수학만 맡은
  // 강사에게는 MCS로 가는 길이 아예 없었다(원장 2026-09-01 "크리티컬한건 바로 수정").
  // ⚠️ MCS엔 부담임 갈래가 없다(수학 슬롯 teacher_id가 전부 null) — 영어의 assistant 폴백은 안 쓴다.
  // 위 ecsForTeacher와 **같은 캐시**(effectiveTeacherScope)를 재사용하므로 추가 쿼리 0.
  const mcsForTeacher =
    view === "teacher"
      ? (((await effectiveTeacherScope())?.subjects.includes("math") ?? true) &&
        canAccess(user.systemRole, "mcs", permMatrix))
      : false;

  // 강사 홈(= '내 메뉴'에서 맨 위로 올릴 항목) — 영어 전담이면 ECS, 그 외 원스크린(원장 지시 2026-08-07).
  // 위 ecsForTeacher와 **같은 캐시**(effectiveTeacherScope·ecsAssistantClassIds)를 재사용하므로 추가 쿼리 0.
  const teacherHome = view === "teacher" ? await teacherViewHome() : null;

  // '내 메뉴'에 세울 메뉴 — 강사 행 ∧ **실제 역할** ∧ 입구 정책(메뉴에서 뺀 항목), 판정은 teacherMenuKeysFor 한 곳.
  // 🔴 실제 역할을 빼지 말 것(2026-09-11 전수검사): 페이지 requireAccess는 실제 역할로 여는데 강사 행만 보고 세우면,
  //    겸직 강사뷰·'다른 강사 뷰'(열람 전용 — user는 보는 사람 자신)에서 누르면 강사 홈으로 튕기는 항목이 선다
  //    (상담사는 다섯 개). permMatrix는 페이지 게이트와 같은 사용자 유효 매트릭스라 쿼리 0. 실 강사는 두 축이 같아 불변.
  const teacherMenus = view === "teacher" ? teacherMenuKeysFor(user.systemRole, permMatrix) : [];

  // 강사뷰 화면 언어(원장 2026-09-03) — 크롬('내 메뉴')과 본문이 **한 값**을 봐야 하므로 셸에서 한 번 읽어
  // 아래 미니셸 전체를 감싼다. 🔴 관리자 풀셸·학생 미니셸에는 주입하지 않는다(원장: 관리자뷰 수정 불필요).
  // ⚠️ `getTeacherViewLang`은 스스로도 `getShellView()!=="teacher"`면 한국어를 내므로(서버 컴포넌트가
  //    직접 부르는 경로까지 같은 답), 여기 조건과 이중으로 맞물린다.
  const teacherLang = view === "teacher" ? await getTeacherViewLang() : DEFAULT_SHEET_LANG;
  // 표시 이름 → 영어 이름 표(원장 2026-09-03) — 영어 화면이 아니면 보내지 않고 해당 함수도 조회 0회다.
  const teacherNames = view === "teacher" ? await getTeacherEnglishNames() : {};

  // 강사·학생: 사이드바·네비 없는 단일 화면 셸 — 미니멀 헤더(브랜드 + 로그아웃) + 풀폭 본문.
  // 강사=원스크린, 학생=내 학습 현황. (원장 등 나머지는 아래 12메뉴 풀 셸 그대로.)
  if (view === "teacher" || view === "student") {
    // 미니셸 헤더에 현재 메뉴명을 얹는다 — 이 셸엔 MobileTopNav가 없어 크롬에 제목이 없다.
    // 모르는 경로는 null(지어내지 않는다 — 학원명만 남는다).
    // 화면 언어를 따라간다(2026-09-03) — 앱 전역 네비 표의 label은 **안 고친다**(관리자 사이드바·팰릿
    // 공용이고 관리자뷰는 한국어 고정). 강사 미니셸이 그릴 때만 사전으로 갈아 끼우고, 사전에 없는
    // 메뉴는 원래 한국어 라벨로 떨어진다.
    const miniShellNav = findNavItem((await headers()).get("x-pathname") ?? "") ?? null;
    const miniShellLabel = miniShellNav
      ? (sheetMenuLabel(miniShellNav.menuKey, teacherLang) ?? miniShellNav.label)
      : null;
    return (
      // print:h-auto/overflow-visible — 인쇄 시 h-screen+overflow-hidden 래퍼가 문서를 1페이지 높이로
      // 클리핑하는 것 방지(globals.css의 html/body/main 인쇄 리셋과 세트 — 래퍼 div는 셀렉터 밖이라 여기서).
      // ⚠️ WorkspaceEnabledProvider(enabled=false)는 **셸 전체**를 감싼다 — 본문만 감쌌더니 헤더의
      // 사용자 메뉴(WindowLink '내 정보')가 기본값 true를 보고 캔버스 없는 미니셸에서 유령 창만 열어
      // "눌러도 아무 일 없음"이 났다(원장 제보 2026-08-04, 육소희 실측).
      <WorkspaceEnabledProvider enabled={false}>
      {/* 🔴 provider가 **헤더까지** 감싼다 — 스위치와 '내 메뉴' 라벨이 헤더에 있어서, <main>만 감싸면
          메뉴는 한글인데 본문만 영어가 된다(둘이 같은 값을 봐야 한다). 학생 미니셸에는 안 걸린다. */}
      <TeacherNamesProvider names={teacherNames}>
      <SheetLangProvider lang={teacherLang}>
      <div style={brandStyle} className="bg-background text-foreground flex h-screen flex-col overflow-hidden print:h-auto print:overflow-visible">
        {/* z-[60]: 공지 팝업 레이어(z-55)가 좁은 미니셸에선 헤더 버튼('내 메뉴'·사용자 메뉴)까지 덮어
            클릭이 팝업에 먹혔다(2026-08-04 실측) — 내비 크롬은 공지보다 항상 위. */}
        <header className="bg-background border-line sticky top-0 z-[60] flex h-12 shrink-0 items-center justify-between border-b px-5 lg:px-7">
          <div className="flex items-center gap-2.5">
            {logoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element -- 학원 로고(GCS/외부 이미지), next/image 최적화 불필요
              <img src={logoSrc} alt={brand} className="size-7 shrink-0 rounded-[3px] object-contain" />
            ) : (
              <span className="bg-ink flex size-7 items-center justify-center rounded-[3px]">
                <EyIcon name="building" size={16} strokeWidth={1.8} className="text-white" />
              </span>
            )}
            <div className="min-w-0 leading-none">
              <div className="text-foreground truncate text-lg leading-tight font-bold tracking-tight">{brand}</div>
              {/* (아래 둘째 줄 기준) **학생** 미니셸의 제목 줄은 16px(디자인 v5 18단계 — 옛 14) — 강사 미니셸은 2026-09-14부터
                  그 자리에 '강사뷰'를 18px로 적는다(아래 분기 주석). 머리는 `h-12`(48) 고정이라 두 줄의
                  줄상자를 `leading-tight`로 잡는다(20×1.25 + 3 + 16×1.25 = 48 — 기본 줄높이면 54로 넘친다; 부모의
                  `leading-none`은 자식 `text-*`가 제 줄높이를 다시 정해 상속되지 않는다). */}
              {/* 🔴 강사 미니셸의 이 줄은 **어느 뷰인지**를 말한다(원장 2026-09-14: *"강사뷰 라고 큼직하게.
                  강사뷰라는걸 한눈에 알 수 있게"*) — 관리자 풀셸 사이드바의 '관리자' 배지와 짝이고, 겸직이
                  두 뷰를 오갈 때 지금 어느 쪽인지 상단에서 바로 읽히게 하는 것이 목적이다. 종전엔 학원명 ·
                  지점 · 현재 메뉴명(`인재원 · 침산 · 수업 마감 (원스크린)`)이 있었다.
                  ⚠️ 그래서 **강사 화면에선 현재 메뉴명이 크롬에서 사라진다** — 본문 PageHeader는 좁은 화면에서
                     `compact-chrome`으로 제목을 접고(= "제목은 크롬이 이미 보여준다"는 전제) 이 미니셸엔
                     MobileTopNav가 없다. 제목이 아쉽다는 제보가 오면 이 줄이 아니라 본문 쪽에서 되살릴 것.
                  🔴 **학생 미니셸은 이 분기를 타지 않는다**(같은 셸을 쓰지만 학생에게 '강사뷰'는 거짓이다).
                  🔴 글자는 **사전**(`chrome.teacherView`)으로 — 강사 화면을 영어로 바꾸면 이 줄도 따라가야 한다(코드에
                     한글을 박았다가 영어 화면에서 헤더만 한글로 남았다 — 적대적 리뷰 2026-09-14).
                  높이: 머리가 `h-12`(48, 아래 테두리 1px 포함) 고정이고 두 줄 줄상자는 20×1.25 + 3 + 18 = 46이라
                  안에 든다 — `leading-none`이 필수다(`leading-tight`면 50.5로 넘쳐 헤더가 잘린다). */}
              {view === "teacher" ? (
                <div className="text-primary mt-[3px] truncate text-base leading-none font-bold">
                  {sheetT(teacherLang, "chrome.teacherView")}
                </div>
              ) : (
                <div className="text-text-dim mt-[3px] truncate text-sm leading-tight">
                  {miniShellLabel ? `${academyLine} · ${miniShellLabel}` : academyLine}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {/* 겸직이면 '내 메뉴' 드롭다운 하단에 '관리자뷰로 전환'을 넣는다(헤더 별도 버튼 X). 실 강사는 미노출. */}
            {/* '다른 강사 뷰' 배지 — 누구의 화면인지 상시 표시 + 강사 갈아타기/관리자뷰 복귀(열람 전용). */}
            {viewAs ? <ViewAsChip name={viewAs.displayName} /> : null}
            {view === "teacher" ? (
              <TeacherMenu
                menus={teacherMenus}
                canReturnToAdmin={isFullShellRole(user.systemRole)}
                showEcs={ecsForTeacher}
                showMcs={mcsForTeacher}
                home={teacherHome}
              />
            ) : null}
            {/* 강사가 알림 1차 수신자(반 배정·전입·인수인계) — 미니셸에도 벨 필수(적대리뷰). 학생은 미노출. */}
            {view === "teacher" ? <NotificationBell /> : null}
            <UserMenu
              email={user.email}
              displayName={user.displayName}
              jobTitle={user.jobTitle ?? undefined}
            />
          </div>
        </header>
        {/* 컴퓨터 알림 선제 안내 — 권한 미설정 강사에게만(허용/차단/닫음이면 스스로 사라짐). 학생은 알림 없음. */}
        {view === "teacher" ? <NotifyPermissionBanner /> : null}
        {/* .compact-main = 페이지 헤더 접기 마커(globals.css `compact-chrome` ③). 위 헤더가 이미 메뉴명을
            찍으므로 본문 PageHeader의 eyebrow·21px 제목은 중복이다 — 강사 화면은 세로 1px이 곧 데이터다. */}
        {/* 강사 미니셸 — 원장이 "빠듯하다"고 짚은 화면(영어 강사 ECS 시트)이 여기다. */}
        <main className="compact-main flex-1 overflow-auto px-3 pt-4 pb-8 lg:px-6 lg:pt-5 lg:pb-10 [scrollbar-gutter:stable]">
          <EditPresenceProvider trackDisabled={!!viewAs} user={{ id: user.id, displayName: user.displayName, tenantId: user.tenantId }}><OperationsProvider subjects={settings.operations.subjects} gradeLevels={settings.operations.gradeLevels} jobTitles={settings.operations.jobTitles} jobTitlesByDepartment={settings.operations.jobTitlesByDepartment}>
            {children}
          </OperationsProvider></EditPresenceProvider>
        </main>
        <NoticePopupLayer popups={popups} />
      </div>
      </SheetLangProvider>
      </TeacherNamesProvider>
      </WorkspaceEnabledProvider>
    );
  }

  // 겸직(관리자 계열 + 실제 담당 반) → 사이드바 하단에 '강사뷰로 전환' 노출. head:true 카운트라 저비용.
  const canTeacherView = await canUseTeacherView();

  // '다른 강사 뷰'(열람 전용) 진입 자격 — master는 쿼리 0, 그 외 요청 캐시된 PK 조회 1회(0224a 토글).
  const canOtherTeacherView = await canUseOtherTeacherView();
  // 왼쪽 '자주 방문한 메뉴' — 계정 기록에서 많이→최근 순 4개(권한 있는 메뉴만). 기록이 없으면 빈 배열이라
  // 사이드바가 기본값으로 떨어진다. ⚠️ 실패해도 화면을 막지 않는다(조회는 fail-soft).
  const frequentKeys = topVisitedMenus(
    await getMyMenuVisits().catch(() => ({})),
    MENU_KEYS.filter((k) => canAccess(user.systemRole, k, permMatrix)),
    4,
  );

  return (
    // ⚠️ OperationsProvider는 **셸 전체**를 감싼다 — 예전엔 <main> 안 {children}만 감쌌더니
    // 그 밖 형제로 마운트되는 <WorkspaceCanvas>(플로팅 창)가 컨텍스트를 못 받아, 창 안에서 부른
    // useSubjectMaps()가 buildSubjectMaps([]) 폴백을 타 과목이 "수학" 대신 raw 키 `math`로 떴다
    // (2026-07-22 전수검사 — 학생 요약 peek 창, 진입=커맨드 팰릿 학생 검색).
    // 라우트 창(iframe)은 자식 문서가 위 embed 분기에서 다시 받으므로 무관했다.
    <OperationsProvider subjects={settings.operations.subjects} gradeLevels={settings.operations.gradeLevels} jobTitles={settings.operations.jobTitles} jobTitlesByDepartment={settings.operations.jobTitlesByDepartment}>
    {/* print:h-auto/overflow-visible — 인쇄 클리핑 방지(위 미니멀 셸 래퍼와 동일). */}
    <div style={brandStyle} className="bg-background text-foreground flex h-screen flex-col overflow-hidden print:h-auto print:overflow-visible lg:flex-row">
      {/* 셸 크롬(사이드바·모바일내비·헤더)은 iframe(플로팅 창) 안에선 숨긴다 — 드릴인으로 embed가
          떨어져도 메뉴탭이 이중으로 뜨지 않도록 사전 차단(HideInFrame). 최상위 프레임은 그대로 노출. */}
      {/* 데스크톱(≥lg + 마우스) = 좌측 사이드바 / 그 외(좁은 폭·터치) = 숨김.
          크롬 전환 조건을 useIsDesktop(폭+pointer:fine)과 일치시켜, 창 시스템이 꺼지는
          와이드 터치에서 "사이드바는 떠 있는데 메뉴가 창으로 안 열리는" 회색지대를 제거. */}
      <HideInFrame>
        <AppSidebar
          systemRole={user.systemRole}
          email={user.email}
          displayName={user.displayName}
          jobTitle={user.jobTitle}
          logoText={brand}
          logoSrc={logoSrc}
          permMatrix={permMatrix}
          canTeacherView={canTeacherView}
          canOtherTeacherView={canOtherTeacherView}
          frequentKeys={frequentKeys}
          menuLayout={settings.navigation.menus}
          className="hidden lg:pointer-fine:flex"
        />
      </HideInFrame>

      {/* 데스크톱이 아니면(좁은 폭·터치) 상단 horizontal nav / 데스크톱(≥lg + 마우스): 숨김 */}
      <HideInFrame>
        <MobileTopNav systemRole={user.systemRole} email={user.email} brand={brand} logoSrc={logoSrc} permMatrix={permMatrix} menuLayout={settings.navigation.menus} className="lg:pointer-fine:hidden" />
      </HideInFrame>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden print:overflow-visible">
        {/* ⚠️ 옛 AppHeader(모바일 전용 두 번째 헤더)는 **삭제**했다 — 위 MobileTopNav와 같은 것을 두 번
            보여주면서(브랜드·그룹·메뉴명 각 2회) 상단 크롬이 390×844에서 318px=43%를 먹었다
            (원장 2026-07-30 "모바일뷰에서 시간표가 상단 헤더 때문에 거의 보이지 않음"). 제목·벨은
            MobileTopNav 한 줄로 흡수. 데스크톱은 원래 이 헤더가 숨겨져 있어 영향 없음. */}
        {/* pt-2(모바일) — 상단 바 바로 아래라 여백을 조인다. 데스크톱은 종전 pt-5. */}
        <main className="flex-1 overflow-auto px-3 pt-2 pb-8 lg:px-6 lg:pt-5 lg:pb-10 [scrollbar-gutter:stable]">
          {/* 드릴인 등으로 embed 파라미터가 떨어진 하드 내비가 창(iframe) 안에서 풀 셸을 렌더하면
              물리 프레임 판정으로 .embed-main 마커를 재부착 — PageHeader 컴팩트의 HideInFrame판. */}
          <EmbedMainMarker />
          <EditPresenceProvider trackDisabled={!!viewAs} user={{ id: user.id, displayName: user.displayName, tenantId: user.tenantId }}>
            {children}
          </EditPresenceProvider>
        </main>
      </div>

      {/* 검색 메뉴 점프 팰릿 — 헤더 검색 클릭으로 열림, 포털 렌더라 위치 무관 */}
      <CommandPalette systemRole={user.systemRole} permMatrix={permMatrix} canTeacherView={canTeacherView} />

      {/* Stage Manager 워크스페이스 — 데스크톱에서만 자체 마운트(모바일/미니셸 무영향) */}
      <WorkspaceCanvas owner={`${user.tenantId}:${user.id}`} homeHref={canAccess(user.systemRole, "dashboard", permMatrix) ? "/dashboard" : "/menu"} />

      {/* 업무군 메뉴 허브(버튼형, 원장 2026-09-07) — 사이드바에서 업무군을 고르면 본문에 메뉴 버튼이 뜬다.
          ⚠️ 캔버스와 **형제**로 둔다(캔버스 안에 넣으면 창들과 같은 층에 갇혀 z·포인터가 얽힌다).
          🔴 창은 그대로 열려 있다 — 허브는 그 위를 잠깐 덮는 층이고 Esc로 닫으면 하던 작업이 그대로다. */}
      <HideInFrame>
        <MenuHubPanel
          systemRole={user.systemRole}
          permMatrix={permMatrix}
          canTeacherView={canTeacherView}
          menuLayout={settings.navigation.menus}
        />
      </HideInFrame>

      {/* 공지 팝업 — 셸 진입 시 창처럼 노출(데스크톱/모바일 공용, 임베드 제외) */}
      <NoticePopupLayer popups={popups} />
    </div>
    </OperationsProvider>
  );
}
