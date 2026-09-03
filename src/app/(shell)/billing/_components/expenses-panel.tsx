import Link from "next/link";
import type { LucideIcon } from "@/components/icons/eywa-icon-compat";
import { Wallet, PieChart, Tags } from "@/components/icons/eywa-icon-compat";
import { EyIcon } from "@/components/icons/eywa-icons";
import { TOOLBAR_CHIP, TOOLBAR_CHIP_OFF, TOOLBAR_CHIP_ON } from "@/components/toolbar-controls";
import {
  getExpensesForMonth,
  getExpenseMonths,
  summarizeExpenses,
} from "@/features/billing/server/expense-queries";
import { currencyMeta, formatMoney } from "@/features/billing/currencies";
import { kstMonth } from "@/lib/date-kst";
import { ExpensesTable } from "./expenses-table";

const CATS = ["인건비", "운영비", "매입", "마케팅", "기타"];

function formatPeriod(period: string): string {
  const [y, m] = period.split("-");
  return `${y}년 ${Number(m)}월`;
}
function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y!, m! - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function currentPeriod(): string {
  return kstMonth();
}

type Sp = { period?: string; cat?: string };

export async function ExpensesPanel({ sp }: { sp: Sp }) {
  const period = sp.period ?? currentPeriod();
  const cat = sp.cat ?? "all";

  const [allRows, months] = await Promise.all([getExpensesForMonth(period), getExpenseMonths()]);
  const summary = summarizeExpenses(allRows, period);
  const rows = cat === "all" ? allRows : allRows.filter((r) => r.category === cat);

  const prevPeriod = shiftPeriod(period, -1);
  const nextPeriod = shiftPeriod(period, 1);
  const maxCat = Math.max(1, ...summary.byCategory.map((c) => c.amount));
  // 통화별 합계 — primary(건수 최다)는 KPI 대표값, 나머지는 분리 표기. 분류별 바는 primary 통화 기준.
  const primaryCurrency = summary.primaryCurrency;
  const primaryTotal = summary.byCurrency[0];
  const otherCurrencies = summary.byCurrency.slice(1);
  const multiCurrency = summary.byCurrency.length > 1;

  const hrefFor = (opts: { period?: string; cat?: string }) => {
    const p = new URLSearchParams({ tab: "expenses" });
    const per = opts.period ?? period;
    const c = opts.cat ?? cat;
    if (per !== currentPeriod()) p.set("period", per);
    if (c !== "all") p.set("cat", c);
    return `/billing?${p.toString()}`;
  };

  return (
    <div className="space-y-4">
      {/* 월 navigator + 카테고리 필터 */}
      {/* 🔴 툴바 카드 껍데기 제거(원장 2026-09-01) — 아래 표·카드가 자기 테두리를 가져 선이 겹쳤다. */}
      <div className="flex flex-wrap items-center gap-3 px-1 py-1">
        <div className="flex items-center gap-1.5">
          <Link href={hrefFor({ period: prevPeriod })} className="border-line hover:bg-bg-soft inline-flex size-8 items-center justify-center rounded-lg border" aria-label="이전 달"><EyIcon name="chevronLeft" size={14} /></Link>
          <span className="text-foreground min-w-[90px] text-center text-sm font-bold">{formatPeriod(period)}</span>
          <Link href={hrefFor({ period: nextPeriod })} className="border-line hover:bg-bg-soft inline-flex size-8 items-center justify-center rounded-lg border" aria-label="다음 달"><EyIcon name="chevronRight" size={14} /></Link>
        </div>
        <div className="scrollbar-thin flex items-center gap-1 overflow-x-auto">
          <Link href={hrefFor({ cat: "all" })} className={`${TOOLBAR_CHIP} ${cat === "all" ? TOOLBAR_CHIP_ON : TOOLBAR_CHIP_OFF}`}>전체</Link>
          {CATS.map((c) => (
            <Link key={c} href={hrefFor({ cat: c })} className={`${TOOLBAR_CHIP} ${cat === c ? TOOLBAR_CHIP_ON : TOOLBAR_CHIP_OFF}`}>{c}</Link>
          ))}
        </div>
        {months.length > 0 ? (
          <span className="text-text-faint ml-auto num text-xs">지출 기록 {months.length}개월</span>
        ) : null}
      </div>

      {summary.count === 0 ? (
        <ExpensesTable rows={rows} />
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-3">
            <Kpi
              label="월 지출 합계"
              value={primaryTotal ? formatMoney(primaryTotal.total, primaryTotal.currency) : "—"}
              icon={Wallet}
              color="danger"
              hint={
                `${summary.count}건` +
                (otherCurrencies.length > 0
                  ? ` · ${otherCurrencies.map((o) => formatMoney(o.total, o.currency)).join(" · ")}`
                  : "")
              }
            />
            <Kpi label="최대 분류" value={summary.byCategory[0]?.category ?? "—"} icon={PieChart} color="purple" hint={summary.byCategory[0] ? formatMoney(summary.byCategory[0].amount, primaryCurrency) : undefined} />
            <Kpi label="분류 수" value={`${summary.categoryCount}개`} icon={Tags} color="blue" />
          </section>

          {/* 카테고리 분포 — primary 통화 기준(통화별 합계는 위 KPI 참조) */}
          <section className="bg-card border-line shadow-card rounded-2xl border p-5">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h2 className="text-foreground text-sm font-bold">분류별 지출</h2>
              {multiCurrency ? (
                <span className="text-text-faint text-xs">
                  통화 {currencyMeta(primaryCurrency).symbol} 기준 · 다른 통화는 상단 합계 참조
                </span>
              ) : null}
            </div>
            <div className="space-y-2.5">
              {summary.byCategory.map((c) => (
                <div key={c.category} className="flex items-center gap-3">
                  <span className="text-text-dim w-12 shrink-0 whitespace-nowrap text-xs">{c.category}</span>
                  <div className="bg-bg-soft h-2.5 flex-1 overflow-hidden rounded-pill">
                    <span className="bg-primary block h-full" style={{ width: `${(c.amount / maxCat) * 100}%` }} />
                  </div>
                  <span className="num text-foreground w-24 shrink-0 text-right text-xs font-medium">{formatMoney(c.amount, primaryCurrency)}</span>
                </div>
              ))}
            </div>
          </section>

          <div className="flex items-center justify-between">
            <p className="text-text-dim text-xs">
              {formatPeriod(period)} 지출 <span className="num text-foreground font-bold">{rows.length}</span>건
              {cat !== "all" ? <span className="ml-1">· {cat}</span> : null}
            </p>
          </div>

          <ExpensesTable rows={rows} />
        </>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  icon: Icon,
  color,
  hint,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  color: "danger" | "purple" | "blue";
  hint?: string;
}) {
  const ICON_BG = {
    danger: "bg-danger-soft text-danger",
    purple: "bg-purple-soft text-purple",
    blue: "bg-blue-soft text-blue",
  } as const;
  return (
    <article className="bg-card border-line shadow-card rounded-2xl border p-5">
      <header className="flex items-center justify-between">
        <p className="micro">{label}</p>
        <span className={`flex size-[26px] items-center justify-center rounded-sm ${ICON_BG[color]}`}>
          <Icon size={14} strokeWidth={1.8} />
        </span>
      </header>
      <p className="tabular text-foreground num mt-3 text-lg leading-tight">{value}</p>
      {hint ? (
        <p className="text-text-dim border-line mt-3 border-t pt-3 text-xs">{hint}</p>
      ) : (
        <div className="mt-3 h-[24px]" />
      )}
    </article>
  );
}
