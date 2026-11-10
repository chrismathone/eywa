import { BigStatSkeleton } from "@/components/atoms/big-stat";
import { FaceTabsSkeleton } from "@/components/face-tabs-skeleton";
import { PageHeaderSkeleton } from "@/components/page-header";
import { Toolbar, ToolbarDivider, ToolbarSkeletonItem } from "@/components/toolbar";
import type { ReactNode } from "react";
import { SkeletonText } from "@/components/skeleton-text";

const BAR = "bg-bg-soft text-transparent animate-pulse rounded";
// 면 탭 칸 = 실물 면 이름(unified-dashboard.tsx `TABS` — 그 파일 안 상수라 이름만 옮겨 적는다. 면을 바꾸면 여기도).
const FACE_LABELS = ["전체 현황", "성적 현황", "학생 추이", "반별 분석", "학교·학년", "시험 일정"];

/** 탭 안 구획 카드(tab-parts.tsx `Panel`)와 같은 껍데기·같은 제목 줄. */
function PanelSkeleton({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="bg-card shadow-card min-w-0 rounded-2xl p-5">
      <header className="mb-3">
        <SkeletonText className="text-lg font-bold">{title}</SkeletonText>
        {sub ? <SkeletonText className="mt-0.5 text-sm">{sub}</SkeletonText> : null}
      </header>
      {children}
    </section>
  );
}

/** 하락·상승 학생 한 줄(overview-tab.tsx `MoverList`) — 이름 줄 + 시험 알약 줄 / 오른쪽 점수 줄 + `gap-1` + 증감 알약(이 두 줄이 행 높이를 정한다). */
function MoverRows() {
  return (
    <div className="divide-line-faint divide-y">
      {[0, 1, 2].map((i) => (
        <div key={i} className="-mx-2 flex items-center justify-between gap-3 px-2 py-2 text-sm">
          <span className="min-w-0">
            <b className="block"><span className={BAR}>학생 이름 학교 학년</span></b>
            <span className="flex items-center gap-1.5 text-xs">
              <span className="bg-bg-soft animate-pulse rounded-full px-2 py-0.5 text-transparent">시험 종류</span>
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            <span className={`num whitespace-nowrap ${BAR}`}>00점 / 100점</span>
            <span className="bg-bg-soft inline-flex animate-pulse items-center rounded-full px-2 py-0.5 text-xs font-bold text-transparent">000점</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * 성적관리 스켈레톤 — 실 화면([`UnifiedDashboard`](./_components/unified-dashboard.tsx))이 PageHeader를 쓰므로
 * 맨 위는 공용 `PageHeaderSkeleton`(같은 한 줄·같은 자리의 '화면 최대화' 버튼). 손으로 쌓은 막대였을 땐 최대화 중 탭·필터를
 * 바꿀 때마다 버튼이 사라져 출구 줄이 섰다 꺼지며 본문이 튀었다(적대 리뷰). 실 머리글처럼 창·모바일에선 접는다(`hideCompact`).
 * 줄 = 실물: 머리 → 면 탭 줄 → 툴바 줄(ExamsToolbar) → 면 본문. 면이 6개라 본문이 면마다 다르지만 loading.tsx는 주소(?tab=)를
 * 못 읽으므로 **기본 면(전체 현황 · overview-tab.tsx)**에 맞춘다 — 메뉴로 들어오는 첫 화면이 그 면이다.
 * 하위 화면(input·view·jj)은 저마다 loading.tsx가 있어 이 골격을 받지 않는다.
 */
export default function Loading() {
  return <div className="space-y-5 pb-12" aria-busy="true" aria-label="성적관리 불러오는 중">
    <PageHeaderSkeleton hideCompact />
    {/* 면 탭 — 실물 이름의 투명 글자로 칸 폭을 맞춘다. */}
    <FaceTabsSkeleton labels={FACE_LABELS} />
    {/* 툴바 — 기간: 날짜 ~ 날짜 · 과목 · 시험 · 미입력 · 검색 … 엑셀 내보내기 | 성적 입력. */}
    <Toolbar>
      <ToolbarSkeletonItem className="w-10" />
      <ToolbarSkeletonItem className="w-32" />
      <span aria-hidden>~</span>
      <ToolbarSkeletonItem className="w-32" />
      <ToolbarSkeletonItem className="w-24" />
      <ToolbarSkeletonItem className="w-24" />
      <ToolbarSkeletonItem className="w-24" />
      <ToolbarSkeletonItem className="w-20" />
      <span className="ml-auto" />
      <ToolbarSkeletonItem className="w-24" />
      <ToolbarDivider />
      <ToolbarSkeletonItem className="w-20" />
    </Toolbar>
    <div aria-hidden className="space-y-4">
      <SkeletonText className="text-xs">선택한 기간·과목·시험의 기록이 있는 학생 기준입니다.</SkeletonText>
      {/* 지표 5칸(응시·평균·상승·하락·미입력) — 실물 BigStat(아이콘 없음 · 보조 줄 있음). */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => <BigStatSkeleton key={i} sub />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <PanelSkeleton title="학원 통합 추이" sub="월별 평균 정답률">
          {/* 그래프(_components/trend-chart.tsx) — 눈금 열 + 그림 칸 h-44 + 월 줄 h-5. */}
          <div className="mt-3 flex gap-2">
            <div className="h-44 w-11 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="bg-bg-soft h-44 animate-pulse rounded" />
              <div className="mt-2 h-5" />
            </div>
          </div>
        </PanelSkeleton>
        <PanelSkeleton title="시험 종류별 평균" sub="기록 수와 평균 정답률">
          <div className="space-y-1">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_7rem_4rem] items-center gap-3 px-2 py-2 text-sm">
                <span className={BAR}>시험 종류 00건</span>
                <span className="bg-bg-soft h-2 animate-pulse rounded-full" />
                <span className={`${BAR} justify-self-end`}>00%</span>
              </div>
            ))}
          </div>
        </PanelSkeleton>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <PanelSkeleton title="최근 성적 감소한 학생"><MoverRows /></PanelSkeleton>
        <PanelSkeleton title="최근 성적 증가한 학생"><MoverRows /></PanelSkeleton>
      </div>
    </div>
  </div>;
}
