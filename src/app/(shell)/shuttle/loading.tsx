/**
 * 셔틀 편성 스켈레톤 — 보드 조회가 차량·정류장·회차·노선·배정·학생을 여러 왕복으로 모으므로
 * 첫 페인트를 막지 않게 즉시 흘려보낸다(B7). 창(iframe)으로 열면 빈 화면이 특히 길게 보인다.
 * 모양은 실제 3열 레이아웃과 같은 라운드(2xl)·같은 열 폭이라 로드 후 튀지 않는다.
 */
export default function Loading() {
  return (
    <div className="flex min-h-full w-full flex-col gap-3 p-3 md:px-5 md:py-4">
      {/* 공용 PageHeader 제목 줄의 자리.
          size-guard-ok: 이건 컨트롤이 아니라 제목 텍스트 자리라 44px 탭 타겟 규칙 대상이 아니다. */}
      <div className="bg-muted h-9 w-40 animate-pulse rounded-lg" />
      {/* 면 전환 탭바(노선 편성 · 오늘 등하원) — 로드 후 줄이 밀리지 않게 자리를 잡아 둔다.
          size-guard-ok: 공용 FaceTabs(실측 ~40px)의 자리라 셔틀 44px 캐논 대상이 아니다. */}
      <div className="bg-muted h-10 w-56 animate-pulse rounded-2xl" />
      {/* 시즌 칩 — 실제 칩과 같은 높이(control-size: 폰 44px / 데스크톱 32px)라 로드 후 안 튄다. */}
      <div className="flex gap-2">
        <div className="bg-muted rounded-pill h-11 w-20 animate-pulse sm:h-8" />
        <div className="bg-muted rounded-pill h-11 w-20 animate-pulse sm:h-8" />
      </div>
      <div className="grid flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(190px,15rem)_minmax(0,1fr)_minmax(200px,17rem)]">
        <div className="bg-muted h-64 animate-pulse rounded-2xl" />
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-muted h-16 animate-pulse rounded-2xl" />
          ))}
        </div>
        <div className="bg-muted hidden h-64 animate-pulse rounded-2xl lg:block" />
      </div>
    </div>
  );
}
