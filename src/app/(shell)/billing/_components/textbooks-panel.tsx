import Link from "next/link";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/pagination";
import { getTextbookOrdersPage, getTextbookStats } from "@/features/billing/server/textbook-queries";

const KRW = new Intl.NumberFormat("ko-KR");
const won = (n: number) => `${KRW.format(n)}원`;

const STATUS: { key: string; label: string; color: PillColor }[] = [
  { key: "requested", label: "신청", color: "amber" },
  { key: "ordered", label: "주문", color: "blue" },
  { key: "delivered", label: "배부", color: "primary" },
  { key: "billed", label: "청구", color: "gold" },
  { key: "paid", label: "납부", color: "neutral" },
];
const STATUS_META = new Map(STATUS.map((s) => [s.key, s]));

type Sp = { status?: string; q?: string; page?: string };

export async function TextbooksPanel({ sp }: { sp: Sp }) {
  const status = sp.status ?? "all";
  const q = sp.q ?? "";
  const PAGE_SIZE = 50;
  const page = Math.max(1, Number(sp.page) || 1);

  const [{ rows, total }, stats] = await Promise.all([
    getTextbookOrdersPage({ status, q }, page, PAGE_SIZE),
    getTextbookStats(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const chipHref = (s: string) => {
    const p = new URLSearchParams({ tab: "textbooks" });
    if (s !== "all") p.set("status", s);
    if (q) p.set("q", q);
    return `/billing?${p.toString()}`;
  };
  const pageHref = (n: number) => {
    const p = new URLSearchParams({ tab: "textbooks" });
    if (status !== "all") p.set("status", status);
    if (q) p.set("q", q);
    if (n > 1) p.set("page", String(n));
    return `/billing?${p.toString()}`;
  };

  return (
    <div className="space-y-4">
      {/* 필터 바 */}
      <div className="bg-card border-line shadow-card flex flex-wrap items-center gap-2 rounded-md border px-4 py-3">
        <Link
          href={chipHref("all")}
          className={`shrink-0 rounded-sm border px-2 py-0.5 text-xs transition ${
            status === "all"
              ? "border-foreground bg-foreground text-background font-medium"
              : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
          }`}
        >
          전체 {stats.total}
        </Link>
        {STATUS.map((s) => (
          <Link
            key={s.key}
            href={chipHref(s.key)}
            className={`shrink-0 rounded-sm border px-2 py-0.5 text-xs transition ${
              status === s.key
                ? "border-foreground bg-foreground text-background font-medium"
                : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
            }`}
          >
            {s.label} {stats.byStatus[s.key] ?? 0}
          </Link>
        ))}
        <form action="/billing" method="get" className="ml-auto flex items-center gap-2">
          <input type="hidden" name="tab" value="textbooks" />
          {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
          <div className="border-line bg-bg-soft text-text-dim flex items-center gap-2 rounded-sm border px-2.5 py-1.5">
            <EyIcon name="search" size={13} />
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="교재명·학생"
              className="text-foreground placeholder:text-text-faint w-32 bg-transparent text-xs focus:outline-none"
            />
          </div>
          <Button type="submit" variant="outline" size="sm">검색</Button>
        </form>
      </div>

      {/* KPI */}
      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <Kpi label="전체 신청" value={`${stats.total}건`} icon="seed" color="blue" />
        <Kpi label="처리 대기" value={`${stats.pending}건`} icon="sprout" color="amber" hint="신청·주문·배부" />
        <Kpi label="미납 합계" value={won(stats.unpaidAmount)} icon="falling" color="danger" />
        <Kpi label="총 신청액" value={won(stats.totalAmount)} icon="pollen" color="primary" />
      </section>

      <div className="flex items-center justify-between">
        <p className="text-text-dim text-xs">
          교재신청 <span className="num text-foreground font-semibold">{total}</span>건
          {q ? <span className="ml-2">· &ldquo;{q}&rdquo; 검색</span> : null}
          {totalPages > 1 ? <span className="ml-2">· {page}/{totalPages} 페이지</span> : null}
        </p>
      </div>

      {total === 0 ? (
        <EmptyState
          icon={() => <EyIcon name="seed" size={32} />}
          title={q || status !== "all" ? "조건에 맞는 교재신청이 없습니다" : "교재신청 내역이 없습니다"}
          description="학생이 교재를 신청하면 여기에 신청 → 배부 → 청구 흐름으로 표시됩니다."
        />
      ) : (
        <>
          <div className="bg-card border-line shadow-card overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="border-line bg-bg-soft/50 border-b [&_th]:whitespace-nowrap">
                <tr>
                  <th className="micro px-4 py-2 text-left">신청일</th>
                  <th className="micro px-4 py-2 text-left">교재</th>
                  <th className="micro px-4 py-2 text-left">학생</th>
                  <th className="micro px-4 py-2 text-left">강사</th>
                  <th className="micro px-4 py-2 text-left">상태</th>
                  <th className="micro px-4 py-2 text-right">금액</th>
                </tr>
              </thead>
              <tbody className="divide-line divide-y">
                {rows.map((r) => {
                  const meta = STATUS_META.get(r.status);
                  return (
                    <tr key={r.id} className="hover:bg-bg-soft/30">
                      <td className="num text-text-dim px-4 py-2 text-xs">{r.requestDate ?? "—"}</td>
                      <td className="text-foreground px-4 py-2 text-xs">
                        {r.bookName}
                        {r.bookDetail ? <span className="text-text-faint"> · {r.bookDetail}</span> : null}
                      </td>
                      <td className="text-foreground px-4 py-2 text-xs">{r.studentName ?? "—"}</td>
                      <td className="text-text-dim px-4 py-2 text-xs">{r.teacherName ?? "—"}</td>
                      <td className="px-4 py-2">
                        <Pill color={meta?.color ?? "neutral"}>{meta?.label ?? r.status}</Pill>
                      </td>
                      <td className="num text-foreground px-4 py-2 text-right text-xs font-medium">{won(r.price)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} />
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
  color: "primary" | "blue" | "amber" | "danger";
  hint?: string;
}) {
  const ICON_BG = {
    primary: "bg-primary-soft text-primary",
    blue: "bg-blue-soft text-blue",
    amber: "bg-amber-soft text-amber",
    danger: "bg-danger-soft text-danger",
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
