import { PageHeaderSkeleton } from "@/components/page-header";
import { Toolbar, ToolbarSkeletonItem } from "@/components/toolbar";
import { CONTROL_H, CONTROL_LABEL } from "@/components/ui/control-scale";

/**
 * 성적 입력 스켈레톤 — 부모(`/exams`) 스켈레톤은 머리글을 창·모바일에서 접는데(`hideCompact`, 통합 대시보드의 머리글이 접히므로)
 * 이 화면의 머리글은 컴팩트 1행으로 남는다. 부모 것을 빌려 쓰면 창·모바일에서 한 줄만큼 튀어 따로 둔다(적대 리뷰).
 * 머리글 = 공용 `PageHeaderSkeleton`(같은 자리의 '화면 최대화' 버튼 — 로딩 동안에도 출구가 그대로).
 * 툴바 = 실물 `<Toolbar>`(줄 여백·간격·창 컴팩트 변형이 실물과 같다) + `ToolbarSkeletonItem`.
 * 본문 = ScoreGrid의 flex 기둥(`flex-1 flex-col gap-3`) — 요약 띠(`rounded-xl border py-2.5`) + 남는 높이를 다 갖는 표 카드 + 하단 저장 바.
 */
export default function Loading() {
  return (
    <div className="flex h-full min-h-0 flex-col space-y-5" aria-busy="true" aria-label="성적 입력 불러오는 중">
      <PageHeaderSkeleton />
      {/* 툴바 — 보기(통합·입력·확인) · 년도 · 학기 · 과목 · 반 · 시험 · 시험일 · 만점 · 엑셀.
          칸 폭 = 실물 라벨 길이에 가깝게 — 좁은 창에서 실물과 같은 폭에서 줄이 감긴다. */}
      <Toolbar>
        <ToolbarSkeletonItem className="w-44" />
        <ToolbarSkeletonItem className="w-30" />
        <ToolbarSkeletonItem className="w-28" />
        <ToolbarSkeletonItem className="w-32" />
        <ToolbarSkeletonItem className="w-48" />
        <ToolbarSkeletonItem className="w-40" />
        <ToolbarSkeletonItem className="w-56" />
        <ToolbarSkeletonItem className="w-30" />
        {/* 엑셀 = 쓰기 권한(흔한 경로) 실물 '엑셀 내보내기/가져오기 ▾'(ExcelMenu ghost 버튼) — 공용 Button 기본 크기·여백에 실물 문구를
            투명 글자로(폭이 실물과 같다 · 수납 스켈레톤과 같은 방식). 실물도 `ml-auto`로 오른쪽 끝. */}
        <span className="ml-auto">
          <span
            aria-hidden
            className={`${CONTROL_H} ${CONTROL_LABEL} bg-bg-soft inline-flex shrink-0 animate-pulse items-center gap-1.5 rounded-lg border border-transparent px-2.5 font-medium whitespace-nowrap text-transparent`}
          >
            엑셀 내보내기/가져오기
            <span className="size-4 shrink-0" />
          </span>
        </span>
      </Toolbar>
      <div aria-hidden className="flex min-h-0 w-full flex-1 flex-col gap-3">
        {/* 요약 띠(score-grid.tsx) — 실물 껍데기에 투명 글자(줄 높이 = 실물 text-sm). 띠 자체가 회색이라 띠째 깜빡인다. */}
        <div className="bg-bg-soft border-line flex animate-pulse flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-2.5 text-sm text-transparent">
          <span>입력 00 / 00명</span>
          <span>평균 00 (00%)</span>
          <span>최고 00</span>
          <span>최저 00</span>
        </div>
        <div className="bg-card shadow-card min-h-[14rem] flex-1 space-y-2 rounded-2xl p-4">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="bg-bg-soft h-6 w-full animate-pulse rounded" />
          ))}
        </div>
        {/* 하단 고정 저장 바(score-grid.tsx) — 쓰기 권한이면 서는 흔한 경로라 자리를 둔다(읽기 전용·잠김이면 실물엔 없다).
            같은 표식 `sticky-save-bar`를 단다: 그 표식을 읽는 건 globals.css `main:has(.sticky-save-bar)`(셸 하단 여백 0) 하나뿐이라
            로딩 중에도 하단 여백이 실물과 같아진다. */}
        <div className="sticky-save-bar border-line/60 bg-card sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-3 border-t px-4 py-3">
          <span className="bg-bg-soft animate-pulse rounded text-sm text-transparent">저장 안 된 칸 0개</span>
          <ToolbarSkeletonItem className="w-24" />
        </div>
      </div>
    </div>
  );
}
