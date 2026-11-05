import { ToolbarSkeletonItem } from "@/components/toolbar";

// 투명 글자 막대 — 종이(`paper-scale`) 글자 크기·줄 높이를 그대로 받는다(칸 높이를 손으로 적지 않게).
const TEXT_BAR = "bg-bg-soft text-transparent animate-pulse rounded";
// 서식 칸 — 실물 `expense-document.tsx`의 칸 여백(py-2)과 같다. 선만 옅게.
const CELL = "border-line border px-3 py-2";

/** 서식 표 한 덩어리(4칸 × rows줄) — 기본정보·항목·정산정보 표가 모두 이 높이 규칙이다. */
function PaperTable({ rows, className = "" }: { rows: number; className?: string }) {
  return (
    <table className={`border-line w-full table-fixed border-2 text-xs ${className}`}>
      <tbody>
        {Array.from({ length: rows }, (_, r) => (
          <tr key={r}>
            {[0, 1, 2, 3].map((c) => (
              <td key={c} className={CELL}>
                <span className={TEXT_BAR}>칸 내용</span>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * 지출결의서 상세 스켈레톤 — 예전엔 자기 loading이 없어 **수납관리 목록 스켈레톤**(면 탭·요약 띠·표)이 떴다가 종이로 바뀌었다.
 * 실물 = 인쇄 바(가운데 760px 줄) + 같은 폭의 종이 한 장(`ExpenseDocument`). 창(embed)에선 '지출 목록으로'가 빠지고
 * 인쇄 버튼만 오른쪽에 서는데, 줄 높이는 버튼이 정하므로 같다.
 */
export default function ExpenseDetailLoading() {
  return (
    <>
      <div className="mx-auto mb-4 flex max-w-[760px] items-center justify-between gap-2 print:hidden">
        <span aria-hidden className={`${TEXT_BAR} text-sm`}>지출 목록으로</span>
        <ToolbarSkeletonItem className="w-20" />
      </div>
      <div className="paper-scale mx-auto max-w-[760px]">
        <article
          aria-busy="true"
          aria-label="지출결의서 불러오는 중"
          className="bg-card border-line shadow-card rounded-2xl border p-8 sm:p-10"
        >
          {/* 머리 — 제목 + 결재 배지 / 결재란(머리 줄 py-2 · 서명 줄 py-4) */}
          <header aria-hidden className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1.5">
              <div className={`${TEXT_BAR} w-fit text-2xl font-bold tracking-wide whitespace-nowrap`}>지출결의서</div>
              {/* 실물 배지는 11px(종이 허용 목록) — 스켈레톤은 토큰 중 가장 가까운 `text-xs`(종이 12px · 줄 높이 차 1px 미만). */}
              <span className={`${TEXT_BAR} inline-flex border border-transparent px-1.5 py-0.5 text-xs`}>미결재</span>
            </div>
            <table className="border-line border-2 text-xs">
              <tbody>
                <tr>
                  <td rowSpan={2} className="border-line border px-2 py-2">
                    <span className={TEXT_BAR}>결</span>
                  </td>
                  {["담당자", "원장", "대표"].map((label) => (
                    <td key={label} className="border-line border px-5 py-2 whitespace-nowrap">
                      <span className={TEXT_BAR}>{label}</span>
                    </td>
                  ))}
                </tr>
                <tr>
                  {[0, 1, 2].map((i) => (
                    <td key={i} className="border-line border px-5 py-4 whitespace-nowrap">
                      <span className={TEXT_BAR}>서명</span>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </header>
          <div aria-hidden>
            {/* 기본 정보 2줄 → 안내 문장 → 항목(머리 + 1줄) → 합계 → 정산 정보(흔한 2줄) */}
            <PaperTable rows={2} className="mb-4" />
            <p className="mb-3 text-center text-xs">
              <span className={TEXT_BAR}>아래와 같이 금액을 청구하오니 검토 후 지급을 요청합니다.</span>
            </p>
            <PaperTable rows={2} className="mb-4" />
            <div className="border-line mb-4 flex border-2">
              <div className="flex-1 px-4 py-2 text-sm">
                <span className={TEXT_BAR}>합계</span>
              </div>
            </div>
            <PaperTable rows={2} />
          </div>
        </article>
      </div>
    </>
  );
}
