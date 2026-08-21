/**
 * 오늘 등하원 스켈레톤 — 편성·기록·결석 신호를 함께 받으므로 첫 페인트를 막지 않게 흘려보낸다(B7).
 * 📱 셔틀 선생님은 폰(느린 회선)에서 열기 때문에 여기서 빈 화면이 특히 길게 느껴진다.
 */
export default function Loading() {
  return (
    <div className="flex min-h-full w-full flex-col gap-3 p-3 md:px-5 md:py-4">
      {/* 면 전환 탭바(노선 편성 · 오늘 등하원) — 로드 후 줄이 밀리지 않게 자리를 잡아 둔다.
          size-guard-ok: 공용 FaceTabs(실측 ~40px)의 자리라 셔틀 44px 캐논 대상이 아니다. */}
      <div className="bg-muted h-10 w-56 animate-pulse rounded-2xl" />
      {/* 날짜 이동·등하원 칩 — 실제 컨트롤과 같은 높이(control-size: 폰 44px / 데스크톱 32px).
          ⚠️ 등하원 칩을 h-6으로 두면 로드되는 순간 그 줄이 44px로 뛰어 첫 화면이 밀린다. */}
      <div className="flex gap-2">
        <div className="bg-muted h-11 w-12 animate-pulse rounded-lg sm:h-8" />
        <div className="bg-muted h-11 w-36 animate-pulse rounded-lg sm:h-8" />
        <div className="bg-muted h-11 w-12 animate-pulse rounded-lg sm:h-8" />
      </div>
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-muted rounded-pill h-11 w-20 animate-pulse sm:h-8" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-muted h-28 animate-pulse rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
