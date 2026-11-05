import { BigStatSkeleton } from "@/components/atoms/big-stat";
import { PageHeaderSkeleton } from "@/components/page-header";
import { SkeletonLine, SkeletonText } from "@/components/skeleton-text";
import { TABLE_COL_LINES, TH } from "@/components/super-admin/parts";
import { Toolbar, ToolbarDivider, ToolbarSkeletonItem } from "@/components/toolbar";

/** 글자 막대 — 실물 글자 클래스로 줄 높이를 정한다. */
const TEXT_BAR = "bg-bg-soft text-transparent animate-pulse rounded";
/** 메뉴별 이용 표 머리 칸(_menu-panel) — 실물 라벨 그대로. */
const MENU_HEAD = ["순위", "메뉴", "비중", "활동 시간", "화면 시간", "활동률", "방문", "1회 평균 활동", "이용자"];

/** 라벨 붙은 세그먼트 자리(기간 · 정렬) — micro 라벨 + 묶음 상자(높이 = 컨트롤 변수). */
function SegmentSkeleton({ width }: { width: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <SkeletonLine className="micro w-7 shrink-0" />
      <ToolbarSkeletonItem className={width} />
    </div>
  );
}

/**
 * 이용 분석 스켈레톤 — 집계 함수가 도는 동안 빈 화면 대신(B7).
 * 모양 = 실 배치(page.tsx — 레이아웃의 `space-y-5` 안): 헤더(안에 숫자 카드 4장, `stats=`) → 툴바(기간 | 지점·권한·과목 | 정렬)
 * → 안내 문장(`text-xs`) → 메뉴별 이용 패널(Panel 머리 `h3 text-base` + `p text-sm` · 표 머리 TH ≈ 44px · 행 ≈ 45px).
 */
export default function Loading() {
  return (
    <div className="space-y-5">
      <PageHeaderSkeleton
        stats={
          // 실물 = 헤더 안 BigStat 4장(아이콘 · 앞 둘만 보조 줄 — 기간 · 활동률).
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[true, true, false, false].map((sub, i) => (
              <BigStatSkeleton key={i} icon sub={sub} />
            ))}
          </div>
        }
      />
      {/* 툴바 — 기간(7·30·90일) | 지점 · 권한 · 강사 과목 | 정렬(활동·방문·화면). 칸 폭은 실물 문구 폭에 맞춘 근사(≈ 285 · 165 · 180 · 230 · 248px). */}
      <Toolbar>
        <SegmentSkeleton width="w-62" />
        <ToolbarDivider />
        <ToolbarSkeletonItem className="w-41" />
        <ToolbarSkeletonItem className="w-45" />
        <ToolbarSkeletonItem className="w-58" />
        <ToolbarDivider />
        <SegmentSkeleton width="w-54" />
      </Toolbar>
      <SkeletonText className="text-xs">
        메뉴 이름과 분류는 기본 구성을 기준으로 표시합니다. 지점에서 이름이나 폴더를 바꿔도 같은 기능으로 합산됩니다.
      </SkeletonText>
      {/* 메뉴별 이용 — 실물 Panel 카드 + 표(같은 머리 칸 상수 · 같은 칸 여백이라 행 높이를 실물 칸이 정한다). */}
      <section aria-hidden className="bg-card shadow-card overflow-hidden rounded-2xl">
        <div className="border-line border-b px-4 py-3">
          <SkeletonLine className="w-56 text-base font-bold" />
          <SkeletonText className="mt-0.5 text-sm">활동 시간 기준. 위에 있을수록 많이 쓰는 기능이라 손봤을 때 효과가 큽니다.</SkeletonText>
        </div>
        <div className="overflow-hidden">
          <table className={`w-full min-w-[920px] text-sm ${TABLE_COL_LINES}`}>
            <thead>
              <tr>
                {MENU_HEAD.map((label) => (
                  <th key={label} scope="col" className={`${TH} text-left`}>
                    <span className={TEXT_BAR}>{label}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {Array.from({ length: 10 }, (_, i) => (
                <tr key={i}>
                  {MENU_HEAD.map((label) => (
                    <td key={label} className="px-3 py-2.5 whitespace-nowrap">
                      <span className={TEXT_BAR}>{label === "메뉴" ? "메뉴 이름 자리" : "00"}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
