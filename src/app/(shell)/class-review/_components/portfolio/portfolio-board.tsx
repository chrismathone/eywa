"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { HrefSelect } from "@/components/href-select";
import { Toolbar, ToolbarButton } from "@/components/toolbar";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";
import type { ItemId, StoredPeriod } from "@/features/teacher-portfolio/model/types";
import { refreshTeacherPortfolioNow } from "@/features/teacher-portfolio/server/actions";
import type { PortfolioTeacherEntry } from "@/features/teacher-portfolio/server/queries";
import { periodLabel } from "@/features/teacher-portfolio/view";
import { DetailDialog, type DetailTarget } from "./detail-dialog";
import { ManualEntryDialog } from "./manual-entry-dialog";
import { ClassBox, EvidencePanel, MonthlyTable } from "./lower-panels";
import { RuleBoxPrefProvider } from "./rule-box-pref";
import { ScoreHero } from "./score-hero";
import { TeacherList, TeacherPicker } from "./teacher-list";

/**
 * 직원 포트폴리오 — 한 강사의 최근 6개월을 한 번에 받아 달·탭·주는 화면 안에서 바꾼다.
 * 달을 바꿀 때 서버를 다시 다녀오지 않아야 게이지가 이전 값에서 새 값으로 이어 움직인다.
 * 강사를 바꾸는 것만 주소 이동이다(`?teacher=`) — 이전 화면을 띄워 둔 채 넘어간다.
 */
type Props = {
  teachers: PortfolioTeacherEntry[];
  selected: { id: string; name: string; periods: StoredPeriod[] };
  studentNames: Record<string, string>;
  /** 서버가 만든 집계 시각 글자(한국 시간). 클라이언트에서 다시 만들지 않는다. */
  computedLabel: string;
  canRefresh: boolean;
  /** 항목별 내역 '점수 기준' 상자를 접어 둘지 — 계정 귀속(`ui_prefs.portfolio.ruleCollapsed`). */
  ruleCollapsed?: boolean;
};
type Weeks = Partial<Record<"attendance" | "follow", number>>;
/** 화면에 보이는 달 수 — 그다음 한 달은 전월 비교에만 쓴다. */
const SHOWN_MONTHS = 6;

export function RefreshButton({ label = "지금 집계" }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = () => startTransition(async () => {
    const result = await refreshTeacherPortfolioNow();
    if (result.ok) {
      toast.success(result.notice ?? "집계했습니다");
      router.refresh();
    } else toast.error(result.error ?? "집계에 실패했습니다");
  });
  return <ToolbarButton onClick={run} disabled={pending} aria-busy={pending}>{pending ? "집계 중…" : label}</ToolbarButton>;
}

export function PortfolioBoard({ teachers, selected, studentNames, computedLabel, canRefresh, ruleCollapsed = false }: Props) {
  const router = useRouter();
  const embed = useEmbed();
  const [moving, startTransition] = useTransition();
  const [monthKey, setMonthKey] = useState<string | null>(null);
  const [tab, setTab] = useState<ItemId>("report");
  const [entryOpen, setEntryOpen] = useState(false);
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const shown = selected.periods.slice(0, SHOWN_MONTHS);
  const index = Math.max(0, shown.findIndex((w) => w.month === monthKey));
  const period = shown[index];
  // 펼친 주는 그 강사·그 달에서만 뜻이 있다 — 다른 달로 가면 처음(가장 최근 주)부터.
  const scope = `${selected.id}|${period?.month ?? ""}`;
  const [weekState, setWeekState] = useState<{ scope: string; weeks: Weeks }>({ scope, weeks: {} });
  const week = weekState.scope === scope ? weekState.weeks : {};

  if (!period) return <EmptyState compact title="아직 집계된 달이 없습니다" description="집계가 끝나면 이 강사의 점수가 표시됩니다." />;

  const hrefOf = (teacherId: string) => `/class-review?tab=portfolio&teacher=${teacherId}`;
  const selectTeacher = (teacherId: string) => {
    if (teacherId === selected.id) return;
    const href = hrefOf(teacherId);
    startTransition(() => router.push(embed ? withEmbed(href) : href, { scroll: false }));
  };
  const evidence = {
    period, week,
    nameOf: (studentId: string) => studentNames[studentId] || "학생",
    onWeek: (metric: "attendance" | "follow", at: number) => setWeekState({ scope, weeks: { ...week, [metric]: at } }),
  };
  const list = { teachers, selectedId: selected.id, month: period.month, period, hrefOf, onSelect: selectTeacher };

  return (
    <RuleBoxPrefProvider initialCollapsed={ruleCollapsed}>
    <div className="flex min-w-0 flex-col gap-4">
      <Toolbar>
        <HrefSelect axisLabel="평가 기간" ariaLabel="평가 기간 선택" value={period.month} onSelect={setMonthKey}
          options={shown.map((w) => ({ value: w.month, label: periodLabel(w) }))} />
        <ToolbarButton onClick={() => setDetail({ kind: "criteria" })}>평가 기준</ToolbarButton>
        {/* 원장이 만든 지표나 매출 대비 급여(급여 직접 입력)가 이 달에 있으면 그 값을 넣는 입구 — 쓰기 권한(집계와 같은 문)이 있을 때만. */}
        {canRefresh && period.items.some((m) => (m.id.startsWith("manual:") || m.id === "payRatio") && !m.off)
          ? <ToolbarButton onClick={() => setEntryOpen(true)}>직접 입력</ToolbarButton> : null}
        <span className="num ml-auto text-xs whitespace-nowrap">집계 {computedLabel}</span>
        {canRefresh ? <RefreshButton /> : null}
      </Toolbar>
      <p className="bg-primary-softer rounded-lg px-3.5 py-2.5 text-xs leading-relaxed">
        <b className="text-primary">월간 평가 · 매월 1일 시작, 말일 마감</b>
        <span className="block">진행 중인 달은 집계 전날까지의 수업을 봅니다. 마감 후 보충한 기록은 지난달 점수에 반영하지 않습니다.</span>
      </p>
      <div className="desk:grid-cols-[15rem_minmax(0,1fr)] grid grid-cols-1 gap-5">
        <TeacherList {...list} />
        <div aria-busy={moving} className={`flex min-w-0 flex-col gap-5 transition-opacity ${moving ? "opacity-60 delay-100" : ""}`}>
          <TeacherPicker {...list} />
          <ScoreHero period={period} previous={selected.periods[index + 1]} onOpenMetric={(id) => setDetail({ kind: "metric", id })}
            onOpenLedger={() => setDetail({ kind: "ledger" })} />
          <div className="grid flex-1 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:items-stretch">
            <EvidencePanel active={tab} onTab={setTab} evidence={{ ...evidence, onOpenStudents: () => setDetail({ kind: "metric", id: "report" }) }} />
            <div className="flex min-w-0 flex-col gap-5">
              <MonthlyTable periods={shown} selected={period.month} onMonth={setMonthKey}
                onOpen={(month, target) => { setMonthKey(month); if (target.kind === "metric") setTab(target.id); setDetail(target); }} />
              <ClassBox classes={period.classes} />
            </div>
          </div>
        </div>
      </div>
      <DetailDialog target={detail} onClose={() => setDetail(null)} periods={shown} teacherName={selected.name} evidence={evidence} />
      {entryOpen ? (
        <ManualEntryDialog key={`${selected.id}|${period.month}`} open onClose={() => setEntryOpen(false)}
          period={period} teacherId={selected.id} teacherName={selected.name} />
      ) : null}
    </div>
    </RuleBoxPrefProvider>
  );
}
