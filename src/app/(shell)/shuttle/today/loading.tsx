/**
 * 오늘 등하원 스켈레톤 — 편성·기록·결석 신호를 함께 받으므로 첫 페인트를 막지 않게 흘려보낸다(B7).
 * 📱 셔틀 선생님은 폰(느린 회선)에서 열기 때문에 여기서 빈 화면이 특히 길게 느껴진다.
 */
import { SHUTTLE_TOOLBAR } from "@/features/shuttle/control-size";

export default function Loading() {
  return (
    <div className="flex min-h-full w-full flex-col gap-3 p-3 md:px-5 md:py-4">
      {/* 실표면과 같은 줄 구성 — 1줄: 면 탭 + 날짜 네비 + 시즌 / 2줄: 등하원 드롭다운 + 요약. 높이는 컨트롤과 같은 변수
          (폰 44 / 데스크톱 --control-h) — FaceTabs도 같은 변수를 읽는다. ⚠️ 낮게 두면 로드되는 순간 줄이 뛰어 첫 화면이 밀린다. */}
      <div className={SHUTTLE_TOOLBAR}>
        <div className="bg-muted h-(--control-h) w-56 animate-pulse rounded-lg" />
        <div className="bg-muted h-(--control-h) w-56 animate-pulse rounded-lg" />
        <div className="bg-muted h-(--control-h) w-28 animate-pulse rounded-md" />
      </div>
      <div className={SHUTTLE_TOOLBAR}>
        <div className="bg-muted h-(--control-h) w-32 animate-pulse rounded-md" />
        <div className="bg-muted h-5 w-40 animate-pulse rounded" />
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-muted h-28 animate-pulse rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
