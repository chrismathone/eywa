/**
 * 셔틀 편성 스켈레톤 — 보드 조회가 차량·정류장·회차·노선·배정·학생을 여러 왕복으로 모으므로
 * 첫 페인트를 막지 않게 즉시 흘려보낸다(B7). 창(iframe)으로 열면 빈 화면이 특히 길게 보인다.
 * 모양은 실제 3열 레이아웃과 같은 라운드(2xl)·같은 열 폭이라 로드 후 튀지 않는다.
 * 🔑 `(board)` 묶음 안에 둔다 — `shuttle/` 바로 아래면 하위 면(학부모 등하원 등) 전부를 감싸, 이 3열 뼈대가
 *    먼저 뜨고 그 면 스켈레톤으로 다시 바뀌어 "두 번 로딩"처럼 보였다(사용자 2026-10-16).
 */
import { PageHeaderSkeleton } from "@/components/page-header";
import { SHUTTLE_TOOLBAR } from "@/features/shuttle/control-size";

export default function Loading() {
  return (
    <div className="flex min-h-full w-full flex-col gap-3 p-3 md:px-5 md:py-4">
      {/* 공용 PageHeader 자리(동작 = 정류장 관리·인쇄). */}
      <PageHeaderSkeleton actions={<div className="bg-bg-soft h-(--control-h) w-64 animate-pulse rounded-lg" />} />
      {/* 실표면과 같은 한 줄 — 면 탭 + 시즌 드롭다운. 높이는 컨트롤과 같은 변수(폰 44 / 데스크톱 --control-h, FaceTabs도 같은 변수). */}
      <div className={SHUTTLE_TOOLBAR}>
        <div className="bg-muted h-(--control-h) w-56 animate-pulse rounded-lg" />
        <div className="bg-muted h-(--control-h) w-28 animate-pulse rounded-md" />
      </div>
      <div className="grid flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(190px,15rem)_minmax(0,1fr)_minmax(200px,17rem)]">
        <div className="bg-muted h-64 animate-pulse rounded-2xl" />
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-muted h-16 animate-pulse rounded-2xl" />
          ))}
        </div>
        <div className="bg-muted hidden h-64 animate-pulse rounded-2xl lg:block" />
      </div>
    </div>
  );
}
