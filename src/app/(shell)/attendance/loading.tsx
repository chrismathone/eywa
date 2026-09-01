/**
 * 출석부 스켈레톤(B7) — 강사는 이제 **자기 전체 출석부**로 바로 들어온다(반 N개 매트릭스를 병렬 조회).
 * 그 사이 창(iframe)이 빈 화면이면 고장으로 읽히므로 표 모양을 먼저 흘려보낸다.
 * ⚠️ 트레이드오프: 월 이동·반 전환 같은 searchParam 네비에도 이 스켈레톤이 한 번 스친다(재조회는 실제로 일어난다).
 */
export default function AttendanceLoading() {
  return (
    <div className="space-y-5">
      <div className="shrink-0 compact-chrome:hidden">
        <div className="bg-bg-soft h-4 w-20 animate-pulse rounded" />
        <div className="bg-bg-soft mt-2 h-6 w-40 animate-pulse rounded" />
        <div className="bg-bg-soft mt-2 h-4 w-64 animate-pulse rounded" />
      </div>
      {/* 툴바 */}
      <div className="flex flex-wrap items-center gap-3 px-1 py-1">
        {/* 실제 툴바는 카드 껍데기가 없고 컨트롤이 h-8이다(툴바 규약 2026-09-01) — 껍데기를 그리면
            로딩→본문에서 카드가 사라지며 화면이 튄다(스켈레톤=실표면 동일 캐논). */}
        <div className="bg-bg-soft h-8 w-36 animate-pulse rounded-lg" />
        <div className="bg-bg-soft h-8 w-36 animate-pulse rounded-lg" />
        <div className="bg-bg-soft h-8 w-44 animate-pulse rounded-lg" />
        <div className="bg-bg-soft h-8 w-28 animate-pulse rounded-lg" />
      </div>
      {/* 스탯 4 */}
      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-card shadow-card h-[86px] animate-pulse rounded-2xl" />
        ))}
      </div>
      {/* 매트릭스 표 */}
      <div className="bg-card shadow-card h-[420px] animate-pulse rounded-2xl" />
    </div>
  );
}
