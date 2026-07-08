"use client";

import { useState } from "react";
import { useSubjectMaps } from "@/features/owner/operations-context";
import type { PeriodsConfig } from "@/features/timetable/lib/periods";
import type { WeekGridRow } from "@/features/students/lib/week-grid";
import { StudentClockGrid } from "./student-clock-grid";
import { StudentPeriodGrid } from "./student-period-grid";

/**
 * 학생 개인 주간 시간표(읽기전용) — 수업 탭 상단. "다른 선생님 수업"까지 한 판에서 본다.
 * 탭: [전체] + 학생이 듣는 과목. '전체'=시각축 통합(전 과목), 과목 탭=교시축 기본뷰(연속 교시 rowSpan 병합).
 * 데이터는 수업 탭이 이미 로드한 current 행 재사용 — 추가 쿼리 0. 과목 라벨/색은 useSubjectMaps(설정 단일 소스).
 */
export function StudentWeekGrid({
  rows,
  config,
}: {
  rows: WeekGridRow[];
  config: PeriodsConfig;
}) {
  const subjects = useSubjectMaps();
  const [tab, setTab] = useState<string>("all");

  // 슬롯(시각) 있는 행이 하나도 없으면 그리드 숨김(빈 판 방지).
  const withSlots = rows.filter((r) => r.slots.length > 0);
  if (withSlots.length === 0) return null;

  // 과목 탭 = 설정 순서 ∩ 학생이 듣는 과목 + 설정에 없는 폴백 과목(뒤에).
  const inSettings = subjects.options
    .map((o) => o.value)
    .filter((v) => withSlots.some((r) => r.subject === v));
  const extra = [...new Set(withSlots.map((r) => r.subject))].filter((s) => !inSettings.includes(s));
  const subjectKeys = [...inSettings, ...extra];
  const active = tab === "all" || subjectKeys.includes(tab) ? tab : "all";

  return (
    <section className="bg-card border-border rounded-md border">
      <header className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">주간 시간표</h2>
          <p className="text-muted-foreground text-xs">전 과목·전 강사 통합 · 실제 등원 요일 기준 (읽기전용)</p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <TabChip active={active === "all"} onClick={() => setTab("all")}>
            전체
          </TabChip>
          {subjectKeys.map((k) => (
            <TabChip key={k} active={active === k} onClick={() => setTab(k)}>
              {subjects.labelOf(k)}
            </TabChip>
          ))}
        </div>
      </header>
      <div className="p-3">
        {active === "all" ? (
          <StudentClockGrid rows={rows} subjects={subjects} />
        ) : (
          <StudentPeriodGrid rows={rows} subject={active} config={config} subjects={subjects} />
        )}
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
