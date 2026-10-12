import type { Metadata } from "next";
import { EyIcon } from "@/components/icons/aywa-icons";
import { buttonVariants } from "@/components/ui/button";
import { TENANT_VIEW_EXIT_PATH } from "@/lib/auth/tenant-view-shared";

export const metadata: Metadata = {
  title: "읽기 전용 보기",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * '지점 보기'(읽기 전용) — **보기 상태를 확인하지 못했을 때**의 안내 화면.
 *
 * 보기 쿠키는 있는데 지금 그 보기가 살아 있는지 확인하지 못한 화면 요청이 여기로 온다(current-user.ts). 확인하지 못한 채 화면을
 * 그리면 보는 지점으로도 본인 지점으로도 틀릴 수 있어, 아무것도 그리지 않고 이 안내만 보여 준다.
 *
 * 🔴 **이 화면은 로그인한 사람도 DB도 읽지 않는다** — 읽으면 같은 판정을 다시 지나 이리로 되돌아온다(끝없는 이동).
 * 🔴 두 링크는 `<Link>`가 아니라 `<a>`다 — 문서를 새로 열어 다시 판정받는다('보기 끝내기'는 미리 불러오면 그 요청만으로 보기가 끝난다).
 */
export default function TenantViewUnconfirmedPage() {
  return (
    // 크롬리스 라우트라 하단 여백을 직접 준다(design-conventions '본문 하단 여백').
    <main className="flex min-h-screen flex-col items-center justify-center px-4 pt-8 pb-8 lg:pb-10">
      <section className="bg-card border-line w-full max-w-md rounded-2xl border px-6 py-8 text-center">
        <span className="bg-muted text-foreground mx-auto flex size-12 items-center justify-center rounded-xl">
          <EyIcon name="lock" size={24} />
        </span>
        <h1 className="text-foreground mt-4 text-xl font-bold break-keep">읽기 전용 보기 상태를 확인하지 못했습니다</h1>
        <p className="text-foreground mt-2 text-sm break-keep">잠시 뒤 다시 시도해 주세요. 계속되면 보기를 끝낸 뒤 다시 열어 주세요.</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <a href="/home" className={buttonVariants()}>
            다시 시도
          </a>
          <a href={TENANT_VIEW_EXIT_PATH} className={buttonVariants({ variant: "outline" })}>
            보기 끝내기
          </a>
        </div>
      </section>
    </main>
  );
}
