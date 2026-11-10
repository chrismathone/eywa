"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { EyIcon } from "@/components/icons/aywa-icons";
import { EmbedAnchor } from "@/components/embed-link";
import { withEmbed } from "@/components/workspace/embed-context";
import { DutyWorkContext, type DutyWork } from "./duty-work-context";
import type { DutyItemView } from "../kinds";
import type { DutyKindCount, DutyWeekCell } from "../view";
import { MyDutiesPanel } from "./my-duties-panel";
import { MyDutiesWeek } from "./my-duties-week";
import { MyDutiesMonth } from "./my-duties-month";

type Count = { total: number; done: number; late: number };
export type DutyStripSummary = { date: string; month: string; today: Count; week: Count; byKind: DutyKindCount[]; counsel: Count; exam: Count; newcomer: Count; lang: "ko" | "en" };
export type DutyPayload = { date: string; days: string[]; items: DutyItemView[]; week: DutyWeekCell[]; month: DutyItemView[]; /** 반 → 수업 요일(mon…sun) */ classDays?: Record<string, string[]>; /** `<학생>|<반>` → 등원 요일 */ studentDays?: Record<string, string[]> };
type View = "today" | "week" | "month";
const VIEWS: { key: View; label: string }[] = [{ key: "today", label: "오늘" }, { key: "week", label: "이번 주" }, { key: "month", label: "이번 달" }];
const REFRESH_MS = 60_000;

/**
 * '내 업무' — 머리 한 줄(오늘 완료/전체 · 기한 초과 · 막대) + 완료도 칸 다섯. 칸이나 머리를 누르면 **오버레이 창**(원장 2026-11-09 *"페이지 확장이 아닌 오버레이창"* ·
 * 할 일 창과 같은 Dialog)에 오늘 / 이번 주 / 이번 달 보기. 숫자는 보일 때 60초마다 GET `/api/duties/summary`(셸 자동 호출은 서버 액션 금지 #137).
 */
export function MyDutiesStripButton({ summary: initial, className = "" }: { summary: DutyStripSummary; className?: string }) {
  const [summary, setSummary] = useState(initial);
  const { date, month, today, counsel, exam, newcomer, lang } = summary;
  // 모두 접기/펼치기 — 패널을 다시 그려(key) 처음 상태를 바꾼다(원장 2026-11-10: 단추는 오늘/이번 주/이번 달 줄 맨 오른쪽).
  const [fold, setFold] = useState<{ closed: boolean; v: number }>({ closed: false, v: 0 });
  const [view, setView] = useState<View | null>(null);
  const [loaded, setLoaded] = useState<{ payload: DutyPayload; at: number } | null>(null);
  const [failed, setFailed] = useState(false);
  // 셀을 누르면 창 안에 그 화면(간이 페이지 · iframe)을 띄운다. 돌아오면 목록·숫자를 다시 받는다(바로 처리한 것이 반영되게).
  const [work, setWork] = useState<DutyWork | null>(null);
  const closeWork = () => { setWork(null); setLoaded(null); void fetch("/api/duties/summary", { cache: "no-store" }).then(async (r) => { if (r.ok) { const next = (await r.json()) as Omit<DutyStripSummary, "lang">; setSummary((cur) => ({ ...next, lang: cur.lang })); } }).catch(() => undefined); };
  const openRef = useRef(false);
  useEffect(() => { openRef.current = view !== null; }, [view]);
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
  // 보일 때 60초마다 숫자를 새로 받는다 — 숨은 창(탭·최소화)은 멈추고, 다시 보이면 바로 한 번. 창이 열려 있으면 목록도 다시 받는다.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      if (document.visibilityState === "visible") {
        try {
          const r = await fetch("/api/duties/summary", { cache: "no-store" });
          if (r.ok && alive) {
            const next = (await r.json()) as Omit<DutyStripSummary, "lang">;
            setSummary((cur) => ({ ...next, lang: cur.lang }));
            if (openRef.current) setLoaded(null);
          }
        } catch { /* 다음 틱에 다시 — 숫자는 마지막 값 그대로 */ }
      }
      if (alive) timer = setTimeout(tick, REFRESH_MS);
    };
    timer = setTimeout(tick, REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") { if (timer) clearTimeout(timer); void tick(); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive = false; if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, []);
  const pct = (c: Count) => (c.total ? Math.round((c.done / c.total) * 100) : 0);
  const lateAll = today.late + counsel.late + exam.late + newcomer.late;
  const label = lang === "en"
    ? `My duties — today ${today.done}/${today.total}${lateAll ? ` · ${lateAll} overdue` : ""}`
    : `내 업무 — 오늘 ${today.done}/${today.total}${lateAll ? ` · 기한 초과 ${lateAll}` : ""}`;
  const mm = Number(month.slice(5, 7));
  return <section className={`border-line rounded-2xl border ${className}`}>
    <button type="button" onClick={() => setView("today")} className="hover:bg-bg-soft flex w-full flex-wrap items-center gap-2 rounded-t-2xl px-3 py-2 text-left">
      <EyIcon name="clipboardCheck" size={15} className={`shrink-0 ${lateAll ? "text-danger" : "text-foreground"}`} />
      <span className={`min-w-0 flex-1 text-sm font-bold ${lateAll ? "text-danger" : "text-foreground"}`}>{label}</span>
      <span className="bg-bg-soft h-1.5 w-24 shrink-0 overflow-hidden rounded-full" aria-hidden><span className={`block h-full rounded-full ${pct(today) === 100 ? "bg-green" : "bg-primary"}`} style={{ width: `${pct(today)}%` }} /></span>
      <span className="text-text-dim text-xs font-medium">{lang === "en" ? "Open ›" : "열기 ›"}</span>
    </button>
    <div className="grid gap-2 px-3 pb-3 sm:grid-cols-3 lg:grid-cols-5">
      <Tile label="오늘 완료도" value={`${today.done}`} unit={`/ ${today.total}`} pct={pct(today)} tone={today.total && pct(today) === 100 ? "green" : "primary"} onClick={() => setView("today")} />
      <Tile label="기한 초과" value={`${lateAll}`} tone={lateAll ? "danger" : "muted"} onClick={() => setView(today.late ? "today" : "month")} />
      <Tile label={`${mm}월 학부모 상담`} value={`${counsel.done}`} unit={`/ ${counsel.total}`} pct={pct(counsel)} tone={counsel.total && pct(counsel) === 100 ? "green" : counsel.late ? "danger" : "primary"} onClick={() => setView("month")} />
      <Tile label={`${mm}월 월말평가`} value={`${exam.done}`} unit={`/ ${exam.total}`} pct={pct(exam)} tone={exam.total && pct(exam) === 100 ? "green" : exam.late ? "danger" : "primary"} onClick={() => setView("month")} />
      <Tile label="신규생 정착 콜" value={`${newcomer.done}`} unit={`/ ${newcomer.total}`} pct={pct(newcomer)} tone={newcomer.late ? "danger" : newcomer.total && pct(newcomer) === 100 ? "green" : "primary"} onClick={() => setView("month")} />
    </div>
    {/* z-[70]: 미니셸 헤더가 z-[60](공지 팝업 위)이라 기본 z-50 창은 헤더에 덮인다(원장 제보 2026-11-09). 창 안엔 셀렉트·팝오버가 없어 올려도 된다. */}
    {view ? <Dialog open onOpenChange={(open) => (!open ? (work ? closeWork() : setView(null)) : undefined)}>
      <DialogContent className="z-[70] flex h-[min(900px,94dvh)] w-[min(96vw,1480px)] flex-col gap-3 sm:max-w-[min(96vw,1480px)]">
        {work ? <>
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={closeWork} className="border-line hover:bg-bg-soft h-8 rounded-lg border px-3 text-sm font-semibold">‹ 목록</button>
              <DialogTitle className="min-w-0 flex-1">{work.title}</DialogTitle>
              <EmbedAnchor href={work.href} className="bg-primary text-primary-foreground inline-flex h-8 items-center rounded-lg px-3 text-sm font-semibold hover:brightness-95">이 화면으로 이동 ›</EmbedAnchor>
            </div>
          </DialogHeader>
          <iframe key={work.href} src={withEmbed(work.href)} title={work.title} className="border-line min-h-0 w-full flex-1 rounded-xl border bg-background" />
        </> : <>
          <DialogHeader>
            <DialogTitle className="text-2xl">내 업무</DialogTitle>
          </DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ToolbarSegment>
              {VIEWS.map((v) => <ToolbarSegmentItem key={v.key} active={v.key === view} onClick={() => setView(v.key)}>{v.label}</ToolbarSegmentItem>)}
            </ToolbarSegment>
            {view !== "month" ? <div className="flex gap-1.5">
              <button type="button" onClick={() => setFold((f) => ({ closed: false, v: f.v + 1 }))} className="border-line hover:bg-bg-soft h-7 rounded-md border px-2.5 text-xs font-semibold">모두 펼치기</button>
              <button type="button" onClick={() => setFold((f) => ({ closed: true, v: f.v + 1 }))} className="border-line hover:bg-bg-soft h-7 rounded-md border px-2.5 text-xs font-semibold">모두 접기</button>
            </div> : null}
          </div>
          <DutyWorkContext.Provider value={setWork}>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {failed ? <p className="text-text-dim mt-2 text-sm">업무를 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.</p>
                : !loaded ? <p className="text-text-dim mt-2 text-sm">불러오는 중…</p>
                : view === "today" ? <MyDutiesPanel key={`t-${fold.v}`} loaded={loaded} defaultClosed={fold.closed} />
                : view === "week" ? <MyDutiesWeek key={`w-${fold.v}`} week={loaded.payload.week} days={loaded.payload.days} today={date} classDays={loaded.payload.classDays ?? {}} studentDays={loaded.payload.studentDays ?? {}} defaultClosed={fold.closed} />
                : <MyDutiesMonth items={loaded.payload.month} now={loaded.at} month={month} />}
            </div>
          </DutyWorkContext.Provider>
        </>}
      </DialogContent>
    </Dialog> : null}
  </section>;
}

function Tile({ label, value, unit, pct, tone, onClick }: { label: string; value: string; unit?: string; pct?: number; tone: "primary" | "green" | "danger" | "muted"; onClick: () => void }) {
  const color = tone === "danger" ? "text-danger" : tone === "green" ? "text-green" : tone === "muted" ? "text-text-dim" : "text-foreground";
  const bar = tone === "danger" ? "bg-danger" : tone === "green" ? "bg-green" : "bg-primary";
  return <button type="button" onClick={onClick} className="border-line-faint hover:bg-bg-soft rounded-xl border px-3 py-2 text-left">
    <div className="text-text-dim text-xs font-semibold">{label}</div>
    <div className={`text-2xl font-bold leading-tight tabular-nums ${color}`}>{value}{unit ? <span className="text-text-placeholder ml-1 text-sm font-medium">{unit}</span> : null}</div>
    {pct != null ? <div className="bg-bg-soft mt-1 h-1.5 overflow-hidden rounded-full" aria-hidden><div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} /></div> : null}
  </button>;
}
