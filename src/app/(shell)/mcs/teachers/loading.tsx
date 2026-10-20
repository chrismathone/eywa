/**
 * MCS 선생님별 보기 스켈레톤(B7) — 전 반 학생의 주문·보고서를 모아 계산하는 화면이라 첫 페인트를 그 조회에 매달지 않는다.
 * 실표면과 같은 면(흰 바탕·테두리)과 묶음 격자라 데이터가 와도 화면이 튀지 않는다.
 */
export default function McsTeachersLoading() {
  return (
    <div className="border-line rounded-[10px] border bg-white p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="bg-bg-soft h-7 w-64 animate-pulse rounded" />
        <div className="bg-bg-soft h-(--control-h) w-36 animate-pulse rounded-lg" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {[0, 1, 2, 3].map((g) => (
          <div key={g} className="border-line rounded-lg border">
            <div className="bg-bg-soft h-10 animate-pulse" />
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="border-line-faint h-[60px] border-t" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
