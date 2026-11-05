import { BigStatSkeleton } from "@/components/atoms/big-stat";
import { PageHeaderSkeleton } from "@/components/page-header";
import { Toolbar, ToolbarSkeletonItem } from "@/components/toolbar";

/**
 * 계획 대비 현황 스켈레톤(B7) — 실화면(page.tsx)과 같은 순서: 머리 · 툴바 · 통계 4칸 · 선생님별 표.
 * - 툴바 = 실물과 같은 `<Toolbar>`(돌아가기 · 달 이동).
 * - 통계 = 공용 `BigStatSkeleton` — 실물 BigStat 넷 중 앞 둘(일치율·뒤처짐)만 보조 줄이 있다(옛 `h-20` 면은 실물보다 짧았다).
 * - 표 = 실물과 같은 table 클래스(머리 줄 + 선생님 묶음 tbody: 묶음 줄 + 반 줄) · 줄 높이는 투명 글자가 잡는다.
 *   선생님·반 수는 데이터라 근사(3명 × 3반).
 */
const bar = "bg-bg-soft text-transparent animate-pulse rounded";
const COLS = 7; // 선생님 열 뒤 숫자 열 수(예정·일치·뒤처짐·앞섬·다름·미작성·일치율)

export default function EcsPlanGapLoading() {
  return (
    <div className="space-y-4">
      <PageHeaderSkeleton />
      <Toolbar>
        <ToolbarSkeletonItem className="w-24" />
        <ToolbarSkeletonItem className="w-44" />
      </Toolbar>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[true, true, false, false].map((sub, i) => (
          <BigStatSkeleton key={i} sub={sub} />
        ))}
      </div>
      <div className="bg-card shadow-card overflow-x-auto rounded-2xl px-1">
        <table aria-hidden className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-line border-b text-xs [&>th]:px-3 [&>th]:py-2 [&>th]:text-center [&>th]:font-bold">
              <th className="text-left!"><span className={bar}>선생님</span></th>
              {Array.from({ length: COLS }, (_, i) => (
                <th key={i}><span className={bar}>항목</span></th>
              ))}
            </tr>
          </thead>
          {[0, 1, 2].map((g) => (
            <tbody key={g} className="border-line border-b last:border-0">
              <tr className="bg-bg-soft/60 font-bold">
                <td className="px-3 py-2"><span className={bar}>선생님 이름</span></td>
                {Array.from({ length: COLS }, (_, i) => (
                  <td key={i} className="px-3 py-2 text-center"><span className={bar}>00</span></td>
                ))}
              </tr>
              {[0, 1, 2].map((r) => (
                <tr key={r} className="border-line-faint border-t">
                  <td className="px-3 py-2 pl-6"><span className={bar}>반 이름 자리</span></td>
                  {Array.from({ length: COLS }, (_, i) => (
                    <td key={i} className="px-3 py-2 text-center"><span className={bar}>0</span></td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}
