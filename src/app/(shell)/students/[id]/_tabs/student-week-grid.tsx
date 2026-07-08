"use client";

import { useState } from "react";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { subjectWeekdayPeriods, type PeriodsConfig } from "@/features/timetable/lib/periods";
import type { WeekGridRow } from "@/features/students/lib/week-grid";
import { StudentPeriodGrid } from "./student-period-grid";

// 교시 1칸 기준 높이 — 가장 교시 많은 과목(예: 영어 11교시) 기준. 교시 적은 과목은 이 총높이에
// 맞춰 행 높이를 늘려 채운다 → 탭을 바꿔도 카드 높이가 안 흔들림(사용자 요청 2026-07-08).
const BASE_ROW_H = 46;

/**
 * 학생 개인 주간 시간표(읽기전용) — 수업 탭 상단. 과목별 탭(수학/영어/…)으로 그 과목을 실제 시간표
 * 기본뷰처럼(교시축 + 연속 교시 rowSpan 병합) 본다. 데이터는 수업 탭이 이미 로드한 current 재사용(추가 쿼리 0).
 * 과목 라벨은 useSubjectMaps(설정 단일 소스). 첫 과목이 기본 탭.
 */
export function StudentWeekGrid({
  rows,
  config,
}: {
  rows: WeekGridRow[];
  config: PeriodsConfig;
}) {
  const subjects = useSubjectMaps();
  const [tab, setTab] = useState<string | null>(null);

  const withSlots = rows.filter((r) => r.slots.length > 0);
  // 과목 탭 = 설정 순서 ∩ 학생이 듣는 과목 + 설정에 없는 폴백 과목(뒤에).
  const inSettings = subjects.options
    .map((o) => o.value)
    .filter((v) => withSlots.some((r) => r.subject === v));
  const extra = [...new Set(withSlots.map((r) => r.subject))].filter((s) => !inSettings.includes(s));
  const subjectKeys = [...inSettings, ...extra];
  // 탭 전환 시 높이 고정 — 가장 교시 많은 과목 기준 총높이(각 과목 표가 이 높이를 채우도록 행높이 조정).
  const targetTableH =
    BASE_ROW_H * Math.max(1, ...subjectKeys.map((s) => subjectWeekdayPeriods(s, config).length));

  // 슬롯 있는 행이 없으면 그리드 숨김(빈 판 방지).
  if (withSlots.length === 0) return null;
  const active = tab && subjectKeys.includes(tab) ? tab : subjectKeys[0]!;

  return (
    <section className="bg-card border-border rounded-md border">
      <header className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">주간 시간표</h2>
          <p className="text-muted-foreground text-xs">
            과목별 교시 시간표 · 실제 등원 요일 기준 (읽기전용)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {subjectKeys.map((k) => (
            <TabChip key={k} active={active === k} onClick={() => setTab(k)}>
              {subjects.labelOf(k)}
            </TabChip>
          ))}
        </div>
      </header>
      <div className="p-3">
        <StudentPeriodGrid
          rows={rows}
          subject={active}
          config={config}
          subjects={subjects}
          tableHeight={targetTableH}
        />
      </div>
    </section>
  );
}

function TabChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-md border px-2 py-0.5 text-xs transition ${
        active
          ? "border-foreground bg-foreground text-background font-medium"
          : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
      }`}
    >
      {children}
    </button>
  );
}
