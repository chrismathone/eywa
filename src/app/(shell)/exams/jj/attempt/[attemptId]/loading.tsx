/**
 * JJ실 시험 결과지 창 스켈레톤(B7) — 인재원 호출(최대 8초)이 창 첫 페인트를 막지 않게.
 * 실표면(링크 줄 + 결과지 틀)과 같은 모양·라운드라 본문이 와도 화면이 튀지 않는다.
 */
export default function JjAttemptLoading() {
  return (
    <div className="space-y-4">
      <div className="bg-bg-soft h-5 w-64 max-w-full animate-pulse rounded" />
      <div className="bg-card shadow-card rounded-2xl px-5 py-4">
        <div className="bg-bg-soft h-4 w-24 animate-pulse rounded" />
        <div className="bg-bg-soft mt-2 h-7 w-72 max-w-full animate-pulse rounded" />
        <div className="border-line mt-4 grid gap-3 border-t pt-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-bg-soft h-20 animate-pulse rounded-xl" />
          ))}
        </div>
        <div className="bg-bg-soft mt-4 h-40 animate-pulse rounded-xl" />
      </div>
    </div>
  );
}
