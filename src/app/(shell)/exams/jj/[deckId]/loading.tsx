/**
 * JJ실 시험 결과 창 스켈레톤(B7) — 인재원 호출(최대 8초)과 짝 색인 조회가 창 첫 페인트를 막지 않게.
 * 실표면(머리 카드 + 요약 4칸 + 표)과 같은 모양·라운드라 본문이 와도 화면이 튀지 않는다.
 */
export default function JjDeckLoading() {
  return (
    <div className="space-y-5">
      <div className="bg-card shadow-card rounded-2xl p-5">
        <div className="bg-bg-soft h-4 w-40 animate-pulse rounded" />
        <div className="bg-bg-soft mt-2 h-7 w-72 max-w-full animate-pulse rounded" />
        <div className="border-line mt-4 grid grid-cols-2 gap-3 border-t pt-4 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-bg-soft mx-auto h-12 w-20 animate-pulse rounded" />
          ))}
        </div>
      </div>
      <div className="bg-card shadow-card h-64 animate-pulse rounded-2xl" />
    </div>
  );
}
