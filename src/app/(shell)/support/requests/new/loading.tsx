import { PageHeaderSkeleton } from "@/components/page-header";
import { SkeletonLine } from "@/components/skeleton-text";

/** 라벨 — 실물 `text-sm font-bold`(24px). */
const LABEL = "text-sm font-bold";
/** 실물 입력칸(request-form `INPUT` — `mt-1 h-(--control-h) rounded-lg border`). */
const INPUT = "border-line bg-bg-soft mt-1 h-(--control-h) w-full animate-pulse rounded-lg border";

/**
 * 개선요청 글쓰기 스켈레톤 — 실 배치(page.tsx, `space-y-4`): 헤더(설명 포함) → 폼 카드(`bg-card shadow-card space-y-3 rounded-2xl p-5`:
 * 제목 · 연락처/이메일 2열 · 내용 편집기 · 등록 버튼) → '목록으로'. 편집기 자리는 편집기 자신의 준비 중 틀(h-36)과 같은 높이.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="개선요청 글쓰기 불러오는 중" className="space-y-4">
      <p className="sr-only">글쓰기 화면을 불러오고 있습니다…</p>
      <PageHeaderSkeleton />
      <div className="bg-card shadow-card space-y-3 rounded-2xl p-5">
        <div>
          <SkeletonLine className={`w-10 ${LABEL}`} />
          <div className={INPUT} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i}>
              <SkeletonLine className={`w-24 ${LABEL}`} />
              <div className={INPUT} />
            </div>
          ))}
        </div>
        <div>
          <SkeletonLine className={`w-10 ${LABEL}`} />
          <div className="border-line bg-bg-soft h-36 animate-pulse rounded-lg border" />
        </div>
        <div className="bg-bg-soft h-(--control-h) w-16 animate-pulse rounded-lg" />
      </div>
      {/* 목록으로(`text-sm` 링크) */}
      <SkeletonLine className="w-16 text-sm" />
    </div>
  );
}
