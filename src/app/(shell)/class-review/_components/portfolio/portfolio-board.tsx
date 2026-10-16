"use client";

import { startTransition as startSyncTransition, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { HrefSelect } from "@/components/href-select";
import { Toolbar, ToolbarButton } from "@/components/toolbar";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";
import { previousPeriod } from "@/features/teacher-portfolio/evidence-view";
import type { ItemId, StoredPeriod } from "@/features/teacher-portfolio/model/types";
import { refreshTeacherPortfolioNow } from "@/features/teacher-portfolio/server/actions";
import type { PortfolioTeacherEntry } from "@/features/teacher-portfolio/server/queries";
import { periodLabel } from "@/features/teacher-portfolio/view";
import { DetailDialog, type DetailTarget } from "./detail-dialog";
import type { CompareSort } from "@/features/teacher-portfolio/compare";
import { CompareDialog } from "./compare-dialog";
import { ManualEntryDialog } from "./manual-entry-dialog";
import { SatisfactionDialog } from "./satisfaction-dialog";
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
  /** 학생 → 학교·학년(지금 값). */
  studentSchools: Record<string, string>;
  /** 서버가 만든 집계 시각 글자(한국 시간). 클라이언트에서 다시 만들지 않는다. */
  computedLabel: string;
  canRefresh: boolean;
  /** 항목별 내역 '점수 기준' 상자를 접어 둘지 — 계정 귀속(`ui_prefs.portfolio.ruleCollapsed`). */
  ruleCollapsed?: boolean;
  /** 직원 비교 표의 정렬 — 계정 귀속(`ui_prefs.portfolio.compareSort`). */
  compareSort?: CompareSort;
};
type Weeks = Partial<Record<"attendance" | "follow", number>>;
/** 화면에 보이는 달 수 — 그다음 한 달은 전월 비교에만 쓴다. */
const SHOWN_MONTHS = 6;

/** 이 문서에서 집계가 도는 중인지 — 집계 중 면을 바꿨다 돌아와 버튼이 새로 떠도 두 번째 집계를 시작하지 않는다. */
let running = false;

/**
 * 집계는 수십 초 걸린다 — 트랜지션(`startTransition(async …)`)으로 감싸지 않는다. React는 비동기 트랜지션이 도는 동안
 * 새 트랜지션(강사를 고르는 주소 이동 포함)을 모두 그 갈래에 묶어 집계가 끝날 때까지 화면을 안 바꾼다(원장 2026-10-16
 * *"집계중일때 왼쪽 선생님 리스트 클릭이 안되는듯"*). 진행 표시는 보통 상태값으로 둔다.
 */
export function RefreshButton({ label = "지금 집계" }: { label?: string }) {
  const [pending, setPending] = useState(false);
  const run = async () => {
    if (running) return void toast.info("집계가 아직 진행 중입니다");
    running = true;
    setPending(true);
    let ok = false;
    try {
      const result = await refreshTeacherPortfolioNow();
      ok = result.ok;
      if (result.ok) toast.success(result.notice ?? "집계했습니다");
      else toast.error(result.error ?? "집계에 실패했습니다");
    } catch {
      toast.error("집계에 실패했습니다. 잠시 후 다시 시도해 주세요");
    } finally {
      running = false;
    }
    // 새로 그리기는 따로 부르지 않는다 — 액션의 `revalidatePath` 응답이 지금 화면을 다시 그리고, 그사이 강사를 옮겼으면 라우터가 옮긴
    // 화면을 새로 받는다(`needsRefresh`). 따로 부른 refresh가 이동과 겹치면 옮기기 전 화면으로 되돌아갈 수 있다(재리뷰 2026-10-16).
    // 성공이면 버튼 풀기를 트랜지션에 — 새 점수와 함께 풀린다(동기 콜백이라 갈래를 묶지 않는다).
    if (ok) startSyncTransition(() => setPending(false));
    else setPending(false);
  };
  return <ToolbarButton onClick={run} disabled={pending} aria-busy={pending}>{pending ? "집계 중…" : label}</ToolbarButton>;
}

export function PortfolioBoard({ teachers, selected, studentNames, studentSchools, computedLabel, canRefresh, ruleCollapsed = false, compareSort }: Props) {
  const router = useRouter();
  const embed = useEmbed();
  const [moving, startTransition] = useTransition();
  const [monthKey, setMonthKey] = useState<string | null>(null);
  const [tab, setTab] = useState<ItemId>("report");
  const [entryOpen, setEntryOpen] = useState(false);
  const [satisfactionOpen, setSatisfactionOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
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
  // 0 가운데 막대로 그릴 항목 — 보이는 달 전체로 한 번(가감 · 어느 달이든 음수). 달을 바꿔도 축이 그대로다.
  const signedIds = new Set(shown.flatMap((w) => w.items.filter((m) => m.max <= 0 || (m.value ?? 0) < 0).map((m) => m.id)));
  // 만족도 관리 입구 — 도구줄 버튼과 같은 조건(쓰기 권한 · 그 달 만족도 켜짐).
  const canSatisfaction = canRefresh && period.items.some((m) => m.id === "satisfaction" && !m.off);
  const evidence = {
    period, week,
    nameOf: (studentId: string) => studentNames[studentId] || "학생",
    schoolOf: (studentId: string) => studentSchools[studentId] ?? "",
    onSatisfaction: canSatisfaction ? () => { setDetail(null); setSatisfactionOpen(true); } : undefined,
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
        {/* 직원별 항목 비교 — 한 달을 골라 직원 × 항목 표(원장 2026-10-15). */}
        <ToolbarButton onClick={() => setCompareOpen(true)}>직원 비교</ToolbarButton>
        {/* 원장이 만든 지표 · 매출 대비 급여(급여 직접 입력) · 강사 근태(그 달 횟수)가 이 달에 있으면 그 값을 넣는 입구 — 쓰기 권한(집계와 같은 문)이 있을 때만. */}
        {/* 프리랜서 근태는 넣을 칸이 없다(만점 — 직접 입력 창도 그 줄을 세우지 않는다). */}
        {canRefresh && period.items.some((m) => (m.id.startsWith("manual:") || m.id === "payRatio" || (m.id === "punctuality" && !("freelancer" in m && m.freelancer))) && !m.off)
          ? <ToolbarButton onClick={() => setEntryOpen(true)}>직접 입력</ToolbarButton> : null}
        {/* 학부모 만족도 — 확인 대기 글 반영/무시 · 클레임·칭찬 넣기(계획서 3번). */}
        {canSatisfaction ? <ToolbarButton onClick={() => setSatisfactionOpen(true)}>만족도 관리</ToolbarButton> : null}
        <span className="num ml-auto text-xs whitespace-nowrap">집계 {computedLabel}</span>
        {canRefresh ? <RefreshButton /> : null}
      </Toolbar>
      <p className="bg-primary-softer rounded-lg px-3.5 py-2.5 text-xs leading-relaxed">
        <b className="text-primary">월간 평가 · 매월 1일 시작, 말일 마감</b>
        <span className="block">진행 중인 달은 집계 전날까지의 수업을 봅니다. 마감 후 보충한 기록은 지난달 점수에 반영하지 않습니다.</span>
      </p>
      <div className="desk:grid-cols-[15rem_minmax(0,1fr)] grid grid-cols-1 gap-5">
        <TeacherList {...list} />
        <div aria-busy={moving} className={`@container/board flex min-w-0 flex-col gap-5 transition-opacity ${moving ? "opacity-60 delay-100" : ""}`}>
          <TeacherPicker {...list} />
          <ScoreHero period={period} previous={previousPeriod(selected.periods, period.month)} signedIds={signedIds} onOpenMetric={(id) => setDetail({ kind: "metric", id })}
            onOpenLedger={() => setDetail({ kind: "ledger" })} />
          {/* 내역과 월간 점수를 나란히 = 본문 폭이 64rem 이상일 때만(창 폭이 아니라 — 앱 메뉴·강사 목록을 뺀 폭이 좁으면 월간 표가
              카드 밖으로 잘렸다, 원장 2026-10-14). 좁으면 위아래로 쌓는다. */}
          <div className="grid flex-1 grid-cols-1 gap-5 @5xl/board:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] @5xl/board:items-stretch">
            {/* key = 상담·성적 탭은 그 강사·그 달에서만 뜻이 있다 — 바꾸면 처음 탭부터(주 고르기와 같다). */}
            <EvidencePanel key={scope} active={tab} onTab={setTab} evidence={{ ...evidence, onOpenStudents: () => setDetail({ kind: "metric", id: "report" }) }} />
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
      {compareOpen ? (
        <CompareDialog open onClose={() => setCompareOpen(false)} periods={shown} month={period.month} initialSort={compareSort}
          nameOf={(id) => teachers.find((t) => t.id === id)?.name || "직원"} onPick={(id) => { setCompareOpen(false); selectTeacher(id); }} />
      ) : null}
      {satisfactionOpen ? (
        <SatisfactionDialog key={`${selected.id}|${period.month}`} open onClose={() => setSatisfactionOpen(false)}
          period={period} teacherId={selected.id} teacherName={selected.name} nameOfTeacher={(id) => teachers.find((t) => t.id === id)?.name || "다른 선생님"} />
      ) : null}
    </div>
    </RuleBoxPrefProvider>
  );
}
