/**
 * 셔틀 주간 시간표 스켈레톤(B7) — 편성 보드 조회가 여러 왕복이라 첫 페인트를 막지 않게.
 * 모양 = 실 배치(page.tsx): 툴바 줄(면 탭 + `시즌` 세그먼트) → `차량` 세그먼트 + 기사·회차 문장 → 회차 표 카드
 * (`@container` 안에서 넓으면 `@5xl:grid-cols-2`). 세그먼트는 실물 치수 상수(TOOLBAR_SEG_BOX·TOOLBAR_SEG_ITEM)를 그대로 쓴다.
 */
import { FaceTabsSkeleton } from "@/components/face-tabs-skeleton";
import { SkeletonLine, SkeletonText } from "@/components/skeleton-text";
import { TOOLBAR_SEG_BOX, TOOLBAR_SEG_BOX_WRAP, TOOLBAR_SEG_ITEM } from "@/components/toolbar-controls";
import { SHUTTLE_TOOLBAR } from "@/features/shuttle/control-size";

/** 글자 막대 — 실물 글자 클래스로 줄 높이를 정한다. */
const TEXT_BAR = "bg-bg-soft text-transparent animate-pulse rounded";
/** 요일 열 — 평일 다섯(토·일은 그 차량에 주말 배정이 있을 때만). */
const DAYS = 5;
/** 세그먼트 칸 — 실물 안쪽 칩 치수에 막대 색만. */
const SEG_ITEM = `${TOOLBAR_SEG_ITEM} bg-bg-soft animate-pulse`;
/** 면 탭 칸 — 관리자 전용 셋(탑승 학생 시간표 · 실시간 위치 · 가까운 노선 찾기)을 뺀 기본 다섯(faces.ts). */
const FACES = 5;

/** 라벨 붙은 세그먼트(실물 ToolbarSegment label — `flex items-center gap-1.5` + micro 라벨 + 묶음 상자). */
function SegmentSkeleton({ items, wrap = false }: { items: number; wrap?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <SkeletonLine className="micro w-7 shrink-0" />
      <div className={wrap ? TOOLBAR_SEG_BOX_WRAP : TOOLBAR_SEG_BOX}>
        {Array.from({ length: items }, (_, i) => (
          <span key={i} className={`${SEG_ITEM} w-14`} />
        ))}
      </div>
    </div>
  );
}

export default function ShuttleWeekLoading() {
  return (
    <div className="flex min-h-full w-full flex-col gap-3 p-3 md:px-5 md:py-4">
      {/* 툴바 줄 — 면 탭(폰에선 한 줄 다) + 시즌 세그먼트(학기중 · 방학중). */}
      <div className={SHUTTLE_TOOLBAR}>
        <span className="min-w-0 flex-1 basis-full sm:basis-auto">
          <FaceTabsSkeleton count={FACES} />
        </span>
        <SegmentSkeleton items={2} />
      </div>
      {/* 차량 세그먼트(차량 수만큼 · 감김) + 기사 · N개 회차 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <SegmentSkeleton items={3} wrap />
        <SkeletonText as="span" className="text-sm">
          기사 기사님 · 0개 회차
        </SkeletonText>
      </div>
      <div className="@container">
        <div className="grid items-start gap-3 @5xl:grid-cols-2">
          {[0, 1].map((i) => (
            // 회차 표 — 실물(week-run-table)과 같은 카드 · 머리 · `<table>` 클래스라 머리줄(py-1.5 ≈ 37px) · 행(py-1 · leading-snug) ·
            // 맨 아래 '인원' 합계 줄 높이를 실물 칸이 그대로 정한다. 칸 글자만 투명 막대다.
            <section key={i} aria-hidden className="bg-card shadow-card overflow-hidden rounded-2xl">
              <div className="border-line flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b px-3 py-2">
                <span className={`${TEXT_BAR} px-2 py-0.5 text-xs font-bold`}>등원</span>
                <span className={`${TEXT_BAR} text-base font-bold`}>1회차</span>
                <span className={`${TEXT_BAR} ml-auto text-sm`}>배정 00명</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[30rem] table-fixed border-collapse text-sm">
                  <colgroup>
                    <col className="w-[8.5rem]" />
                    {Array.from({ length: DAYS }, (_, d) => (
                      <col key={d} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr className="bg-bg-soft">
                      <th className="border-line border-b px-2 py-1.5 text-left font-bold">
                        <span className={TEXT_BAR}>정류장</span>
                      </th>
                      {Array.from({ length: DAYS }, (_, d) => (
                        <th key={d} className="border-line border-b border-l px-1 py-1.5 text-center font-bold">
                          <span className={TEXT_BAR}>월</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: 7 }, (_, j) => (
                      <tr key={j}>
                        <th className="border-line border-b px-2 py-1 text-left align-top font-semibold">
                          <span className={`${TEXT_BAR} leading-snug`}>정류장 이름</span>
                        </th>
                        {Array.from({ length: DAYS }, (_, d) => (
                          <td key={d} className="border-line border-b border-l px-1.5 py-1 align-top leading-snug">
                            <span className={TEXT_BAR}>학생 이름</span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-bg-soft">
                      <th className="px-2 py-1.5 text-left font-bold">
                        <span className={TEXT_BAR}>인원</span>
                      </th>
                      {Array.from({ length: DAYS }, (_, d) => (
                        <td key={d} className="border-line border-l px-1 py-1.5 text-center font-bold">
                          <span className={TEXT_BAR}>0</span>
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
