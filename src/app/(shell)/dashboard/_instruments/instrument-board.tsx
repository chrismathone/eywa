"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { EyIcon } from "@/components/icons/aywa-icons";
import { saveDashboardChartKind } from "@/features/dashboard/overview/chart-prefs-actions";
import type { ChartKinds, CheckView } from "@/features/dashboard/overview/chart-prefs";
import { boardOf, type Board, type BoardSection } from "@/features/dashboard/layout/board";
import { defaultItems } from "@/features/dashboard/layout/defaults";
import type { PanelId } from "@/features/dashboard/overview/layout";
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
import "./new-shape.css";
import { CoreWork, ViewSwitch, GraphFilter, type BoardMode, type GraphKind } from "./new-shape";

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

/**
 * 보는 사람의 배치 → 새 대시보드 구조(`board.ts`). 배치가 없으면(옛 스냅샷) 원장 기본.
 * 배치 밖 카드 '강사별 업무 현황'은 값이 왔을 때만 오늘 운영 마지막 구역 끝에 선다(추가 값 API가 원장에게만 싣는다 — 대시보드 관리에서 뺀 카드라
 * 배치로는 못 넣는다). 등록 후 3개월 내 퇴원은 이제 배치 카드다(원장 옛 배치는 읽을 때 넣어 준다 — `toBoardItems`).
 */
function boardOfSnapshot(snapshot: OverviewSnapshot): Board {
  const board = boardOf(snapshot.view?.items ?? defaultItems("owner"));
  const placed = new Set([...board.trend, ...board.mix, ...board.today.flatMap((s) => s.panels)]);
  const has = (id: PanelId) => !placed.has(id) && snapshot.sections[id as keyof typeof snapshot.sections]?.data != null;
  const today = board.today.map((s) => ({ ...s, panels: [...s.panels] }));
  if (has("teacherWork")) {
    if (today.length) today[today.length - 1]!.panels.push("teacherWork");
    else today.push({ id: "teacher-work", title: "", note: "", panels: ["teacherWork"] });
  }
  return { ...board, today };
}

function Cards({ ids }: { ids: readonly PanelId[] }) {
  return <div className="card-grid">{ids.map((id) => { const Item = CARDS[id]; return Item ? <Fragment key={id}><Item /></Fragment> : null; })}</div>;
}

function Sections({ list }: { list: readonly BoardSection[] }) {
  return list.filter((s) => s.panels.length).map((section) => (
    <section key={section.id} id={section.id} className="block dashboard-section">
      {section.title ? <div className="block-title"><h2>{section.title}</h2>{section.note ? <p>{section.note}</p> : null}</div> : null}
      <Cards ids={section.panels} />
    </section>
  ));
}

export function InstrumentBoard({ initial, chartKinds, checkView, demoRoster, initialExtras, initialWork }: {
  initial: OverviewSnapshot; chartKinds: ChartKinds; checkView?: CheckView; demoRoster: DemoRosterControl | null; onSwitchDesign: () => void;
  /** 개발 화면 전용 — 주면 서버에 묻지 않는다. */
  initialExtras?: InstrumentExtras;
  initialWork?: WorkBoard;
}) {
  const query = useOverview(initial, { live: !initialExtras });
  const [extras, setExtras] = useState<InstrumentExtras>(initialExtras ?? NO_EXTRAS);
  const [extrasFailed, setExtrasFailed] = useState<readonly string[] | null>(initialExtras ? [] : null);
  const [tick, setTick] = useState(0);
  const [mode, setMode] = useState<BoardMode>("glance");
  const [graph, setGraph] = useState<GraphKind>("all");
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
  const layout = useMemo(() => boardOfSnapshot(snapshot), [snapshot]);

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
          {layout.core.length ? <CoreWork keys={layout.core} /> : null}
          <div className="head" id="top">
            <div>
              <span className="eyebrow">{snapshot.academy || "에이와"} · ACADEMY OVERVIEW</span>
              <h1>학원 전체 현황{view?.scopeLabel ? ` (${view.scopeLabel})` : ""}<span>{snapshot.today.replaceAll("-", ".")}</span></h1>
            </div>
            <div className="head-tools" data-noopen>
              {demoRoster ? <DemoRosterSwitch control={demoRoster} /> : null}
              <span className="fresh"><i className={failed ? "is-warn" : undefined} />{query.isFetching ? "최신 정보 확인 중" : failed ? "일부 정보 갱신 필요" : "자동 갱신"}<small>{clock} 확인 · 5분 주기</small></span>
              <button type="button" className="refresh" aria-label="전체 정보 새로고침" disabled={query.isFetching} onClick={() => { void query.refetch({ cancelRefetch: false }); setTick((n) => n + 1); }}><EyIcon name="sync" size={17} /></button>
            </div>
          </div>
          {(view?.subjectChoices?.length ?? 0) > 1 ? (
            <nav className="subject-choices" aria-label="대시보드 과목">
              {view!.subjectChoices!.map((choice) => <Link key={choice.key} href={`/dashboard?subject=${encodeURIComponent(choice.key)}`} aria-current={view?.activeSubject === choice.key ? "page" : undefined}>{choice.label}</Link>)}
            </nav>
          ) : null}
          {/* 시안: 새 대시보드 모양 — 카드·숫자는 계기판 그대로, 배치만 '한눈에 보기 / 오늘 운영 / 경영 현황'. */}
          <ViewSwitch mode={mode} onMode={setMode} />
          {mode === "glance" ? (
            <>
              <div className="ns-summary">
                <div className="ns-brief"><CheckBoard initialView={checkView} part="secretary" /></div>
                {layout.glance.length ? <div className="ns-kpis"><KpiGrid only={layout.glance} /></div> : null}
              </div>
              <GraphFilter graph={graph} onGraph={setGraph} />
              {[
                graph !== "mix" ? { id: "trend", title: "추이 · 비교", note: "과목을 골라 보거나 '비교'로 과목끼리 겹쳐 봅니다", panels: layout.trend } : null,
                graph !== "trend" ? { id: "mix", title: "비중 · 구성", note: "지금 구성과 비율", panels: layout.mix } : null,
              ].filter((g): g is BoardSection => !!g && g.panels.length > 0).map((g) => (
                <section key={g.id} className={`block dashboard-section ns-group is-${g.id}`}>
                  <div className="block-title"><h2>{g.title}</h2><p>{g.note}</p></div>
                  <Cards ids={g.panels} />
                </section>
              ))}
              <p className="ns-foot">각 카드의 집계 기준은 기존 업무 화면과 같습니다. 원기록이 없거나 확인되지 않은 값은 그래프를 만들어 채우지 않습니다.</p>
            </>
          ) : mode === "today" ? (
            <>
              <KpiGrid only={layout.kpis} />
              <CheckBoard initialView={checkView} part="table" />
              <WorkSection />
              <Sections list={layout.today} />
            </>
          ) : (
            <>
              <KpiGrid only={layout.kpis} />
              <Sections list={[
                { id: "manage-trend", title: "추이 · 비교", note: "", panels: layout.trend },
                { id: "manage-mix", title: "비중 · 구성", note: "", panels: layout.mix },
                ...layout.today,
              ]} />
            </>
          )}
        </div>
      </div>
      <DetailDrawer openRef={openDetail} />
      </WorkProvider>
    </BoardProvider>
  );
}
