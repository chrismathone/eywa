import { ToolbarSkeletonItem } from "@/components/toolbar";
import { SkeletonText } from "@/components/skeleton-text";

const BAR = "bg-bg-soft text-transparent animate-pulse rounded";

/**
 * JJ실 시험 결과 창 스켈레톤(B7) — 인재원 호출(최대 8초)과 짝 색인 조회가 창 첫 페인트를 막지 않게.
 * 줄 = 실물(page.tsx): '목록으로' 링크 줄 → 머리 카드(안내 · 반 선택 · 제목 · 요약 4칸) → 반별 결과 카드(`JjDeckBreakdown`,
 * 반으로 좁히지 않은 기본 화면에 선다) → 응시 표 카드. 글자 자리는 투명 글자(줄 높이 = 실물 글자 크기).
 */
export default function JjDeckLoading() {
  return (
    <div className="space-y-5">
      {/* 링크 줄 — 실물 BackLink는 창 안(embed·프레임)에선 그리지 않는다. 같은 판정을 창 마커(.embed-main) CSS로 — 실물과 같은 inline-flex 줄. */}
      <span aria-hidden className="inline-flex items-center gap-1.5 text-sm [.embed-main_&]:hidden">
        <span className={BAR}>← JJ실(시험) 목록으로</span>
      </span>
      <div aria-hidden className="bg-card shadow-card rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SkeletonText className="text-xs">인재원 JJ실 시험 · 시험 종류</SkeletonText>
          {/* 반 선택(JjClassFilter = HrefSelect) — 컨트롤 높이. */}
          <ToolbarSkeletonItem className="w-28" />
        </div>
        <SkeletonText className="mt-1 text-xl leading-tight font-bold">시험 이름 자리</SkeletonText>
        <div className="border-line mt-4 grid grid-cols-2 gap-3 border-t pt-4 text-center sm:grid-cols-4">
          {["응시", "평균", "최고", "최저"].map((label) => (
            <div key={label}>
              <SkeletonText className="text-sm font-medium">{label}</SkeletonText>
              <p className="mt-1.5 flex items-baseline justify-center gap-1">
                <span className={`num text-3xl leading-none font-bold tracking-tight ${BAR}`}>00</span>
              </p>
            </div>
          ))}
        </div>
      </div>
      {/* 반별 결과(jj-deck-breakdown.tsx) — 같은 껍데기·같은 표 머리·행 여백. */}
      <section aria-hidden className="bg-card shadow-card rounded-2xl">
        <header className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4">
          <SkeletonText className="text-base font-bold">반별 결과</SkeletonText>
          <SkeletonText className="text-xs">반 이름을 누르면 그 반만 봅니다</SkeletonText>
        </header>
        <div className="mt-2 overflow-x-auto pb-2">
          <table className="w-full text-sm">
            <thead className="border-line border-b">
              <tr>
                {["반", "응시", "평균", "최고", "최저"].map((h, i) => (
                  <th key={h} className={`micro px-4 py-2.5 ${i === 0 ? "text-left" : "text-right"}`}><span className={BAR}>{h}</span></th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {[0, 1, 2].map((r) => (
                <tr key={r}>
                  {[0, 1, 2, 3, 4].map((c) => (
                    <td key={c} className={`px-4 py-2.5 ${c === 0 ? "text-left" : "text-right"}`}><span className={BAR}>{c === 0 ? "반 이름" : "00"}</span></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="bg-card shadow-card h-64 animate-pulse rounded-2xl" />
    </div>
  );
}
