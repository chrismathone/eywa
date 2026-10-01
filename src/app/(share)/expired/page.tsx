import type { Metadata } from "next";
import { EyIcon } from "@/components/icons/aywa-icons";
import { expiredLinkCopy } from "@/features/link-expired/kinds";

/**
 * 🔴 `noindex` — 만료 안내뿐이라 숨길 데이터는 없지만, 학부모 링크가 모이는 자리라 검색에 실릴 이유가 없다
 * (보고서 `/r`·자리 출석부와 같은 처리).
 */
export const metadata: Metadata = {
  title: "링크 만료",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * 공용 '링크 만료' 페이지 — 로그인 없이 열린다(`lib/supabase/proxy.ts` 공개 경로). 원장 2026-10-01.
 * 기간이 지난 공개 링크(보고서 `/r`·접수 QR·직원 등록 QR, 곧 영상 제출 `/v`)가 서버에서 여기로 보낸다.
 *
 * 🔴 **학원 이름을 적지 않는다** — 주소엔 `?kind=`만 와서 어느 지점의 링크였는지 모른다. 회사 브랜드
 *    (`getPublicBranding`)를 적으면 학원이 둘 이상일 때 대표 지점(침산) 이름이 **다른 지점 학부모에게도** 선다 —
 *    로그인 화면에서 지점 이름을 걷어낸 것과 같은 이유다(decisions/tenant.md 2026-09-22 · "다른 지점 학부모 화면에
 *    남의 학원 이름"). 제품명으로 채우지도 않는다(학부모 화면이다). 그래서 이 페이지는 DB를 읽지 않는다.
 * 관객은 학부모 폰 — 카드 하나를 가운데, 글자는 토큰만(`text-[Npx]` 금지 가드).
 */
export default async function LinkExpiredPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string | string[] }>;
}) {
  const { kind } = await searchParams;
  const { title, detail } = expiredLinkCopy(kind);

  return (
    // 크롬리스 라우트라 하단 여백을 직접 준다(design-conventions '본문 하단 여백').
    <main className="flex min-h-screen flex-col items-center justify-center px-4 pt-8 pb-8 lg:pb-10">
      <section className="bg-card border-line w-full max-w-md rounded-2xl border px-6 py-8 text-center">
        <span className="bg-muted text-foreground mx-auto flex size-12 items-center justify-center rounded-xl">
          <EyIcon name="clock" size={24} />
        </span>
        <h1 className="text-foreground mt-4 text-xl font-bold break-keep">{title}</h1>
        <p className="text-foreground mt-2 text-sm break-keep">{detail}</p>
      </section>
    </main>
  );
}
