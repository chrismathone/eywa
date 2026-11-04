"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { EyIcon } from "@/components/icons/aywa-icons";
import { saveDashboardChartKind } from "@/features/dashboard/overview/chart-prefs-actions";
import type { ChartKinds, CheckView } from "@/features/dashboard/overview/chart-prefs";
import { isHeadingId } from "@/features/dashboard/layout/types";
import { DEFAULT_LAYOUT, KPI_KEYS, type KpiKey, type PanelId } from "@/features/dashboard/overview/layout";
import type { OverviewSnapshot } from "@/features/dashboard/overview/model";
import { withExtras } from "@/features/dashboard/instruments/details";
import { NO_EXTRAS, mergeExtras, type ExtrasReply, type InstrumentExtras } from "@/features/dashboard/instruments/extras-types";
import { programSubjectsOf } from "@/features/students/enrollment/program";
import type { DemoRosterControl } from "@/features/demo-roster/types";
import { DemoRosterSwitch } from "../_components/demo-roster-switch";
import { useOverview } from "../_overview/use-overview";
import { CheckBoard } from "./check-board";
import { WorkProvider } from "./work/work-context";
import { WorkSection } from "./work/work-section";
import type { WorkBoard } from "@/features/work-requests/model";
import { V } from "./engine";
import { DetailDrawer } from "./drawer";
import { KpiGrid } from "./kpis";
import { BoardProvider, type BoardValue, type TrendId } from "./parts";
import { AttendanceCard, Billing6Card, BillingMonthCard, ChangesCard, CourseTrendCard, EarlyExitsCard, EnrolledTrendCard, NewcomerStagesCard, StudentsCompCard } from "./panels-operations";
import { AdmissionsCard, Attendance14Card, ConsultProgressCard, GradesCard, RepeatAbsenceCard, ReportsCard, SchoolsCard, StudentConsultCard, SubjectsCard } from "./panels-students";
import { AdmissionsScheduleCard, ExpensesCard, NewcomerChecksCard, NoticesCard, NowClassesCard, OperationsCard, SheetsCard, StaffCard, TeacherWorkCard } from "./panels-work";
import "./instruments.css";

const CARDS: Record<PanelId, () => ReactNode> = {
  studentsComp: StudentsCompCard, attendance: AttendanceCard, billingMonth: BillingMonthCard, newcomerStages: NewcomerStagesCard, changes: ChangesCard, billing6: Billing6Card,
  earlyExits: EarlyExitsCard, enrolledTrend: EnrolledTrendCard, courseTrend: CourseTrendCard, subjects: SubjectsCard, grades: GradesCard, schools: SchoolsCard, admissions: AdmissionsCard,
  repeatAbsence: RepeatAbsenceCard, attendance14: Attendance14Card, consultProgress: ConsultProgressCard, reports: ReportsCard, studentConsult: StudentConsultCard,
  newcomerChecks: NewcomerChecksCard, sheets: SheetsCard, nowClasses: NowClassesCard, admissionsSchedule: AdmissionsScheduleCard, staff: StaffCard, operations: OperationsCard,
  expenses: ExpensesCard, notices: NoticesCard, teacherWork: TeacherWorkCard,
};

/** 이 안에 읽은 추가 값은 스냅샷이 다시 읽혀도 다시 읽지 않는다([새로 고침] 한 번에 두 번 읽지 않게 · 저장 신호 · 창 복귀가 잦아도 한 번). */
const EXTRAS_FRESH_MS = 60_000;
const clockOf = (at: number) =>new Date(at).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false });

type BoardSection = { id: string; title: string; note: string; panels: PanelId[] };

/** 기본 배치 밖 두 카드의 자리 — 값이 왔을 때만 선다(원장 화면에만 실린다). */
function withOuterCards(sections: BoardSection[]): BoardSection[] {
  const placed = new Set(sections.flatMap((s) => s.panels));
  return sections.map((section, i) => {
    const panels = [...section.panels];
    const at = panels.indexOf("billing6");
    if (!placed.has("earlyExits") && at >= 0) panels.splice(at + 1, 0, "earlyExits");
    if (!placed.has("teacherWork") && i === sections.length - 1) panels.push("teacherWork");
    return { ...section, panels };
  });
}

/** 배치 → 구역. 저장된 배치는 구역 머리와 순서를 그대로 따른다. */
function sectionsOf(snapshot: OverviewSnapshot) {
  const view = snapshot.view;
  const classic = !view ? DEFAULT_LAYOUT : view.mode === "classic" ? (view.classic ?? DEFAULT_LAYOUT) : null;
  if (classic) {
    return {
      kpis: classic.kpis,
      sections: withOuterCards(classic.sections.map((section) => ({
        id: section.id, title: section.title, note: section.note,
        panels: section.panels.flatMap((slot): PanelId[] => (slot === "followup" ? ["reports", "studentConsult"] : [slot])),
      }))),
    };
  }
  const items = view?.items ?? [];
  const sections: BoardSection[] = [];
  let current: BoardSection = { id: "board", title: "", note: "", panels: [] };
  for (const item of items) {
    if (isHeadingId(item.id)) {
      if (current.panels.length) sections.push(current);
      current = { id: item.id, title: item.title ?? "", note: item.note ?? "", panels: [] };
    } else if (item.id.startsWith("panel:")) current.panels.push(item.id.slice(6) as PanelId);
  }
  if (current.panels.length) sections.push(current);
  return {
    kpis: items.filter((i) => i.id.startsWith("kpi:")).map((i) => i.id.slice(4) as KpiKey).filter((k) => KPI_KEYS.includes(k)),
    sections: withOuterCards(sections),
  };
}

export function InstrumentBoard({ initial, chartKinds, checkView, demoRoster, onSwitchDesign, initialExtras, initialWork }: {
  initial: OverviewSnapshot; chartKinds: ChartKinds; checkView?: CheckView; demoRoster: DemoRosterControl | null; onSwitchDesign: () => void;
  /** 개발 화면 전용 — 주면 서버에 묻지 않는다. */
  initialExtras?: InstrumentExtras;
  initialWork?: WorkBoard;
}) {
  const query = useOverview(initial, { live: !initialExtras });
  const [extras, setExtras] = useState<InstrumentExtras>(initialExtras ?? NO_EXTRAS);
  const [extrasFailed, setExtrasFailed] = useState<readonly string[] | null>(initialExtras ? [] : null);
  const [tick, setTick] = useState(0);
  const [kinds, setKinds] = useState(chartKinds);
  const [picks, setPicks] = useState<Record<TrendId, string>>({ changes: "전체", billing: "전체", enrolledTrend: "전체", courseTrend: "전체" });
  const openDetail = useRef<(key: string, focus: string | undefined, from: HTMLElement | null) => void>(() => undefined);
  const snapshot = useMemo(() => withExtras(query.data, extras), [query.data, extras]);
  const rev = snapshot.view?.rev ?? "";

  useEffect(() => V.attachTips(), []);
  // 추가 값 — 열 때 · [새로 고침] · 배치가 바뀔 때(`rev`)는 전부, 스냅샷이 다시 읽힐 때는 확인할 일 · 비서에 드는 칸만(`?part=checks` — 긴 추이 ·
  // 청구는 다시 돌리지 않는다 · 카드 숫자와 확인할 일 줄이 같은 때의 값이 되게). 1분 안에 읽었으면 건너뛴다. 과목 탭과는 무관한 값이다.
  // 늦게 시작한 조회의 답만 쓰고, 못 읽은 칸은 이전 값을 둔다(`mergeExtras` · 화면은 `extrasFailed`로 알린다).
  const extrasRun = useRef({ at: 0, tick: -1, rev: "", seq: 0 });
  useEffect(() => {
    if (initialExtras) return;
    const run = extrasRun.current;
    const full = run.tick !== tick || run.rev !== rev;
    if (!full && Date.now() - run.at < EXTRAS_FRESH_MS) return;
    const seq = ++run.seq;
    Object.assign(run, { at: Date.now(), tick, rev });
    fetch(`/api/dashboard/instruments${full ? "" : "?part=checks"}`, { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<ExtrasReply>) : null))
      .catch(() => null)
      .then((reply) => {
        if (seq !== run.seq) return;
        if (!reply) { setExtrasFailed(["*"]); return; } // 카드 숫자는 스냅샷에서 이미 나왔다 — 비서만 멈춘다
        setExtras((prev) => mergeExtras(prev, reply));
        setExtrasFailed(reply.failed ?? []);
      });
  }, [rev, tick, initialExtras, query.dataUpdatedAt]);

  const setKind = useCallback((id: TrendId, kind: "bar" | "line") => {
    setKinds((prev) => ({ ...prev, [id]: kind }));
    void saveDashboardChartKind(id, kind).catch(() => undefined);
  }, []);
  const setPick = useCallback((id: TrendId, pick: string) => setPicks((prev) => ({ ...prev, [id]: pick })), []);

  const view = snapshot.view;
  const amounts = view?.monthAmounts ?? true;
  const subjects = useMemo(() => programSubjectsOf(snapshot.subjects), [snapshot.subjects]);
  const eieOn = snapshot.eie !== false;
  const lastTimes = Object.values(snapshot.sections).flatMap((s) => (s.at === null ? [] : [s.at]));
  const clock = clockOf(lastTimes.length ? Math.max(...lastTimes) : snapshot.requestedAt);
  const board = useMemo<BoardValue>(() => {
    const custom = new Map((view?.items ?? []).flatMap((i) => (i.title ? [[i.id, i.title] as const] : [])));
    const wide = new Set(view?.academyWide ?? []);
    return {
      snapshot, v: snapshot.sections, extras, extrasFailed, subjects, eieOn, amounts, clock, kinds, setKind, picks, setPick,
      title: (id, base) => `${custom.get(`panel:${id}`) ?? base}${wide.has(`panel:${id}`) ? " (학원 전체)" : ""}`,
    };
  }, [snapshot, view, extras, extrasFailed, subjects, eieOn, amounts, clock, kinds, setKind, picks, setPick]);
  const layout = useMemo(() => sectionsOf(snapshot), [snapshot]);

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-noopen], a[href]")) return;
    const host = target.closest<HTMLElement>("[data-detail]");
    if (!host?.dataset.detail) return; // 상세가 없는 키는 상세 창이 열지 않는다
    const mark = target.closest<HTMLElement>("[data-viz-tip]");
    const focus = mark?.dataset.label ?? mark?.dataset.vizTip?.split("|")[1]?.split(" · ")[0];
    openDetail.current(host.dataset.detail, focus, host.querySelector<HTMLElement>(".card-open") ?? host);
  };

  const failed = query.isError || Object.values(snapshot.sections).some((s) => s.error) || !!extrasFailed?.length;
  return (
    <BoardProvider value={board}>
      <WorkProvider today={snapshot.today} demo={initialWork} tick={tick}>
      <div className="aywa-instruments aywa-board" onClick={onClick}>
        <div className="body">
          <div className="head" id="top">
            <div>
              <span className="eyebrow">{snapshot.academy || "에이와"} · ACADEMY OVERVIEW</span>
              <h1>학원 전체 현황{view?.scopeLabel ? ` (${view.scopeLabel})` : ""}<span>{snapshot.today.replaceAll("-", ".")}</span></h1>
            </div>
            <div className="head-tools" data-noopen>
              {demoRoster ? <DemoRosterSwitch control={demoRoster} /> : null}
              <button type="button" className="design-switch" onClick={onSwitchDesign}>대시보드 전환</button>
              <span className="fresh"><i className={failed ? "is-warn" : undefined} />{query.isFetching ? "최신 정보 확인 중" : failed ? "일부 정보 갱신 필요" : "자동 갱신"}<small>{clock} 확인 · 5분 주기</small></span>
              <button type="button" className="refresh" aria-label="전체 정보 새로고침" disabled={query.isFetching} onClick={() => { void query.refetch({ cancelRefetch: false }); setTick((n) => n + 1); }}><EyIcon name="sync" size={17} /></button>
            </div>
          </div>
          {(view?.subjectChoices?.length ?? 0) > 1 ? (
            <nav className="subject-choices" aria-label="대시보드 과목">
              {view!.subjectChoices!.map((choice) => <Link key={choice.key} href={`/dashboard?subject=${encodeURIComponent(choice.key)}`} aria-current={view?.activeSubject === choice.key ? "page" : undefined}>{choice.label}</Link>)}
            </nav>
          ) : null}
          <KpiGrid only={layout.kpis} />
          <CheckBoard initialView={checkView} />
          <WorkSection />
          {layout.sections.map((section) => (
            <section key={section.id} id={section.id} className="block dashboard-section">
              {section.title ? <div className="block-title"><h2>{section.title}</h2><p>{section.note}</p></div> : null}
              <div className="card-grid">
                {section.panels.map((id) => { const Item = CARDS[id]; return Item ? <Fragment key={id}><Item /></Fragment> : null; })}
              </div>
            </section>
          ))}
        </div>
      </div>
      <DetailDrawer openRef={openDetail} />
      </WorkProvider>
    </BoardProvider>
  );
}
