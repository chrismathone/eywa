import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
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
import { EditPresenceProvider } from "@/features/presence/edit-presence";
import { getPermMatrix } from "@/lib/auth/perm-matrix";
import { getShellView, canUseTeacherView, isFullShellRole } from "@/lib/auth/view-mode";
import { brandColorVars } from "@/lib/color-utils";
import { WorkspaceCanvas } from "@/components/workspace/workspace-canvas";
import { WorkspaceEnabledProvider } from "@/components/workspace/workspace-enabled";
import { EmbedProvider } from "@/components/workspace/embed-context";
import { EmbedFocusSignal } from "@/components/workspace/embed-focus-signal";
import { HideInFrame } from "@/components/workspace/hide-in-frame";

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // 학원 브랜드·색 — owner 설정(없으면 기본값). 셸 크롬(사이드바·헤더·미니셸)에 테넌트별 적용.
  // getTenantSettings는 React cache라 아래 분기들이 같은 라운드트립을 공유(임베드 포함).
  const settings = await getTenantSettings();
  // 브랜드 색을 --primary 등 CSS 변수로 주입(기본색이면 undefined → 주입 생략). 모든 셸 분기에 적용.
  const brandStyle = brandColorVars(settings.profile.brandColor) ?? undefined;

  // Stage Manager 임베드(?embed=1 → proxy가 x-embed 주입): 사이드바·헤더·캔버스·팰릿 전부
  // 생략하고 본문만(크롬리스). 창 안엔 캔버스가 없으니 무한중첩 불가. RLS는 페이지가 자체 게이트.
  const embed = (await headers()).get("x-embed") === "1";
  if (embed) {
    return (
      <EmbedProvider embed>
        <EditPresenceProvider user={{ id: user.id, displayName: user.displayName, tenantId: user.tenantId }}><OperationsProvider subjects={settings.operations.subjects} gradeLevels={settings.operations.gradeLevels}>
          <main
            data-eywa-shell=""
            style={brandStyle}
            className="bg-background text-foreground h-screen overflow-auto px-3 pt-4 lg:px-6 lg:pt-5 [scrollbar-gutter:stable]"
          >
            <EmbedFocusSignal />
            {children}
          </main>
        </OperationsProvider></EditPresenceProvider>
      </EmbedProvider>
    );
  }

  // 공지 팝업(셸 진입 시 창처럼 노출) — 임베드(iframe 창)엔 위에서 이미 return했으므로 최상위 프레임에서만
  // 1회 fetch(테넌트별 unstable_cache·역할 audience 필터). 대부분 0건이라 비용 거의 없음.
  const popups = await getActivePopups(user.systemRole, user.tenantId);

  const brand = settings.profile.logoText || "EYWA";
  const academyLine =
    [settings.profile.name, settings.profile.branchLabel].filter(Boolean).join(" · ") || brand;
  // 학원 로고 이미지(GCS 비공개 path는 signed URL, 외부 http URL은 그대로). 셸 크롬(사이드바·미니셸·모바일내비)에
  // 공유. 미업로드/실패면 null → 각 표면이 학원 building 마크로 폴백. 임베드는 위에서 이미 return(크롬 없음).
  const logoSrc = await resolveBrandingSrc(settings.profile.logoUrl, user.tenantId);

  // 테넌트 권한 override 반영 매트릭스 — 강사 '내 메뉴'·사이드바·팰릿·모바일내비 메뉴 필터에 주입(클라 소비처).
  // getPermMatrix = getTenantSettings(위에서 이미 fetch, cache 공유) + override 적용 + **super_admin 우회**
  // (super_admin은 owner override 무시 = 코드 기본값). 페이지 requireAccess와 같은 캐시를 공유해 추가 쿼리 0.
  const permMatrix = await getPermMatrix();

  // 셸 크롬 결정 — student=학생 미니셸, teacher(실 강사 or 겸직-강사뷰)=강사 미니셸, 그 외=풀셸.
  // 겸직(관리자 계열 + 담당 반)이 '강사뷰' 쿠키를 켜면 view="teacher"라 아래 미니셸을 탄다(권한은 실 role 유지).
  const view = await getShellView();

  // 강사·학생: 사이드바·네비 없는 단일 화면 셸 — 미니멀 헤더(브랜드 + 로그아웃) + 풀폭 본문.
  // 강사=원스크린, 학생=내 학습 현황. (원장 등 나머지는 아래 12메뉴 풀 셸 그대로.)
  if (view === "teacher" || view === "student") {
    return (
      // print:h-auto/overflow-visible — 인쇄 시 h-screen+overflow-hidden 래퍼가 문서를 1페이지 높이로
      // 클리핑하는 것 방지(globals.css의 html/body/main 인쇄 리셋과 세트 — 래퍼 div는 셀렉터 밖이라 여기서).
      <div
        data-eywa-shell=""
        style={brandStyle}
        className="bg-background text-foreground flex h-screen flex-col overflow-hidden print:h-auto print:overflow-visible"
      >
        <header className="bg-background border-line sticky top-0 z-30 flex h-12 shrink-0 items-center justify-between border-b px-5 lg:px-7">
          <div className="flex items-center gap-2.5">
            {logoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element -- 학원 로고(GCS/외부 이미지), next/image 최적화 불필요
              <img src={logoSrc} alt={brand} className="size-7 shrink-0 rounded-[3px] object-contain" />
            ) : (
              <span className="bg-ink flex size-7 items-center justify-center rounded-[3px]">
                <EyIcon name="building" size={16} strokeWidth={1.8} className="text-white" />
              </span>
            )}
            <div className="leading-none">
              <div className="text-foreground text-[17px] font-extrabold tracking-tight">{brand}</div>
              <div className="text-text-dim mt-[3px] font-mono text-[10px] tracking-wider">
                {academyLine}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {/* 겸직이면 '내 메뉴' 드롭다운 하단에 '관리자뷰로 전환'을 넣는다(헤더 별도 버튼 X). 실 강사는 미노출. */}
            {view === "teacher" ? (
              <TeacherMenu permMatrix={permMatrix} canReturnToAdmin={isFullShellRole(user.systemRole)} />
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
        <main className="flex-1 overflow-auto px-3 pt-4 lg:px-6 lg:pt-5 [scrollbar-gutter:stable]">
          {/* 미니멀 셸엔 WorkspaceCanvas가 없다 → WindowLink/새폼이 창을 열지 않고 드릴인(일반 네비)하게 false. */}
          <WorkspaceEnabledProvider enabled={false}>
            <EditPresenceProvider user={{ id: user.id, displayName: user.displayName, tenantId: user.tenantId }}><OperationsProvider subjects={settings.operations.subjects} gradeLevels={settings.operations.gradeLevels}>
              {children}
            </OperationsProvider></EditPresenceProvider>
          </WorkspaceEnabledProvider>
        </main>
        <NoticePopupLayer popups={popups} />
      </div>
    );
  }

  // 겸직(관리자 계열 + 실제 담당 반) → 사이드바 하단에 '강사뷰로 전환' 노출. head:true 카운트라 저비용.
  const canTeacherView = await canUseTeacherView();

  return (
    // print:h-auto/overflow-visible — 인쇄 클리핑 방지(위 미니멀 셸 래퍼와 동일).
    <div
      data-eywa-shell=""
      style={brandStyle}
      className="bg-background text-foreground flex h-screen flex-col overflow-hidden print:h-auto print:overflow-visible lg:flex-row"
    >
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
          className="hidden lg:pointer-fine:flex"
        />
      </HideInFrame>

      {/* 데스크톱이 아니면(좁은 폭·터치) 상단 horizontal nav / 데스크톱(≥lg + 마우스): 숨김 */}
      <HideInFrame>
        <MobileTopNav systemRole={user.systemRole} email={user.email} brand={brand} logoSrc={logoSrc} permMatrix={permMatrix} className="lg:pointer-fine:hidden" />
      </HideInFrame>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden print:overflow-visible">
        <HideInFrame>
          <AppHeader brand={brand} />
        </HideInFrame>
        <main className="flex-1 overflow-auto px-3 pt-4 lg:px-6 lg:pt-5 [scrollbar-gutter:stable]">
          <EditPresenceProvider user={{ id: user.id, displayName: user.displayName, tenantId: user.tenantId }}><OperationsProvider subjects={settings.operations.subjects} gradeLevels={settings.operations.gradeLevels}>
            {children}
          </OperationsProvider></EditPresenceProvider>
        </main>
      </div>

      {/* 검색 메뉴 점프 팰릿 — 헤더 검색 클릭으로 열림, 포털 렌더라 위치 무관 */}
      <CommandPalette systemRole={user.systemRole} permMatrix={permMatrix} />

      {/* Stage Manager 워크스페이스 — 데스크톱에서만 자체 마운트(모바일/미니셸 무영향) */}
      <WorkspaceCanvas owner={`${user.tenantId}:${user.id}`} />

      {/* 공지 팝업 — 셸 진입 시 창처럼 노출(데스크톱/모바일 공용, 임베드 제외) */}
      <NoticePopupLayer popups={popups} />
    </div>
  );
}
