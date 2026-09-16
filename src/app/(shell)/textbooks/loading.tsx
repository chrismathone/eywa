/**
 * 교재목록 스켈레톤 — 목록·표지 서명 URL·차수 집계를 함께 받으므로 첫 페인트를 막지 않게 즉시
 * 흘려보낸다(B7). 모양은 실제 배치(헤더 → 면 탭 → 툴바 → 표)와 같은 높이·라운드라 로드 후 튀지 않는다.
 */
export default function Loading() {
  return (
    <div className="flex min-h-full w-full flex-col gap-4 p-3 md:px-5 md:py-4">
      <div className="bg-muted h-9 w-40 animate-pulse rounded-lg" />
      {/* 면 탭 — 실제 `FaceTabs`와 같은 높이·라운드(`--control-h` · rounded-lg). */}
      <div className="bg-muted h-(--control-h) w-40 animate-pulse rounded-lg" />
      <div className="flex gap-2">
        <div className="bg-muted h-(--control-h) w-44 animate-pulse rounded-lg" />
        <div className="bg-muted h-(--control-h) w-56 animate-pulse rounded-lg" />
        <div className="bg-muted ml-auto h-(--control-h) w-24 animate-pulse rounded-lg" />
      </div>
      {/* 표 — 표지 썸네일이 있어 행이 높다(h-12 + 여백). */}
      <div className="flex flex-col gap-1.5">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="bg-muted h-14 animate-pulse rounded-lg" />
        ))}
      </div>
    </div>
  );
}
