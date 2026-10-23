"use client";

import dynamic from "next/dynamic";
import { useState, useTransition } from "react";
import { ToolbarChip, ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import type { MonthStat } from "@/features/enrollment/server/stats-queries";
import type { SchoolStatsPrefs } from "@/features/enrollment/school-view-prefs";
import { saveSchoolStatsPrefs } from "@/features/enrollment/server/school-prefs-actions";

// recharts(~367KB)는 차트가 보일 때만 클라에서 로드(ssr:false) — 첫 페인트 블로킹 제거(B5).
const Impl = dynamic(() => import("./stats-trend-impl").then((m) => m.StatsTrendImpl), {
  ssr: false,
  loading: () => <div className="bg-bg-soft/40 h-[300px] animate-pulse rounded-2xl" />,
});

/**
 * 추이 차트 + **그래프 [막대 | 꺾은선] · 전환율 켜고 끄기**(원장 2026-08-05 막대·추세선 토글 →
 * 2026-10-22 *"여기도 막대/꺾은선으로 다른 차트 스타일과 통일"*). 막대·꺾은선은 같은 값(달마다 상담·등록 건수)을 모양만 바꾼다 —
 * '신규 문의 추이'의 '그래프'와 같은 부품. 전환율(%)은 어느 모양에든 오른쪽 축으로 겹친다(기본 꺼짐).
 *
 * 저장은 종전 칸 그대로다 — `bars` true = 막대 · false = 꺾은선, `trendLine` = 전환율. 새 칸이 없어 옛 선택이 이어진다
 * (막대를 끄고 추세선만 보던 계정은 꺾은선 + 전환율로 열린다). 토글 상태는 **계정에 저장**한다: localStorage는 포트 포함
 * origin 단위라 조용히 리셋된다(gotcha #90, 원장 상시 지시 "모든 뷰 세팅은 계정 귀속").
 * ⚠️ 저장 단위가 `users.ui_prefs.enrollmentStats` **한 객체**라 학교 정렬·필터와 형제다 —
 * 그래서 patch가 아니라 `{...prefs, 바꿀것}` 전체를 보낸다(부분만 보내면 형제가 기본값으로 되돌아간다).
 */
export function StatsTrend({
  months,
  prevYearMonths,
  year,
  prefs,
}: {
  months: MonthStat[];
  prevYearMonths: MonthStat[];
  year: number | null;
  prefs: SchoolStatsPrefs;
}) {
  const [local, setLocal] = useState({ bars: prefs.bars, trendLine: prefs.trendLine });
  const [, startTransition] = useTransition();

  const set = (patch: Partial<typeof local>) => {
    const next = { ...local, ...patch };
    if (next.bars === local.bars && next.trendLine === local.trendLine) return;
    setLocal(next);
    startTransition(() => {
      void saveSchoolStatsPrefs({ ...prefs, ...next });
    });
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-end gap-2">
        <ToolbarSegment label="그래프">
          <ToolbarSegmentItem active={local.bars} onClick={() => set({ bars: true })}>
            막대
          </ToolbarSegmentItem>
          <ToolbarSegmentItem active={!local.bars} onClick={() => set({ bars: false })}>
            꺾은선
          </ToolbarSegmentItem>
        </ToolbarSegment>
        <ToolbarChip
          active={local.trendLine}
          onClick={() => set({ trendLine: !local.trendLine })}
          title="등록 전환율(%) 선을 겹쳐 봅니다. 오른쪽 축이 전환율입니다."
        >
          전환율
        </ToolbarChip>
      </div>
      <Impl
        months={months}
        prevYearMonths={prevYearMonths}
        year={year}
        kind={local.bars ? "bar" : "line"}
        showRate={local.trendLine}
      />
    </div>
  );
}
