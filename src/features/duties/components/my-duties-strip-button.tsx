"use client";

import { useEffect, useState } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { DUTY_STATE_LABEL, dutyKindLabel, dutyState, type DutyItemView, type DutyState } from "../kinds";

/**
 * '오늘 내 업무' 줄 — 누르면 아래로 학생별 칸이 펼쳐진다(목록은 누를 때 GET `/api/duties/mine` · 셸 자동 호출은 서버 액션 금지 #137).
 * 칸 색은 의미색(완료 = good · 기한 초과 = danger · 아직 = 회색). 화면 언어는 줄 문구만 따른다(칸 이름은 한국어 기록).
 */
export function MyDutiesStripButton({ date, total, done, late, lang, className = "" }: { date: string; total: number; done: number; late: number; lang: "ko" | "en"; className?: string }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<{ items: DutyItemView[]; at: number } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open || loaded) return;
    let alive = true;
    fetch(`/api/duties/mine?date=${date}`, { cache: "no-store" }).then(async (r) => {
      if (!r.ok) throw new Error(String(r.status));
      const json = (await r.json()) as { items: DutyItemView[] };
      if (alive) setLoaded({ items: json.items, at: Date.now() });
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [open, loaded, date]);
  const label = lang === "en"
    ? `Today's duties ${done}/${total}${late ? ` · ${late} overdue` : ""}`
    : `오늘 내 업무 ${done.toLocaleString("ko-KR")}/${total.toLocaleString("ko-KR")}${late ? ` · 기한 초과 ${late.toLocaleString("ko-KR")}` : ""}`;
  return <div className={className}>
    <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
      className={`border-line hover:bg-bg-soft flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-bold ${late ? "text-danger" : "text-foreground"}`}>
      <EyIcon name="clipboardCheck" size={15} className="shrink-0" />
      <span className="min-w-0 flex-1">{label}</span>
      <span className="bg-bg-soft h-1.5 w-24 shrink-0 overflow-hidden rounded-full" aria-hidden><span className="bg-primary block h-full rounded-full" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} /></span>
      <span className="text-text-dim text-xs font-medium">{open ? (lang === "en" ? "Close" : "접기") : (lang === "en" ? "Open ›" : "펼치기 ›")}</span>
    </button>
    {open ? <DutyList loaded={loaded} failed={failed} /> : null}
  </div>;
}

function DutyList({ loaded, failed }: { loaded: { items: DutyItemView[]; at: number } | null; failed: boolean }) {
  if (failed) return <p className="text-text-dim mt-2 text-sm">오늘 업무를 불러오지 못했습니다. 잠시 뒤 다시 펼쳐 주세요.</p>;
  if (!loaded) return <p className="text-text-dim mt-2 text-sm">불러오는 중…</p>;
  // 늦음 판정 시각 = 목록을 받은 순간(렌더 중 Date.now 금지 — react-hooks/purity).
  const { items, at: now } = loaded;
  const groups = new Map<string, { title: string; sub: string; items: DutyItemView[] }>();
  for (const it of items) {
    const key = it.studentId ?? `class:${it.classId}`;
    const g = groups.get(key) ?? { title: it.studentName ?? it.className ?? "반", sub: it.studentId ? it.className ?? "" : "반 알림장", items: [] };
    g.items.push(it);
    groups.set(key, g);
  }
  const rank = (s: DutyState) => (s === "late" ? 0 : s === "open" ? 1 : 2);
  const sorted = [...groups.values()].sort((a, b) => Math.min(...a.items.map((i) => rank(dutyState(i.status, i.dueAt, now)))) - Math.min(...b.items.map((i) => rank(dutyState(i.status, i.dueAt, now)))) || a.title.localeCompare(b.title, "ko"));
  return <ul className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
    {sorted.map((g, idx) => <li key={idx} className="border-line rounded-lg border px-3 py-2">
      <div className="flex items-baseline justify-between gap-2"><span className="truncate text-sm font-bold">{g.title}</span><span className="text-text-dim shrink-0 text-xs">{g.sub}</span></div>
      <div className="mt-1 flex flex-wrap gap-1">
        {g.items.map((it) => { const st = dutyState(it.status, it.dueAt, now); return <span key={it.id} title={DUTY_STATE_LABEL[st]}
          className={`inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-semibold ${st === "done" ? "bg-green-soft text-green" : st === "late" ? "bg-danger-soft text-danger" : "bg-bg-soft text-text-dim"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${st === "done" ? "bg-green" : st === "late" ? "bg-danger" : "bg-text-placeholder"}`} aria-hidden />{dutyKindLabel(it.kind)}</span>; })}
      </div>
    </li>)}
  </ul>;
}
