/**
 * 시간표 편집기가 뜨기 전의 자리 표시 — 편집기와 같은 뼈대(위 두 줄 + 격자 + 아래 상태줄)라 도착할 때 화면이 튀지 않는다.
 * 서버 loading.tsx와 클라 지연 로드(next/dynamic)가 함께 쓴다.
 */
export function EditorSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-white" aria-busy="true" aria-label="시간표 편집기 불러오는 중">
      <div className="border-line flex h-[52px] shrink-0 items-center gap-4 border-b px-4">
        <div className="bg-bg-soft h-5 w-40 animate-pulse rounded" />
        <div className="bg-bg-soft ml-auto h-8 w-44 animate-pulse rounded" />
        <div className="bg-bg-soft h-8 w-36 animate-pulse rounded" />
      </div>
      <div className="border-line flex shrink-0 items-center gap-3 border-b px-3 py-2">
        <div className="bg-bg-soft h-8 w-28 animate-pulse rounded" />
        <div className="bg-bg-soft h-8 w-16 animate-pulse rounded" />
        <div className="bg-bg-soft h-8 w-48 animate-pulse rounded" />
      </div>
      <div className="bg-bg-soft/50 min-h-0 flex-1 animate-pulse" />
      <div className="border-line h-[30px] shrink-0 border-t" />
    </div>
  );
}
