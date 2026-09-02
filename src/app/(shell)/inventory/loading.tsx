/**
 * 재고 관리 스켈레톤 — 자산 전건 + 건수 4개 + 활성 면을 함께 받으므로 첫 페인트를 막지 않게 즉시
 * 흘려보낸다(B7). 모양은 실제 배치(헤더 → 스탯 5장 → 면 탭 → 툴바 → 표)와 같은 라운드·같은 폭이라 로드 후 튀지 않는다.
 */
export default function Loading() {
  return (
    <div className="flex min-h-full w-full flex-col gap-4 p-3 md:px-5 md:py-4">
      <div className="bg-muted h-9 w-40 animate-pulse rounded-lg" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-muted h-24 animate-pulse rounded-2xl" />
        ))}
      </div>
      <div className="bg-muted h-10 w-64 animate-pulse rounded-2xl" />
      <div className="flex gap-2">
        <div className="bg-muted h-8 w-48 animate-pulse rounded-lg" />
        <div className="bg-muted h-8 w-80 animate-pulse rounded-lg" />
      </div>
      <div className="flex flex-col gap-1.5">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="bg-muted h-8 animate-pulse rounded-lg" />
        ))}
      </div>
    </div>
  );
}
