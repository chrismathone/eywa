"use client";

import { SheetText } from "@/features/teacher-view/interface-label";

import { useState } from "react";
import { useSubjectMaps } from "@/features/owner/operations-context";
import type { PeriodsConfig } from "@/features/timetable/lib/periods";
import {
  buildSubjectPeriodGrid,
  type GridRowMode,
  type WeekGridRow,
} from "@/features/students/lib/week-grid";
import { tableContentHeight } from "@/features/students/lib/week-grid-row-height";
import { StudentPeriodGrid } from "./student-period-grid";

/**
 * 학생 개인 주간 시간표(읽기전용) — 수업 탭 상단. 과목별 탭(수학/영어/…)으로 그 과목을 실제 시간표처럼
 * (교시축 + 연속 교시 rowSpan 병합, 행 구성은 그 과목 시간표가 처음 여는 뷰의 규칙) 본다.
 * 데이터는 수업 탭이 이미 로드한 current 재사용(추가 쿼리 0). 과목 라벨은 useSubjectMaps(설정 단일 소스).
 */
export function StudentWeekGrid({
  rows,
  config,
  usedRowSubjects,
}: {
  rows: WeekGridRow[];
  config: PeriodsConfig;
  /**
   * '수업 있는 교시만' 그리는 과목 — 서버가 학원설정 `subjects[].defaultView`로 정한다(`rowModeForDefaultView`).
   * 여기 없는 과목은 교시표 전부(기본뷰 규칙).
   */
  usedRowSubjects: readonly string[];
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
  const modeOf = (s: string): GridRowMode => (usedRowSubjects.includes(s) ? "used" : "all");
  // 탭 전환 시 높이 고정 — 각 과목 표의 **내용 높이**(칸 줄 수) 중 최댓값. 행이 적은 과목은 이
  // 총높이에 맞춰 행을 늘려 채운다(2026-07-08). ⚠️ 행수×고정px로 재지 말 것 — v5 xs=14px 세 줄이
  // 46px에 안 들어가 옆 칸으로 흘렀다. 표를 두 번 짓지만 학생 한 명 분이라 비용은 무시할 만하다.
  const tableHeights = subjectKeys.flatMap((s) =>
    [false, true]
      .map((weekend) => buildSubjectPeriodGrid(rows, s, weekend, config, modeOf(s)))
      .filter((g) => g.days.length > 0)
      .map(tableContentHeight),
  );
  const targetTableH = Math.max(1, ...tableHeights);

  // 슬롯 있는 행이 없으면 그리드 숨김(빈 판 방지).
  if (withSlots.length === 0) return null;
  const active = tab && subjectKeys.includes(tab) ? tab : subjectKeys[0]!;

  return (
    <section className="bg-card border-border rounded-2xl border">
      <header className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
        <div>
          <h2 className="text-sm font-bold tracking-tight"><SheetText value={"주간 시간표"} /></h2>
          <p className="text-muted-foreground text-xs">
            <SheetText value={"과목별 교시 시간표 · 실제 등원 요일 기준 (읽기전용)"} /></p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {subjectKeys.map((k) => (
            <TabChip key={k} active={active === k} onClick={() => setTab(k)}>
              <SheetText value={subjects.labelOf(k)} />
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
          rowMode={modeOf(active)}
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
      className={`shrink-0 rounded-full border px-2 py-0.5 text-xs transition ${
        active
          ? "border-primary bg-primary text-primary-foreground font-medium"
          : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
      }`}
    >
      {children}
    </button>
  );
}
