/**
 * 신규생 관리 스켈레톤 — 실제 구조(머리 / 지표 4 / 툴바 / 표)와 **같은 순서·같은 개수**여야 한다.
 * 어긋나면 로드가 끝나는 순간 화면이 위로 튄다(운영실에서 겪은 그 증상).
 */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-5 compact-chrome:space-y-3">
      <div className="space-y-2">
        <div className="bg-bg-soft h-3 w-16 rounded" />
        <div className="bg-bg-soft h-7 w-40 rounded" />
      </div>
      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="bg-bg-soft h-24 rounded-2xl" />
        ))}
      </div>
      {/* 툴바(구간 칩 묶음) — 실표면과 같은 높이를 **변수**로 가리킨다(치수를 손으로 적으면 실표면이 바뀔 때 안 따라온다). */}
      <div className="bg-bg-soft h-(--control-h) w-72 rounded-lg" />
      <div className="space-y-1.5">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="bg-bg-soft h-9 rounded" />
        ))}
      </div>
    </div>
  );
}
