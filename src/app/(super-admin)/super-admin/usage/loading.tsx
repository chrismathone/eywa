/**
 * 이용 분석 스켈레톤 — 집계 함수가 도는 동안 빈 화면 대신(B7). 실제 표면과 같은 라운드(2xl)·간격.
 */
export default function Loading() {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="bg-bg-soft h-3 w-16 animate-pulse rounded" />
        <div className="bg-bg-soft h-6 w-40 animate-pulse rounded" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="border-line h-24 animate-pulse rounded-2xl border" />
        ))}
      </div>
      <div className="bg-bg-soft h-9 w-full max-w-2xl animate-pulse rounded-lg" />
      <div className="border-line h-96 animate-pulse rounded-2xl border" />
    </div>
  );
}
