"use client";

import dynamic from "next/dynamic";
import { useState, useTransition } from "react";
import type { MonthStat } from "@/features/enrollment/server/stats-queries";
import type { SchoolStatsPrefs } from "@/features/enrollment/school-view-prefs";
import { saveSchoolStatsPrefs } from "@/features/enrollment/server/school-prefs-actions";

// recharts(~367KB)는 차트가 보일 때만 클라에서 로드(ssr:false) — 첫 페인트 블로킹 제거(B5).
const Impl = dynamic(() => import("./stats-trend-impl").then((m) => m.StatsTrendImpl), {
  ssr: false,
  loading: () => <div className="bg-bg-soft/40 h-[300px] animate-pulse rounded-2xl" />,
});

const chip = (on: boolean) =>
  `rounded-full px-2.5 py-1 text-xs transition ${
    on ? "bg-foreground text-background font-medium" : "text-text-dim hover:text-foreground hover:bg-bg-soft"
  }`;

/**
 * 추이 차트 + **막대 / 전환율 추세선 토글**(원장 2026-08-05).
 *
 * 기본은 막대만 — 곡선은 덧그리는 옵션이다. 토글 상태는 **계정에 저장**한다: localStorage는 포트 포함
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
    setLocal(next);
    startTransition(() => {
      void saveSchoolStatsPrefs({ ...prefs, ...next });
    });
  };

  return (
    <div>
      <div className="mb-2 flex justify-end gap-1">
        <button
          type="button"
          onClick={() => set({ bars: !local.bars })}
          aria-pressed={local.bars}
          title="월별 건수를 막대로 표시합니다. 색은 연도이며 범례가 축 아래에 있습니다."
          className={chip(local.bars)}
        >
          막대
        </button>
        <button
          type="button"
          onClick={() => set({ trendLine: !local.trendLine })}
          aria-pressed={local.trendLine}
          title="등록 전환율(%) 곡선을 겹쳐 봅니다. 오른쪽 축이 전환율입니다."
          className={chip(local.trendLine)}
        >
          전환율 추세선
        </button>
      </div>
      {/* 둘 다 끄면 빈 액자만 남아 "고장났나"로 읽힌다 — 무엇을 하면 되는지 적어 준다. */}
      {!local.bars && !local.trendLine ? (
        <div className="text-text-dim flex h-[300px] items-center justify-center text-sm">
          표시할 것이 없습니다 — 위에서 막대나 추세선을 켜세요
        </div>
      ) : (
        <Impl
          months={months}
          prevYearMonths={prevYearMonths}
          year={year}
          showBars={local.bars}
          showTrendLine={local.trendLine}
        />
      )}
    </div>
  );
}
