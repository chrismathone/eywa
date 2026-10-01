import { PageHeaderSkeleton } from "@/components/page-header";

/**
 * 성적 입력 스켈레톤 — 부모(`/exams`) 스켈레톤은 머리글을 창·모바일에서 접는데(`hideCompact`, 통합 대시보드의 머리글이 접히므로)
 * 이 화면의 머리글은 컴팩트 1행으로 남는다. 부모 것을 빌려 쓰면 창·모바일에서 한 줄만큼 튀어 따로 둔다(적대 리뷰).
 * 머리글 = 공용 `PageHeaderSkeleton`(같은 자리의 '화면 최대화' 버튼 — 로딩 동안에도 출구가 그대로).
 */
export default function Loading() {
  return (
    <div className="flex h-full min-h-0 flex-col space-y-5" aria-busy="true" aria-label="성적 입력 불러오는 중">
      <PageHeaderSkeleton />
      <div className="flex flex-wrap gap-3 px-1 py-1">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-line/50 h-(--control-h) w-28 animate-pulse rounded-lg" />
        ))}
      </div>
      <div className="bg-card shadow-card min-h-[14rem] flex-1 space-y-2 rounded-2xl p-4">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="bg-line/40 h-6 w-full animate-pulse rounded" />
        ))}
      </div>
    </div>
  );
}
