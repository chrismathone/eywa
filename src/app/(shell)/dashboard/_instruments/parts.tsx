"use client";

import { createContext, useContext, type ReactNode } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import type { ChartKind, ChartKinds } from "@/features/dashboard/overview/chart-prefs";
import type { OverviewSnapshot, Section, Sections } from "@/features/dashboard/overview/model";
import type { PanelId } from "@/features/dashboard/overview/layout";
import type { InstrumentExtras } from "@/features/dashboard/instruments/extras-types";
import type { ProgramSubject } from "@/features/students/enrollment/program";
import { V } from "./engine";
import { VizSlot } from "./viz-slot";

export const PANEL_H = 164;

export type TrendId = "changes" | "billing" | "enrolledTrend" | "courseTrend";

export type BoardValue = {
  snapshot: OverviewSnapshot;
  v: Sections;
  extras: InstrumentExtras;
  /** 추가 값 읽기 — null = 아직 못 받음 · [] = 다 받음 · ["*"] = 읽기가 통째로 실패 · 칸 이름 = 그 칸을 못 받음(이전 값 그대로). */
  extrasFailed: readonly string[] | null;
  subjects: readonly ProgramSubject[];
  eieOn: boolean;
  amounts: boolean;
  clock: string;
  title: (id: PanelId, base: string) => string;
  kinds: ChartKinds;
  setKind: (id: TrendId, kind: ChartKind) => void;
  picks: Record<TrendId, string>;
  setPick: (id: TrendId, pick: string) => void;
};

const BoardContext = createContext<BoardValue | null>(null);
export const BoardProvider = BoardContext.Provider;
export function useBoard(): BoardValue {
  const value = useContext(BoardContext);
  if (!value) throw new Error("useBoard는 InstrumentBoard 안에서만 쓴다");
  return value;
}

export function GoIcon() {
  return <EyIcon name="externalLink" size={11} className="go" aria-hidden />;
}

const clockOf = (at: number) => new Date(at).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false });

/** 카드 머리 오른쪽 수치. */
export type CardValue = { label: string; num: string | number; unit?: string };

/** 카드 한 장 — 어디를 눌러도 상세가 열린다. 실패 문구는 운영실 카드와 같다(0건으로 읽히지 않게). */
export function Card({ id, title, note, tone, cls, tools, value, sections, children }: {
  id: string; title: string; note: string; tone?: "alert"; cls?: string; tools?: ReactNode; value?: CardValue;
  sections: (Section<unknown> | undefined)[]; children: ReactNode;
}) {
  const visible = sections.filter((s): s is Section<unknown> => !!s);
  if (!visible.length) return null;
  const failed = visible.some((s) => s.error);
  const slow = visible.some((s) => s.timedOut);
  const times = visible.flatMap((s) => (s.at === null ? [] : [s.at]));
  const available = times.length > 0;
  return (
    <article className={`card${tone ? ` is-${tone}` : ""}${cls ? ` ${cls}` : ""}`} id={`panel-${id}`} data-panel-id={id} data-detail={id}>
      <header className="card-head">
        <div className="card-title">
          <h3><button type="button" className="card-open">{title}<GoIcon /></button></h3>
          <p>{note}</p>
        </div>
        {tools}
        {value ? <div className="card-value"><span>{value.label}</span><b>{value.num}</b>{value.unit ? <em>{value.unit}</em> : null}</div> : null}
      </header>
      <div className="card-body">{available ? children : <p className="foot">정보를 불러오지 못했습니다. 새로고침하면 다시 조회합니다.</p>}</div>
      {failed ? (
        <p className="foot is-alert">
          {slow
            ? available ? `시간이 오래 걸려 일부를 못 갱신했습니다 · ${clockOf(Math.min(...times))} 확인값 표시 중` : "시간이 오래 걸려 못 불러왔습니다 · 0건을 의미하지 않습니다"
            : available ? `일부 갱신 실패 · ${clockOf(Math.min(...times))} 확인값 포함` : "조회 실패 · 0건을 의미하지 않습니다"}
        </p>
      ) : null}
    </article>
  );
}

export const Stat = ({ label, value, alert }: { label: string; value: string; alert?: boolean }) => (
  <span className={`stat${alert ? " is-alert" : ""}`}>{label} <b>{value}</b></span>
);
export const StatRow = ({ children }: { children: ReactNode }) => <div className="stat-row">{children}</div>;

export const Headline = ({ label, value, note, alert }: { label: string; value: string; note?: string; alert?: boolean }) => (
  <div className="headline"><span>{label} <b className={alert ? "is-alert" : ""}>{value}</b></span>{note ? <i>{note}</i> : null}</div>
);

export const GaugeStats = ({ rows }: { rows: [string, string, boolean?][] }) => (
  <dl className="gauge-stats">{rows.map(([k, v, alert]) => <div key={k} className={alert ? "is-alert" : undefined}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
);

/**
 * 넓은 카드 한 벌 — 계기판(비율) · 주별 막대 · 수치. 비율이 없으면 계기판 칸이 사라진다.
 * 막대 값이 아직 안 왔거나 이 화면에 없으면 수치만 남는다.
 */
export function TripleCard({ rate, chart, rows }: {
  rate: { value: number; label: string; caption: string } | null;
  chart: ((w: number, h: number) => string) | null;
  rows: [string, string, boolean?][];
}) {
  if (!chart) return <GaugeStats rows={rows} />;
  return (
    <div className={`triple-card${rate ? "" : " no-gauge"}`}>
      {rate ? <VizSlot h={PANEL_H} className="gauge-slot" draw={(w, h) => V.gauge(w, h, rate)} /> : null}
      <div className="triple-bars"><VizSlot h={PANEL_H} draw={chart} /></div>
      <GaugeStats rows={rows} />
    </div>
  );
}

/** 과목 탭 + 막대·꺾은선 — 눌러도 상세가 열리지 않는다. 과목 값이 없으면 탭은 서지 않는다. */
export function ChartTools({ id, tabs, lineOnly }: { id: TrendId; tabs: readonly string[]; lineOnly?: boolean }) {
  const { kinds, setKind, picks, setPick } = useBoard();
  return (
    <div className="card-tools" data-noopen>
      {tabs.length > 1 ? (
        <div className="seg-toggle" role="group" aria-label="과목">
          {tabs.map((tab) => <button key={tab} type="button" aria-pressed={picks[id] === tab} onClick={() => setPick(id, tab)}>{tab}</button>)}
        </div>
      ) : null}
      {lineOnly ? null : (
        <div className="seg-toggle" role="group" aria-label="차트 종류">
          {([["bar", "막대"], ["line", "꺾은선"]] as const).map(([kind, label]) => <button key={kind} type="button" aria-pressed={kinds[id] === kind} onClick={() => setKind(id, kind)}>{label}</button>)}
        </div>
      )}
    </div>
  );
}

/** 카드 안 과목 탭 — 카드마다 따로 고른다. 눌러도 상세가 열리지 않는다. */
export function SubjectTabs({ tabs, active, onPick }: { tabs: readonly string[]; active: string; onPick: (tab: string) => void }) {
  if (tabs.length < 3) return null;
  return (
    <div className="card-tools" data-noopen>
      <div className="seg-toggle" role="group" aria-label="과목">
        {tabs.map((tab) => <button key={tab} type="button" aria-pressed={active === tab} onClick={() => onPick(tab)}>{tab}</button>)}
      </div>
    </div>
  );
}

export { VizSlot };
