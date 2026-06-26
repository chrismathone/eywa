// 시간표 초기 로드 스트리밍 — 무거운 getWeeklyScheduleWithStudents(전 슬롯·학생·교재·진도)가 도는
// 동안 Next가 이 loading을 Suspense fallback으로 즉시 스트리밍한다(특히 창=iframe으로 열 때 첫 페인트가
// 빈 화면이 아니라 스켈레톤). 툴바가 데이터(과목칩·인원)에 의존해 부분 페인트가 안 되므로 셸 전체 스켈레톤.
export default function TimetableLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* 툴바 스켈레톤 */}
      <div className="bg-card border-line shadow-card flex shrink-0 flex-wrap items-center gap-3 rounded-xl border px-4 py-3">
        <div className="bg-bg-soft h-6 w-36 animate-pulse rounded" />
        <span className="bg-line h-4 w-px" aria-hidden />
        <div className="bg-bg-soft h-6 w-44 animate-pulse rounded" />
        <div className="bg-bg-soft ml-auto h-4 w-28 animate-pulse rounded" />
      </div>
      {/* 그리드 스켈레톤 */}
      <div className="bg-card border-line shadow-card min-h-0 flex-1 animate-pulse rounded-xl border" />
    </div>
  );
}
