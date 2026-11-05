import { PageHeaderSkeleton } from "@/components/page-header";
import { SkeletonLine, SkeletonText } from "@/components/skeleton-text";

/**
 * 공지 상세 스켈레톤 — 실 배치(page.tsx, `space-y-4`): 헤더(제목 · 등록일) → 본문 카드(`bg-card shadow-card rounded-2xl p-5`)
 * → '목록으로' 링크. 고객센터 목록 스켈레톤(탭 · 필터 줄 · 표)을 받으면 모양이 전혀 달라 자기 것을 둔다.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="공지 불러오는 중" className="space-y-4">
      <p className="sr-only">공지를 불러오고 있습니다…</p>
      <PageHeaderSkeleton />
      {/* 본문 — 실물 `p.text-sm leading-relaxed`(줄 26px). 길이는 데이터라 서너 줄 자리. */}
      <div className="bg-card shadow-card rounded-2xl p-5">
        <SkeletonText className="text-sm leading-relaxed break-keep">
          공지 본문 자리입니다. 에이와 운영팀이 알리는 새 기능과 바뀐 점, 점검 일정을 이 자리에 적습니다. 화면마다 무엇이 달라졌는지
          짧게 정리하고, 필요한 경우 메뉴 이름을 함께 적어 바로 찾아갈 수 있게 합니다. 문의는 개선요청으로 남겨 주세요.
        </SkeletonText>
      </div>
      {/* 목록으로(`text-sm` 링크) */}
      <SkeletonLine className="w-16 text-sm" />
    </div>
  );
}
