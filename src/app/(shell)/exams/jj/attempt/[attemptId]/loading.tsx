import { SkeletonLine, SkeletonText } from "@/components/skeleton-text";

/**
 * JJ실 시험 결과지 창 스켈레톤(B7) — 인재원 호출(최대 8초)이 창 첫 페인트를 막지 않게.
 * 실표면(링크 줄 + 결과지 틀)과 같은 모양·라운드라 본문이 와도 화면이 튀지 않는다.
 * 머리 = 실물 `SheetFrame`(jj-sheet-parts.tsx)과 같은 마크업 — 소라벨(editorial-eyebrow) · 제목(`mt-0.5 text-xl leading-tight`) ·
 * meta 줄(`mt-1 text-sm`) + 오른쪽 종류 알약, 구분선 = 머리 `border-b pb-3` + 본문 `mt-4`. 글자 자리는 투명 글자(줄 높이 = 실물).
 */
export default function JjAttemptLoading() {
  return (
    <div className="space-y-4">
      {/* 링크 줄(page.tsx nav — text-sm 한 줄) — 높이 = 그 글자의 줄 높이(손 치수 h-5는 이 저장소 text-sm 24px보다 4px 짧았다). */}
      <SkeletonLine className="w-64 max-w-full text-sm" />
      <div className="bg-card shadow-card rounded-2xl px-5 py-4">
        <header className="border-line flex items-start justify-between gap-3 border-b pb-3">
          <div className="min-w-0">
            <SkeletonText className="editorial-eyebrow">시험 결과지</SkeletonText>
            <SkeletonText className="mt-0.5 text-xl leading-tight font-bold">시험 이름 자리</SkeletonText>
            <SkeletonText className="mt-1 text-sm">0000.00.00 00:00 제출 · 걸린 시간 00분</SkeletonText>
          </div>
          <div className="shrink-0 pt-0.5">
            <span className="bg-bg-soft inline-block animate-pulse rounded-full px-2 text-xs text-transparent">시험 종류</span>
          </div>
        </header>
        <div className="mt-4 flex flex-col gap-5">
          <div className="grid gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="bg-bg-soft h-20 animate-pulse rounded-xl" />
            ))}
          </div>
          <div className="bg-bg-soft h-40 animate-pulse rounded-xl" />
        </div>
      </div>
    </div>
  );
}
