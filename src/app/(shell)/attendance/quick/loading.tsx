/**
 * 출결 모드 스켈레톤 — 폰에서 흰 화면을 보이지 않게(B7). 이 화면은 수업 직후 복도에서 열린다.
 * 실제 표면과 같은 라운드(2xl)·간격이라 로드 후 레이아웃이 튀지 않는다.
 */
export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2 px-1">
        <div className="bg-bg-soft h-3 w-12 animate-pulse rounded" />
        <div className="bg-bg-soft h-6 w-32 animate-pulse rounded" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="border-line space-y-2 rounded-2xl border px-3 py-2.5">
            <div className="flex items-center gap-2">
              <div className="bg-bg-soft h-8 flex-1 animate-pulse rounded" />
              <div className="bg-bg-soft h-11 w-24 animate-pulse rounded-xl" />
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {Array.from({ length: 6 }).map((__, j) => (
                <div key={j} className="bg-bg-soft h-11 animate-pulse rounded-xl" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
