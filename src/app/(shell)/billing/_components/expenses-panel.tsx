import { Wallet, PieChart, Tags } from "@/components/icons/eywa-icon-compat";
import { BigStat } from "@/components/atoms/big-stat";
import { FilterSelect } from "@/components/filter-select";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import {
  getExpensesForMonth,
  getExpenseMonths,
  summarizeExpenses,
} from "@/features/billing/server/expense-queries";
import { currencyMeta, formatMoney } from "@/features/billing/currencies";
import { kstMonth, monthLabel } from "@/lib/date-kst";
import { BillingMonthNav } from "./billing-month-nav";
import { ExpensesTable } from "./expenses-table";

const CATS = ["인건비", "운영비", "매입", "마케팅", "기타"];

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
      {/* 툴바(지시서 §10) — 월 이동은 공용 BillingMonthNav(PeriodNav + `월:` 드롭다운, 옛 size-8 화살표 링크 대체) ·
          분류 칩 6개 → `분류: 전체` 라벨 하나. 🔴 툴바 카드 껍데기 없음(원장 2026-09-01). */}
      <div className="flex flex-wrap items-center gap-2.5 px-1">
        <BillingMonthNav period={period} hrefFor={(per) => hrefFor({ period: per })} months={months} ariaLabel="지출 월 선택" />
        <FilterSelect
          paramName="cat"
          value={cat === "all" ? "" : cat}
          options={CATS.map((c) => ({ value: c, label: c }))}
          axisLabel="분류"
          ariaLabel="지출 분류 필터"
          className="w-auto"
          triggerClassName={TOOLBAR_SELECT}
        />
        {months.length > 0 ? (
          <span className="text-text-faint num ml-auto text-sm whitespace-nowrap">지출 기록 {months.length}개월</span>
        ) : null}
      </div>

      {summary.count === 0 ? (
        <ExpensesTable rows={rows} />
      ) : (
        <>
          {/* KPI — 공용 BigStat(옛 로컬 Kpi 카드는 링 위에 border를 겹쳐 선이 이중이었다, v5 ④). */}
          <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-3">
            <BigStat
              label="월 지출 합계"
              value={primaryTotal ? formatMoney(primaryTotal.total, primaryTotal.currency) : "—"}
              tone="danger"
              icon={<Wallet size={16} strokeWidth={1.8} />}
              sub={
                `${summary.count}건` +
                (otherCurrencies.length > 0
                  ? ` · ${otherCurrencies.map((o) => formatMoney(o.total, o.currency)).join(" · ")}`
                  : "")
              }
            />
            <BigStat
              label="최대 분류"
              value={summary.byCategory[0]?.category ?? "—"}
              tone="purple"
              icon={<PieChart size={16} strokeWidth={1.8} />}
              sub={summary.byCategory[0] ? formatMoney(summary.byCategory[0].amount, primaryCurrency) : undefined}
            />
            <BigStat label="분류 수" value={summary.categoryCount} unit="개" tone="blue" icon={<Tags size={16} strokeWidth={1.8} />} />
          </section>

          {/* 카테고리 분포 — primary 통화 기준(통화별 합계는 위 KPI 참조). 카드 = 링 하나(v5 ④). */}
          <section className="bg-card shadow-card rounded-2xl p-5">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h2 className="text-foreground text-base font-bold">분류별 지출</h2>
              {multiCurrency ? (
                <span className="text-text-faint text-sm">
                  통화 {currencyMeta(primaryCurrency).symbol} 기준 · 다른 통화는 상단 합계 참조
                </span>
              ) : null}
            </div>
            <div className="space-y-2.5">
              {summary.byCategory.map((c) => (
                <div key={c.category} className="flex items-center gap-3">
                  <span className="text-text-dim w-14 shrink-0 text-sm whitespace-nowrap">{c.category}</span>
                  <div className="bg-bg-soft rounded-pill h-2.5 flex-1 overflow-hidden">
                    <span className="bg-primary block h-full" style={{ width: `${(c.amount / maxCat) * 100}%` }} />
                  </div>
                  <span className="num text-foreground w-28 shrink-0 text-right text-sm font-medium">{formatMoney(c.amount, primaryCurrency)}</span>
                </div>
              ))}
            </div>
          </section>

          <p className="text-text-dim px-1 text-sm">
            {monthLabel(period)} 지출 <span className="num text-foreground font-bold">{rows.length}</span>건
            {cat !== "all" ? <span className="ml-1">· {cat}</span> : null}
          </p>

          <ExpensesTable rows={rows} />
        </>
      )}
    </div>
  );
}
