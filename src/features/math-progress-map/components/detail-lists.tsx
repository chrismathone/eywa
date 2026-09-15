"use client";

import { Pill } from "@/components/atoms/pill";
import { formatRange } from "../calendar";
import type { MonthView } from "../derive";
import { STATUS_LABEL, STATUS_PILL } from "../palette";
import { useProgressMap } from "./map-state";
import styles from "./progress-map.module.css";

/** 목록 한 줄의 공통 껍데기 — 누르면 초점이 옮겨 간다. 켜진 줄(초점)은 옅은 학원색. */
export function DetailRow({ on, onClick, children, label }: { on: boolean; onClick: () => void; children: React.ReactNode; label: string }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-current={on ? "true" : undefined}
        className={`${styles.selectionItem} grid w-full grid-cols-[5.5rem_minmax(0,1fr)_auto_auto] items-center gap-x-3 rounded-lg px-2 py-1.5 text-left transition hover:bg-bg-soft`}
      >
        {children}
      </button>
    </li>
  );
}

function MiniBar({ pct }: { pct: number }) {
  return (
    <span className="bg-bg-soft inline-block h-2 w-16 overflow-hidden rounded-full align-middle" aria-hidden>
      <span className="bg-primary block h-full rounded-full" style={{ width: `${pct}%` }} />
    </span>
  );
}

function MonthRow({ m }: { m: MonthView }) {
  const { focus, selectMonth } = useProgressMap();
  return (
    <DetailRow on={focus.month === m.month} onClick={() => selectMonth(m.month)} label={`${m.month}월 ${m.plan?.chapter ?? "계획 없음"} ${m.pct}%`}>
      <span className="text-foreground text-sm font-bold">
        {m.month}월{m.isCurrent ? <span className="text-primary ml-1 text-xs font-bold">지금</span> : null}
      </span>
      <span className="min-w-0">
        <span className="text-foreground block truncate text-sm font-medium">{m.plan?.chapter ?? "계획 없음"}</span>
        <span className="text-text-dim num block truncate text-xs">
          {m.plan ? `${m.plan.bookName} · p.${m.plan.startPage}~${m.plan.endPage}` : "—"}
        </span>
      </span>
      <span className="num flex items-center gap-2 text-sm whitespace-nowrap">
        <MiniBar pct={m.pct} />
        <span className="text-text-dim">
          {m.donePages} / {m.plannedPages}
        </span>
        <span className="text-foreground inline-block w-11 text-right font-bold">{m.pct}%</span>
      </span>
      <Pill color={STATUS_PILL[m.status]}>{STATUS_LABEL[m.status]}</Pill>
    </DetailRow>
  );
}

/** 연간(학기·교재로 묶음) / 분기(달 셋) 목록. */
export function YearList({ months, grouped = false }: { months: MonthView[]; grouped?: boolean }) {
  if (!grouped) {
    return (
      <ul className="flex flex-col gap-0.5">
        {months.map((m) => (
          <MonthRow key={m.month} m={m} />
        ))}
      </ul>
    );
  }
  const groups: { key: string; months: MonthView[] }[] = [];
  for (const m of months) {
    const key = m.plan ? `${m.plan.semester} · ${m.plan.bookName}` : "계획 없음";
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.months.push(m);
    else groups.push({ key, months: [m] });
  }
  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => {
        const planned = g.months.reduce((s, m) => s + m.plannedPages, 0);
        const done = g.months.reduce((s, m) => s + m.donePages, 0);
        const pct = planned > 0 ? Math.round((done / planned) * 100) : 0;
        return (
          <section key={g.key}>
            <h4 className="text-text-dim flex items-baseline gap-2 px-2 text-xs font-bold">
              {g.key}
              <span className="num font-medium">
                {g.months[0]!.month}~{g.months[g.months.length - 1]!.month}월 · {pct}%
              </span>
            </h4>
            <ul className="mt-1 flex flex-col gap-0.5">
              {g.months.map((m) => (
                <MonthRow key={m.month} m={m} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** 월간 — 그 달의 주 목록(소단원 · 쪽 범위 · 진도). */
export function MonthList({ month }: { month: MonthView }) {
  const { focus, selectWeek } = useProgressMap();
  return (
    <ul className="flex flex-col gap-0.5">
      {month.weeks.map((w) => (
        <DetailRow
          key={w.index}
          on={focus.week === w.index}
          onClick={() => selectWeek(month.month, w.index)}
          label={`${month.month}월 ${w.index}주 ${w.topic ?? ""} ${STATUS_LABEL[w.status]}`}
        >
          <span>
            <span className="text-foreground block text-sm font-bold">
              {w.index}주{w.isCurrent ? <span className="text-primary ml-1 text-xs font-bold">지금</span> : null}
            </span>
            <span className="text-text-dim num block text-xs">{formatRange(w.start, w.end)}</span>
          </span>
          <span className="text-foreground min-w-0 truncate text-sm font-medium">{w.topic ?? (w.status === "no-plan" ? "계획 없음" : "—")}</span>
          <span className="num flex items-center gap-2 text-sm whitespace-nowrap">
            <span className="text-text-dim">{w.pageFrom != null ? `p.${w.pageFrom}~${w.pageTo}` : "—"}</span>
            <MiniBar pct={w.pct} />
            <span className="text-text-dim">
              {w.donePages} / {w.plannedPages}
            </span>
          </span>
          <Pill color={STATUS_PILL[w.status]}>{STATUS_LABEL[w.status]}</Pill>
        </DetailRow>
      ))}
    </ul>
  );
}
