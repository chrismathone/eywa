/**
 * 오늘 출결 스켈레톤 — 창(iframe)으로 열 때 빈 화면을 보이지 않게(B7).
 * 실제 표면과 같은 라운드(2xl)·간격이라 로드 후 레이아웃이 튀지 않는다.
 */
export default function Loading() {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="bg-bg-soft h-3 w-12 animate-pulse rounded" />
        <div className="bg-bg-soft h-6 w-40 animate-pulse rounded" />
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="border-line h-40 animate-pulse rounded-2xl border" />
        ))}
      </div>
    </div>
  );
}
