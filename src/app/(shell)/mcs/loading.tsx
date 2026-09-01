/**
 * MCS 랜딩 스켈레톤(B7) — 기간 네비 한 줄 + 담임 묶음 × 카드 격자.
 *
 * 작성률 막대(2026-09-01)가 붙으면서 이 화면은 그 달 **전 반의 보고서·출결**을 집계한다(실측 dev ~0.9s).
 * 첫 페인트를 그 조회에 매달면 창(iframe)으로 열 때 빈 화면이 그만큼 남는다.
 * 실표면과 같은 라운드·간격이라 데이터가 도착해도 화면이 튀지 않는다.
 */
export default function McsLandingLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="compact-chrome:hidden shrink-0">
        <div className="bg-bg-soft h-4 w-20 animate-pulse rounded" />
        <div className="bg-bg-soft mt-2 h-6 w-56 animate-pulse rounded" />
      </div>
      <div className="bg-bg-soft h-[34px] w-[260px] shrink-0 animate-pulse rounded-lg" />
      {[0, 1].map((g) => (
        <section key={g} className="flex flex-col gap-2">
          <div className="bg-bg-soft h-5 w-24 animate-pulse rounded" />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="border-line h-[86px] animate-pulse rounded-xl border bg-white" />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
