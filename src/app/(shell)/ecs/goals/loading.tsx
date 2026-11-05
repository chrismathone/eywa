import { BigStatSkeleton } from "@/components/atoms/big-stat";
import { PageHeaderSkeleton } from "@/components/page-header";
import { PeriodNavSkeleton } from "@/components/period-nav-skeleton";
import { Toolbar } from "@/components/toolbar";
import { TOOLBAR_SEG_BOX, TOOLBAR_SEG_ITEM, TOOLBAR_SEG_OFF } from "@/components/toolbar-controls";
import { CONTROL_H, CONTROL_LABEL } from "@/components/ui/control-scale";

/**
 * 반 계획 보기 스켈레톤(B7) — 실화면(page.tsx)과 같은 순서: 머리 · 툴바 · 통계 4칸 · 범례 줄 · 표.
 * - 툴바 = 실물과 같은 `<Toolbar>`(반 목록 · '보기' 일간/주간 · 날짜 이동 · '계획' 전체/담임/부담임 · 기간 글자) — 조각마다 실물 상자에
 *   실물 문구를 투명 글자로 깔아 폭이 같다(가장 흔한 경로 = 이번 주 → 일간 보기, 날짜 라벨 폭 152 — goals-period-bar.tsx).
 * - 통계 = 공용 `BigStatSkeleton`(실물 BigStat 넷은 아이콘·보조 줄이 없다 — 옛 `h-20` 면은 실물보다 짧았다).
 * - 표 = goals-table.tsx와 같은 껍데기(머리 줄 + 반 행, 첫 열 195px). 영역 수(4~6)·반 수는 데이터라 근사.
 */
const bar = "bg-bg-soft text-transparent animate-pulse rounded";
/** 실물 ToolbarSegment(라벨 + `TOOLBAR_SEG_BOX` + `TOOLBAR_SEG_ITEM`) — 글자는 투명. */
function SegSkeleton({ label, items }: { label: string; items: readonly string[] }) {
  return (
    <div aria-hidden className="flex items-center gap-1.5">
      <span className={`micro shrink-0 ${bar}`}>{label}</span>
      <div className={`${TOOLBAR_SEG_BOX} animate-pulse`}>
        {items.map((i) => (
          <span key={i} className={`${TOOLBAR_SEG_ITEM} ${TOOLBAR_SEG_OFF}`}>
            <span className="text-transparent">{i}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

const cols = "195px repeat(4, minmax(150px, 1fr))"; // goals-table.tsx `cols`(classWidth 195px)와 같은 꼴 · 영역 4개 근사

export default function EcsGoalsLoading() {
  return (
    <div className="space-y-4">
      <PageHeaderSkeleton />
      <Toolbar>
        {/* '반 목록' — 실물 ToolbarButton 치수(CONTROL_H · rounded-lg · border · px-2) */}
        <span aria-hidden className={`inline-flex ${CONTROL_H} ${CONTROL_LABEL} border-line shrink-0 animate-pulse items-center rounded-lg border px-2 font-medium`}>
          <span className="text-transparent">반 목록</span>
        </span>
        <SegSkeleton label="보기" items={["일간", "주간"]} />
        <PeriodNavSkeleton labelWidth={152} />
        <SegSkeleton label="계획" items={["전체", "담임", "부담임"]} />
        {/* 기간 글자 = 실물 `goals.caption` 꼴("월간 {month} · 주간 {week}") */}
        <span aria-hidden className={`text-sm ${bar}`}>월간 0000년 00월 · 주간 0000년 00월 0주차 (00~00일)</span>
      </Toolbar>
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <BigStatSkeleton key={i} />
        ))}
      </div>
      {/* 범례 줄 — 상태 점 셋 + (역할 '전체'일 때) 안내 글. */}
      <p aria-hidden className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-sm">
        {["같음", "다름", "주간 비어 있음"].map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className="bg-bg-soft size-2.5 animate-pulse rounded-full" />
            <span className={bar}>{s}</span>
          </span>
        ))}
      </p>
      <div aria-hidden className="bg-card shadow-card overflow-hidden rounded-2xl">
        <div className="bg-bg-soft border-line-strong grid border-b" style={{ gridTemplateColumns: cols }}>
          <div className="px-3 py-2 text-base font-bold">
            <span className="text-transparent">반</span>
          </div>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="border-line-strong flex items-center justify-center border-l py-2">
              <span className="bg-card inline-flex h-6 w-20 animate-pulse rounded-full" />
            </div>
          ))}
        </div>
        {Array.from({ length: 6 }, (_, r) => (
          <div key={r} className="border-line-strong grid border-b last:border-b-0" style={{ gridTemplateColumns: cols }}>
            <div className="flex min-w-0 flex-col justify-center gap-0.5 px-3 py-2">
              <span className="text-base font-bold"><span className={bar}>반 이름 자리</span></span>
              <span className="text-sm"><span className={bar}>담임 이름</span></span>
            </div>
            {Array.from({ length: 4 }, (_, c) => (
              // 칸 = 월·주·일 세 줄(py-1 text-sm) — 실물과 같은 줄 상자.
              <div key={c} className="border-line-strong divide-line flex min-w-0 flex-col justify-center divide-y border-l px-2.5 py-1">
                {[0, 1, 2].map((l) => (
                  <div key={l} className="py-1 text-sm">
                    <span className={bar}>교재 · 진도</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
