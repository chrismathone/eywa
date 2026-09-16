import type { InvoiceLineItem } from "@/features/billing/invoice-line-items";

const methods: Record<string, string> = { card: "카드", cash: "현금", transfer: "이체", other: "기타" };
const won = (value: number | undefined) => value === undefined ? "—" : `${value.toLocaleString("ko-KR")}원`;

export function MergedReceiptDetails({ line }: { line: InvoiceLineItem }) {
  if (!line.sourceItems?.length) return null;
  return (
    <details data-no-drag-scroll className="text-text-dim mt-1 whitespace-normal text-xs">
      <summary className="text-primary cursor-pointer">원본 수납 {line.sourceItems.length}건</summary>
      <ul className="border-line mt-2 space-y-2 border-l pl-2">
        {line.sourceItems.map((item, index) => (
          <li key={index}>
            <div>{item.paidDate || "수납일 없음"} · {item.method ? (methods[item.method] ?? item.method) : "결제수단 없음"}</div>
            <div>청구 {won(item.amount)} · 할인 {won(item.discount ?? 0)}</div>
            <div>납부 {won(item.paid)} · 미납 {won(item.unpaid)} · 적립금 {won(item.points ?? 0)}</div>
            {item.receipt ? <div>현금영수증 {item.receipt}</div> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
