import { redirect } from "next/navigation";

import { signOut } from "@/app/(auth)/login/actions";
import { getPublicBrandingByTenantId } from "@/features/owner/server/public-branding";
import { PARENT_PORTAL_UNAVAILABLE_MESSAGE, parentPortalAvailable } from "@/features/shuttle/parent/server/parent-availability";
import { getParentViewer } from "@/features/shuttle/parent/server/parent-viewer";
import { loadParentNotices } from "@/features/shuttle/parent/server/parent-departure";
import { DepartureNoticeList } from "@/features/shuttle/parent/components/departure-notice-list";
import { ParentTabs } from "./_components/parent-tabs";

/**
 * 학부모 화면 공통 머리 — 학원명·학부모 이름·로그아웃 + 셔틀 알림 줄(출발·탑승) + 가로 탭(5칸). 섹션(실시간 차량·변경·확인·
 * 수업 시간표)은 이 아래 `children`으로 바뀐다.
 *
 * 🔑 학부모 게이트를 여기서 한 번 건다 — 학부모가 아니면(직원 등) 자기 홈으로. 각 섹션도 데이터를 읽을 때
 *    `getParentViewer()`를 다시 부르지만 요청 캐시라 왕복은 한 번이다.
 */
export default async function ParentSectionLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getParentViewer();
  if (!viewer) redirect("/home");
  if (!(await parentPortalAvailable(viewer))) {
    // `/home`은 학부모 신원만 보고 다시 `/parent`로 보낸다. 여기서 홈·로그인으로 돌리면 순환하거나 로그인 화면에
    // 갇히므로, 꺼진 기능의 이름을 말하지 않는 종착 화면을 직접 그린다.
    return (
      <main className="bg-card flex flex-col items-center gap-5 rounded-2xl px-6 py-10 text-center shadow-[var(--shadow-card)]">
        <h1 className="text-lg font-bold break-keep">{PARENT_PORTAL_UNAVAILABLE_MESSAGE}</h1>
        <form action={signOut}>
          <button type="submit" className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-bold">
            로그아웃
          </button>
        </form>
      </main>
    );
  }
  const [branding, notices] = await Promise.all([getPublicBrandingByTenantId(viewer.tenantId), loadParentNotices(viewer)]);
  const academy = branding?.settings.profile.name ?? "";

  return (
    <>
      <header className="flex items-start justify-between gap-3">
        <div>
          {academy ? <p className="text-text-dim text-sm font-medium">{academy}</p> : null}
          <p className="text-base font-bold">{viewer.displayName}</p>
        </div>
        <form action={signOut}>
          <button type="submit" className="text-text-dim rounded-lg px-2 py-1 text-sm underline-offset-2 hover:underline">
            로그아웃
          </button>
        </form>
      </header>
      {/* 셔틀 알림(차량 출발 · 등원 탑승, 0368a·0368b) — 푸시 가정판. 어느 탭에서든 맨 위에 뜬다. */}
      <DepartureNoticeList notices={notices} />
      <ParentTabs />
      {children}
    </>
  );
}
