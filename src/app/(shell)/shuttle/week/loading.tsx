/**
 * 셔틀 주간 시간표 스켈레톤(B7) — 편성 보드 조회가 여러 왕복이라 첫 페인트를 막지 않게.
 * 실표면과 같은 한 줄(면 탭 + 시즌) + 회차 표 틀(2xl 라운드)이라 로드 후 튀지 않는다.
 */
import { SHUTTLE_TOOLBAR } from "@/features/shuttle/control-size";

export default function ShuttleWeekLoading() {
  return (
    <div className="flex min-h-full w-full flex-col gap-3 p-3 md:px-5 md:py-4">
      <div className={SHUTTLE_TOOLBAR}>
        <div className="bg-muted h-(--control-h) w-56 animate-pulse rounded-lg" />
        <div className="bg-muted h-(--control-h) w-36 animate-pulse rounded-lg" />
      </div>
      <div className="bg-muted h-6 w-32 animate-pulse rounded" />
      {[0, 1].map((i) => (
        <div key={i} className="bg-muted h-72 animate-pulse rounded-2xl" />
      ))}
    </div>
  );
}
