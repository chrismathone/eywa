import Link from "next/link";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { EmptyState } from "@/components/empty-state";
import {
  getExpensesForMonth,
  getExpenseMonths,
  summarizeExpenses,
} from "@/features/billing/server/expense-queries";

const KRW = new Intl.NumberFormat("ko-KR");
const won = (n: number) => `${KRW.format(n)}원`;

const CAT_COLOR: Record<string, PillColor> = {
  인건비: "purple",
  운영비: "blue",
  매입: "amber",
  마케팅: "rose",
  기타: "neutral",
};
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
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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
      <div className="bg-card border-line shadow-card flex flex-wrap items-center gap-3 rounded-md border px-4 py-3">
        <div className="flex items-center gap-1.5">
          <Link href={hrefFor({ period: prevPeriod })} className="border-line hover:bg-bg-soft inline-flex size-7 items-center justify-center rounded-sm border" aria-label="이전 달">◀</Link>
          <span className="text-foreground min-w-[90px] text-center text-[13px] font-bold">{formatPeriod(period)}</span>
          <Link href={hrefFor({ period: nextPeriod })} className="border-line hover:bg-bg-soft inline-flex size-7 items-center justify-center rounded-sm border" aria-label="다음 달">▶</Link>
        </div>
        <div className="scrollbar-thin flex items-center gap-1 overflow-x-auto">
          <Link href={hrefFor({ cat: "all" })} className={`shrink-0 rounded-sm border px-2 py-0.5 text-xs transition ${cat === "all" ? "border-foreground bg-foreground text-background font-medium" : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"}`}>전체</Link>
          {CATS.map((c) => (
            <Link key={c} href={hrefFor({ cat: c })} className={`shrink-0 rounded-sm border px-2 py-0.5 text-xs transition ${cat === c ? "border-foreground bg-foreground text-background font-medium" : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"}`}>{c}</Link>
          ))}
        </div>
        {months.length > 0 ? (
          <span className="text-text-faint ml-auto font-mono text-[10px]">지출 기록 {months.length}개월</span>
        ) : null}
      </div>

      {summary.count === 0 ? (
        <EmptyState
          icon={() => <EyIcon name="falling" size={32} />}
          title="이 달 지출 내역이 없습니다"
          description="월을 이동하거나 지출을 등록하세요."
        />
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-3">
            <Kpi label="월 지출 합계" value={won(summary.total)} icon="falling" color="danger" hint={`${summary.count}건`} />
            <Kpi label="최대 분류" value={summary.byCategory[0]?.category ?? "—"} icon="rings" color="purple" hint={summary.byCategory[0] ? won(summary.byCategory[0].amount) : undefined} />
            <Kpi label="분류 수" value={`${summary.byCategory.length}개`} icon="branch" color="blue" />
          </section>

          {/* 카테고리 분포 */}
          <section className="bg-card border-line shadow-card rounded-md border p-5">
            <h2 className="text-foreground mb-3 text-sm font-bold">분류별 지출</h2>
            <div className="space-y-2.5">
              {summary.byCategory.map((c) => (
                <div key={c.category} className="flex items-center gap-3">
                  <span className="text-text-dim w-12 shrink-0 text-xs">{c.category}</span>
                  <div className="bg-bg-soft h-2.5 flex-1 overflow-hidden rounded-pill">
                    <span className="bg-primary block h-full" style={{ width: `${(c.amount / maxCat) * 100}%` }} />
                  </div>
                  <span className="num text-foreground w-24 shrink-0 text-right text-xs font-medium">{won(c.amount)}</span>
                </div>
              ))}
            </div>
          </section>

          <div className="flex items-center justify-between">
            <p className="text-text-dim text-xs">
              {formatPeriod(period)} 지출 <span className="num text-foreground font-semibold">{rows.length}</span>건
              {cat !== "all" ? <span className="ml-1">· {cat}</span> : null}
            </p>
          </div>

          <div className="bg-card border-line shadow-card overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="border-line bg-bg-soft/50 border-b [&_th]:whitespace-nowrap">
                <tr>
                  <th className="micro px-4 py-2 text-left">지출일</th>
                  <th className="micro px-4 py-2 text-left">항목</th>
                  <th className="micro px-4 py-2 text-left">분류</th>
                  <th className="micro px-4 py-2 text-left">거래처</th>
                  <th className="micro px-4 py-2 text-right">금액</th>
                </tr>
              </thead>
              <tbody className="divide-line divide-y">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-bg-soft/30">
                    <td className="num text-text-dim px-4 py-2 text-xs">{r.expenseDate}</td>
                    <td className="text-foreground px-4 py-2 text-xs">
                      {r.title}
                      {r.author ? <span className="text-text-faint"> · {r.author}</span> : null}
                    </td>
                    <td className="px-4 py-2"><Pill color={CAT_COLOR[r.category] ?? "neutral"}>{r.category}</Pill></td>
                    <td className="text-text-dim px-4 py-2 text-xs">{r.vendor ?? "—"}</td>
                    <td className="num text-danger px-4 py-2 text-right text-xs font-medium">{won(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  icon,
  color,
  hint,
}: {
  label: string;
  value: string;
  icon: Parameters<typeof EyIcon>[0]["name"];
  color: "danger" | "purple" | "blue";
  hint?: string;
}) {
  const ICON_BG = {
    danger: "bg-danger-soft text-danger",
    purple: "bg-purple-soft text-purple",
    blue: "bg-blue-soft text-blue",
  } as const;
  return (
    <article className="bg-card border-line shadow-card rounded-md border p-5">
      <header className="flex items-center justify-between">
        <p className="micro">{label}</p>
        <span className={`flex size-[26px] items-center justify-center rounded-sm ${ICON_BG[color]}`}>
          <EyIcon name={icon} size={14} />
        </span>
      </header>
      <p className="tabular text-foreground num mt-3 text-[18px] leading-tight">{value}</p>
      {hint ? (
        <p className="text-text-dim border-line mt-3 border-t pt-3 text-[11px]">{hint}</p>
      ) : (
        <div className="mt-3 h-[24px]" />
      )}
    </article>
  );
}
