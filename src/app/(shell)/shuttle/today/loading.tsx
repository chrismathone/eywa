/**
 * 오늘 등하원 스켈레톤 — 편성·기록·결석 신호를 함께 받으므로 첫 페인트를 막지 않게 흘려보낸다(B7).
 * 📱 셔틀 선생님은 폰(느린 회선)에서 열기 때문에 여기서 빈 화면이 특히 길게 느껴진다.
 */
export default function Loading() {
  return (
    <div className="flex min-h-full w-full flex-col gap-3 p-3 md:px-5 md:py-4">
      <div className="flex gap-2">
        <div className="bg-muted h-11 w-12 animate-pulse rounded-xl" />
        <div className="bg-muted h-11 w-36 animate-pulse rounded-xl" />
        <div className="bg-muted h-11 w-12 animate-pulse rounded-xl" />
      </div>
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-muted rounded-pill h-6 w-20 animate-pulse" />
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
