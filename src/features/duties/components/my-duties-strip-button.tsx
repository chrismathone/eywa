"use client";

import { useEffect, useState } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { dutyKindLabel, type DutyItemView } from "../kinds";
import type { DutyKindCount, DutyWeekCell } from "../view";
import { MyDutiesPanel } from "./my-duties-panel";
import { MyDutiesWeek } from "./my-duties-week";
import { MyDutiesMonth } from "./my-duties-month";

type Count = { total: number; done: number; late: number };
export type DutyStripSummary = { date: string; month: string; today: Count; week: Count; byKind: DutyKindCount[]; counsel: Count; newcomer: Count; lang: "ko" | "en" };
export type DutyPayload = { date: string; days: string[]; items: DutyItemView[]; week: DutyWeekCell[]; month: DutyItemView[] };
type View = "today" | "week" | "month";

/**
 * '내 업무' — 머리 한 줄(오늘 완료/전체 · 기한 초과 · 막대) + 완료도 칸 다섯(접혀도 보임) + 오늘 / 이번 주 / 이번 달 보기(시안 2026-11-09의 선생님 화면).
 * 목록은 펼칠 때 GET `/api/duties/mine`(셸 자동 호출은 서버 액션 금지 #137). 화면 언어는 머리 문구만 따른다(칸 이름은 한국어 기록).
 */
export function MyDutiesStripButton({ summary, className = "" }: { summary: DutyStripSummary; className?: string }) {
  const { date, month, today, week, byKind, counsel, newcomer, lang } = summary;
  const [view, setView] = useState<View | null>(null);
  const [loaded, setLoaded] = useState<{ payload: DutyPayload; at: number } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!view || loaded) return;
    let alive = true;
    fetch(`/api/duties/mine?date=${date}`, { cache: "no-store" }).then(async (r) => {
      if (!r.ok) throw new Error(String(r.status));
      const payload = (await r.json()) as DutyPayload;
      if (alive) setLoaded({ payload, at: Date.now() });
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [view, loaded, date]);
  const pct = (c: Count) => (c.total ? Math.round((c.done / c.total) * 100) : 0);
  const lateAll = today.late + counsel.late + newcomer.late;
  const label = lang === "en"
    ? `My duties — today ${today.done}/${today.total}${lateAll ? ` · ${lateAll} overdue` : ""}`
    : `내 업무 — 오늘 ${today.done}/${today.total}${lateAll ? ` · 기한 초과 ${lateAll}` : ""}`;
  const breakdown = byKind.map((c) => `${dutyKindLabel(c.kind)} ${c.done}/${c.total}`).join(" · ") || "오늘 수업 의무 없음";
  const lateBreakdown = [...byKind.filter((c) => c.late).map((c) => `${dutyKindLabel(c.kind)} ${c.late}`), counsel.late ? `월 상담 ${counsel.late}` : "", newcomer.late ? `신규생 콜 ${newcomer.late}` : ""].filter(Boolean).join(" · ");
  const mm = Number(month.slice(5, 7));
  const seg = (v: View, text: string) => <button type="button" onClick={() => setView((cur) => (cur === v ? null : v))} aria-pressed={view === v}
    className={`h-7 rounded-md px-3 text-xs font-semibold ${view === v ? "bg-surface-hi text-primary shadow-card" : "text-text-dim hover:text-foreground"}`}>{text}</button>;
  return <section className={`border-line rounded-2xl border ${className}`}>
    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
      <EyIcon name="clipboardCheck" size={15} className={`shrink-0 ${lateAll ? "text-danger" : "text-foreground"}`} />
      <span className={`min-w-0 flex-1 text-sm font-bold ${lateAll ? "text-danger" : "text-foreground"}`}>{label}</span>
      <span className="bg-bg-soft h-1.5 w-24 shrink-0 overflow-hidden rounded-full" aria-hidden><span className={`block h-full rounded-full ${pct(today) === 100 ? "bg-green" : "bg-primary"}`} style={{ width: `${pct(today)}%` }} /></span>
      <div className="bg-bg-soft inline-flex rounded-lg p-0.5" role="group" aria-label="보기">{seg("today", "오늘")}{seg("week", "이번 주")}{seg("month", "이번 달")}</div>
    </div>
    <div className="grid gap-2 px-3 pb-3 sm:grid-cols-3 lg:grid-cols-5">
      <Tile label="오늘 완료도" value={`${today.done}`} unit={`/ ${today.total}`} pct={pct(today)} tone={today.total && pct(today) === 100 ? "green" : "primary"} note={breakdown} onClick={() => setView("today")} />
      <Tile label="기한 초과" value={`${lateAll}`} tone={lateAll ? "danger" : "muted"} note={lateAll ? lateBreakdown : "없음 — 출결·보고서 당일 자정 · 발송 다음 날 정오 · 상담 말일"} onClick={() => setView(today.late ? "today" : "month")} />
      <Tile label="이번 주(7일)" value={`${week.done}`} unit={`/ ${week.total}`} pct={pct(week)} tone="primary" note={week.late ? `기한 초과 ${week.late}건 남음` : "밀린 것 없음"} onClick={() => setView("week")} />
      <Tile label={`${mm}월 학부모 상담`} value={`${counsel.done}`} unit={`/ ${counsel.total}`} pct={pct(counsel)} tone={counsel.total && pct(counsel) === 100 ? "green" : counsel.late ? "danger" : "primary"} note={counsel.total ? `의무 학생 ${counsel.total}명 · 말일까지` : "상담 의무 학생 없음"} onClick={() => setView("month")} />
      <Tile label="신규생 정착 콜" value={`${newcomer.done}`} unit={`/ ${newcomer.total}`} pct={pct(newcomer)} tone={newcomer.late ? "danger" : newcomer.total && pct(newcomer) === 100 ? "green" : "primary"} note={newcomer.total ? (newcomer.late ? `기한 지난 항목 ${newcomer.late}` : "항목마다 기한 안") : "맡은 신규생 없음"} onClick={() => setView("month")} />
    </div>
    {view ? <div className="border-line-faint border-t px-3 pb-3 pt-2">
      {view === "today" ? <p className="text-text-dim text-xs">빈 칸(아직)이 곧 오늘 할 일입니다. 칸을 누르면 그 학생 기록(원스크린)으로 갑니다. 결석·휴원이면 의무가 저절로 빠집니다.</p> : null}
      {failed ? <p className="text-text-dim mt-2 text-sm">업무를 불러오지 못했습니다. 잠시 뒤 다시 눌러 주세요.</p>
        : !loaded ? <p className="text-text-dim mt-2 text-sm">불러오는 중…</p>
        : view === "today" ? <MyDutiesPanel loaded={loaded} />
        : view === "week" ? <MyDutiesWeek items={loaded.payload.items} week={loaded.payload.week} days={loaded.payload.days} now={loaded.at} />
        : <MyDutiesMonth items={loaded.payload.month} now={loaded.at} month={month} />}
    </div> : null}
  </section>;
}

function Tile({ label, value, unit, pct, tone, note, onClick }: { label: string; value: string; unit?: string; pct?: number; tone: "primary" | "green" | "danger" | "muted"; note: string; onClick: () => void }) {
  const color = tone === "danger" ? "text-danger" : tone === "green" ? "text-green" : tone === "muted" ? "text-text-dim" : "text-foreground";
  const bar = tone === "danger" ? "bg-danger" : tone === "green" ? "bg-green" : "bg-primary";
  return <button type="button" onClick={onClick} className="border-line-faint hover:bg-bg-soft rounded-xl border px-3 py-2 text-left">
    <div className="text-text-dim text-xs font-semibold">{label}</div>
    <div className={`text-2xl font-bold leading-tight tabular-nums ${color}`}>{value}{unit ? <span className="text-text-placeholder ml-1 text-sm font-medium">{unit}</span> : null}</div>
    {pct != null ? <div className="bg-bg-soft mt-1 h-1.5 overflow-hidden rounded-full" aria-hidden><div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} /></div> : null}
    <div className="text-text-dim mt-1 truncate text-xs" title={note}>{note}</div>
  </button>;
}
