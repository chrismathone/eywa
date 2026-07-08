import Link from "next/link";
import { WindowLink } from "@/components/workspace/window-link";
import type { InvoiceRow, InvoiceLineItem, SortKey } from "@/features/billing/server/queries";
import { MakeeduOriginTag } from "@/components/makeedu-origin-tag";

// 구분(수납 분류) = makeedu 고정 taxonomy(과목 enum 아님) → 여기 라벨/색 하드코딩 허용.
const KIND_STYLE: Record<string, string> = {
  수업: "text-primary bg-primary-soft",
  교재: "text-gold bg-gold-soft",
  차량비: "text-text-dim bg-bg-soft",
  기타: "text-text-dim bg-bg-soft",
  원복: "text-text-dim bg-bg-soft",
};
const PAYMENT_METHOD_LABEL: Record<string, string> = {
  card: "카드",
  transfer: "계좌이체",
  cash: "현금",
  other: "기타",
};
const KRW = new Intl.NumberFormat("ko-KR");
const won = (n: number) => `${KRW.format(n)}원`;
const dash = (n: number) => (n > 0 ? won(n) : "—");
const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" }) : "—";

type Props = {
  rows: InvoiceRow[];
  sort?: SortKey;
  desc?: boolean;
  period?: string;
  q?: string;
};

function buildSortHref(
  col: SortKey,
  current: { sort?: SortKey; desc?: boolean; period?: string; q?: string },
): string {
  const params = new URLSearchParams();
  if (current.period) params.set("period", current.period);
  if (current.q) params.set("q", current.q);
  const nextDesc = current.sort === col ? !current.desc : false;
  if (col !== "status") params.set("sort", col);
  if (nextDesc) params.set("desc", "1");
  const s = params.toString();
  return s ? `/billing?${s}` : "/billing";
}

function SortHeader({
  col,
  label,
  current,
  className,
}: {
  col: SortKey;
  label: string;
  current: { sort?: SortKey; desc?: boolean; period?: string; q?: string };
  className?: string;
}) {
  const active = current.sort === col;
  return (
    <Link
      href={buildSortHref(col, current)}
      className={`text-text-dim hover:text-foreground inline-flex items-center gap-0.5 transition ${active ? "text-foreground font-bold" : ""} ${className ?? ""}`}
    >
      {label}
      <span className="font-mono text-[9px]">{active ? (current.desc ? "▼" : "▲") : "▼"}</span>
    </Link>
  );
}

// InvoiceRow(집계) → 라인 단위 행 목록. 구데이터(항목 상세 없음)는 인보이스 값으로 1행 폴백.
function toLines(r: InvoiceRow): InvoiceLineItem[] {
  if (r.lineItems.length > 0) return r.lineItems;
  return [
    {
      kind: "수업",
      description: r.notes ?? "수납",
      amount: r.amountTotal,
      discount: r.amountDiscount,
      paid: r.amountPaid,
      unpaid: Math.max(0, r.amountTotal - r.amountDiscount - r.amountPaid),
      points: r.pointsUsed,
      method: r.paymentMethod,
      paidDate: r.paidAt,
    },
  ];
}

export function BillingTable({ rows, sort, desc, period, q }: Props) {
  const current = { sort, desc, period, q };
  const groups = rows.map((r) => ({ r, lines: toLines(r) }));

  // 페이지 합계(라인 기준)
  let pageBilled = 0, pageDiscount = 0, pagePoints = 0, pagePaid = 0, pageUnpaid = 0, lineCount = 0;
  for (const g of groups)
    for (const li of g.lines) {
      pageBilled += li.amount;
      pageDiscount += li.discount ?? 0;
      pagePoints += li.points ?? 0;
      pagePaid += li.paid ?? 0;
      pageUnpaid += li.unpaid ?? 0;
      lineCount++;
    }

  const numTh = "eyebrow num px-3 py-3 text-right font-normal";
  return (
    <div className="bg-card border-border overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[1080px] text-sm [&_td]:whitespace-nowrap">
        <thead className="border-border text-muted-foreground border-b text-left text-xs [&_th]:whitespace-nowrap">
          <tr>
            <th className="eyebrow px-3 py-3 font-normal">학년</th>
            <th className="eyebrow px-3 py-3 font-normal">
              <SortHeader col="name" label="이름" current={current} />
            </th>
            <th className="eyebrow px-3 py-3 font-normal">청구월</th>
            <th className="eyebrow px-3 py-3 text-center font-normal">청구일</th>
            <th className="eyebrow px-3 py-3 font-normal">구분</th>
            <th className="eyebrow px-3 py-3 font-normal">수납명</th>
            <th className={numTh}>
              <SortHeader col="amount_total" label="청구액" current={current} className="justify-end" />
            </th>
            <th className={numTh}>할인액</th>
            <th className={numTh}>적립금</th>
            <th className={numTh}>실제낸금액</th>
            <th className={numTh}>미납금액</th>
            <th className="eyebrow px-3 py-3 font-normal">결제수단</th>
            <th className="eyebrow num px-3 py-3 text-center font-normal">수납일</th>
            <th className="eyebrow px-3 py-3 font-normal">메모</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(({ r, lines }) =>
            lines.map((li, i) => {
              const first = i === 0;
              const unpaid = li.unpaid ?? 0;
              return (
                <tr
                  key={`${r.id}-${i}`}
                  className={`hover:bg-accent/30 transition-colors ${first ? "border-border border-t" : ""}`}
                >
                  <td className="text-muted-foreground px-3 py-2.5">{first ? (r.studentGrade ?? "—") : ""}</td>
                  <td className="px-3 py-2.5">
                    {first ? (
                      <span className="inline-flex items-center">
                        <WindowLink
                          href={`/students/${r.studentId}`}
                          title={r.studentName}
                          className="text-foreground font-medium hover:underline"
                        >
                          {r.studentName}
                        </WindowLink>
                        {r.syncAddedAt ? <MakeeduOriginTag className="ml-1.5" /> : null}
                      </span>
                    ) : (
                      ""
                    )}
                  </td>
                  <td className="text-muted-foreground num px-3 py-2.5 text-xs">{first ? r.period : ""}</td>
                  <td className="text-muted-foreground num px-3 py-2.5 text-center text-xs">{li.dueDay ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-block rounded-sm px-1.5 py-0.5 text-[11px] font-medium ${KIND_STYLE[li.kind] ?? "text-text-dim bg-bg-soft"}`}>
                      {li.kind || "수업"}
                    </span>
                  </td>
                  <td className="text-foreground max-w-[280px] truncate px-3 py-2.5" title={li.description}>
                    {li.description || "—"}
                  </td>
                  <td className="text-foreground num px-3 py-2.5 text-right">{won(li.amount)}</td>
                  <td className="num px-3 py-2.5 text-right text-xs">
                    {(li.discount ?? 0) > 0 ? <span className="text-amber">-{won(li.discount ?? 0)}</span> : <span className="text-text-faint">—</span>}
                  </td>
                  <td className="num px-3 py-2.5 text-right text-xs">
                    {(li.points ?? 0) > 0 ? <span className="text-text-dim">{won(li.points ?? 0)}</span> : <span className="text-text-faint">—</span>}
                  </td>
                  <td className="num px-3 py-2.5 text-right">
                    <span className={(li.paid ?? 0) > 0 ? "text-primary" : "text-text-faint"}>{dash(li.paid ?? 0)}</span>
                  </td>
                  <td className="num px-3 py-2.5 text-right">
                    {unpaid > 0 ? <span className="text-danger font-medium">{won(unpaid)}</span> : <span className="text-chart-2">완납</span>}
                  </td>
                  <td className="text-muted-foreground px-3 py-2.5 text-xs">
                    {li.method ? (PAYMENT_METHOD_LABEL[li.method] ?? li.method) : "—"}
                  </td>
                  <td className="text-muted-foreground num px-3 py-2.5 text-center text-xs">{shortDate(li.paidDate)}</td>
                  <td className="text-text-dim px-3 py-2.5 text-xs">
                    {first && r.notes ? (
                      <span className="line-clamp-1" title={r.notes}>{r.notes}</span>
                    ) : (
                      <span className="text-text-faint">—</span>
                    )}
                  </td>
                </tr>
              );
            }),
          )}
        </tbody>
        <tfoot>
          <tr className="border-border bg-bg-soft border-t font-semibold">
            <td className="text-muted-foreground px-3 py-3 text-xs" colSpan={6}>
              이 페이지 합계 · <span className="num">{lineCount}</span>개 항목 / {groups.length}건
            </td>
            <td className="text-foreground num px-3 py-3 text-right">{won(pageBilled)}</td>
            <td className="num px-3 py-3 text-right text-xs">{pageDiscount > 0 ? <span className="text-amber">-{won(pageDiscount)}</span> : "—"}</td>
            <td className="num px-3 py-3 text-right text-xs">{pagePoints > 0 ? won(pagePoints) : "—"}</td>
            <td className="text-foreground num px-3 py-3 text-right">{won(pagePaid)}</td>
            <td className="num px-3 py-3 text-right">{pageUnpaid > 0 ? <span className="text-danger">{won(pageUnpaid)}</span> : <span className="text-chart-2">완납</span>}</td>
            <td colSpan={3} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
