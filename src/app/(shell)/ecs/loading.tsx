import { PageHeaderSkeleton } from "@/components/page-header";
import { ToolbarSkeletonItem } from "@/components/toolbar";

/**
 * ECS 랜딩 스켈레톤(B7) — 실표면(page.tsx · landing-list.tsx)과 같은 클래스로 그린다(줄 높이는 투명 글자가 잡는다).
 * - 면 탭(주간/교실)은 **툴바 줄의 첫 항목**인 세그먼트 상자다(`EcsFaceTabs` — 1차 면 탭 밑줄 아님) → 단독 줄로 그리지 않는다.
 * - 목록 카드 머리 띠(요약 줄)는 09-09 실물에서 걷혔다 → 그리지 않는다(강사 본인 화면의 이름 줄은 강사가 '오늘' 면으로 떨어져 안 쓴다).
 * - 가장 흔한 경로 = 사무실 · 주간 면 · EiE/인재원 영어 좌우 2단. ⚠️ 강사는 기본 면이 '오늘'(반별 시트)이라 본문 모양이 다르다 —
 *   loading.tsx는 주소·역할을 못 읽어 감수한다(머리글·툴바 줄 높이는 같다).
 */
// 투명 글자 막대 — 라운드는 따로(같은 축 유틸 두 개면 승자를 CSS 순서가 정한다, [[#116]]).
const fill = "bg-bg-soft text-transparent animate-pulse";
const bar = `${fill} rounded`;
// 묶음 안 행 수 — 실데이터 평균(담임 한 명 3~5반)에 맞춘 근사.
const GROUPS = [4, 3, 5, 3];

/** 한 단의 담임 묶음 — `shouting` = EiE 단만 52px Shouting 칸(landing-list.tsx — 인재원 영어 단엔 그 칸이 없다). */
function TeacherGroups({ shouting }: { shouting: boolean }) {
  return (
    // 한 단 안의 다단 = landing-list.tsx `PANEL_COLUMNS`와 같은 값.
    <div className="columns-1 gap-x-5 xl:columns-2">
      {GROUPS.map((rows, g) => (
        <div key={g} className="mb-3 break-inside-avoid">
          <div className="border-line-strong flex items-baseline gap-1.5 border-b px-1 pb-0.5">
            <span className={`text-base font-extrabold ${bar}`}>담임 이름</span>
          </div>
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="border-line-faint flex items-center border-b">
              {/* 순서 손잡이 — 사무실·강사 본인 화면(순서 바꾸기 가능, landing-order-rows.tsx Row: p-0.5 + 14px 아이콘 · -ml-0.5) */}
              <span className="-ml-0.5 shrink-0 rounded p-0.5">
                <span className="block size-3.5" />
              </span>
              <div className="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-2.5 sm:py-[7px]">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  <span className={bar}>반 이름 자리</span>
                </span>
                {shouting ? (
                  <span className="w-[52px] shrink-0 text-right">
                    <span className={`num rounded-pill border border-transparent px-1 py-px text-xs font-bold ${fill}`}>0/0</span>
                  </span>
                ) : null}
                <span className={`w-11 shrink-0 text-xs ${bar}`}>0/0</span>
                <span className="bg-bg-soft h-1.5 w-10 shrink-0 animate-pulse rounded-full" />
              </div>
              <span className={`ml-1 shrink-0 rounded-full border border-transparent px-1.5 py-px text-xs ${fill}`}>달력</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function EcsLandingLoading() {
  return (
    <div className="space-y-4">
      <PageHeaderSkeleton />
      {/* 툴바 — 실물도 `<Toolbar>`가 아니라 같은 클래스의 손 div다(카드 껍데기 없음). 면 탭 · 주 이동 · 프로그램 · 담임 ·
          (오른쪽) 반 계획 보기 · 계획 대비 현황. 높이는 컨트롤 변수(`ToolbarSkeletonItem`). */}
      <div aria-hidden className="flex flex-wrap items-center gap-3 px-1 py-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`micro mr-0.5 ${bar}`}>면</span>
          <ToolbarSkeletonItem className="w-28" />
        </div>
        <ToolbarSkeletonItem className="w-72" />
        <ToolbarSkeletonItem className="w-56" />
        <ToolbarSkeletonItem className="w-44" />
        <ToolbarSkeletonItem className="ml-auto w-24" />
        <ToolbarSkeletonItem className="w-24" />
      </div>
      <div aria-hidden className="bg-card shadow-card rounded-2xl px-3 py-2.5">
        {/* 좌우 2단(EiE | 인재원 영어) — 단마다 프로그램 알약 머리 + 담임 묶음 다단. */}
        <div className="grid grid-cols-1 gap-y-4 md:grid-cols-2 md:gap-x-5">
          {[0, 1].map((p) => (
            <div key={p} className={p === 1 ? "md:border-line-faint md:border-l md:pl-5" : undefined}>
              <div className="border-line mb-2 flex items-baseline gap-1.5 border-b px-1 pb-1.5">
                <span className={`rounded-pill border border-transparent px-2.5 py-0.5 text-lg font-extrabold ${fill}`}>프로그램</span>
              </div>
              <TeacherGroups shouting={p === 0} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
