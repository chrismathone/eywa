import { Check } from "lucide-react";
import type { ExpenseLineItem, ExpenseRow } from "@/features/billing/server/expense-queries";
import { formatMoney } from "@/features/billing/currencies";
import { ExpensePrintBar } from "./expense-print-bar";

// 지출결의서 — ijw-calander 양식 충실 이식(상단 결재란 / 기본정보 / 항목표 / 합계 / 정산정보).
// 읽기 전용 문서 뷰. 제목 클릭 시 창(또는 임베드 드릴인)으로 표시. 단일 읽기 흐름이라 중앙 정렬 폭 제한.

const cell = "border-foreground/70 border px-3 py-2";
const headCell = `${cell} bg-bg-soft text-center font-bold whitespace-nowrap`;

export function ExpenseDocument({ expense }: { expense: ExpenseRow }) {
  // 라인아이템이 없으면 지출 자체를 단일 행으로 표시(빈 표 방지).
  const items: ExpenseLineItem[] =
    expense.lineItems && expense.lineItems.length > 0
      ? expense.lineItems
      : [
          {
            purpose: expense.category,
            vendor: expense.vendor,
            description: expense.title,
            quantity: 1,
            unitPrice: expense.amount,
            vat: false,
            total: expense.amount,
          },
        ];
  const total = items.reduce((s, l) => s + l.total, 0) || expense.amount;
  const won = (n: number) => formatMoney(n, expense.currency); // 이 결의서의 통화로 표기
  const approved = expense.approvalStatus === "approved";
  const checks = expense.approvalChecks;
  const author = expense.author ?? "";
  const authorLine = expense.position ? `${author} (${expense.position})` : author;
  const hasBankInfo = !!(expense.bankName || expense.accountNumber);

  return (
    <>
      <ExpensePrintBar />
      <div className="print-portrait mx-auto max-w-[760px] print:max-w-none">
        <article className="bg-card border-line shadow-card text-foreground rounded-md border p-8 sm:p-10 print:rounded-none print:border-0 print:p-0 print:shadow-none">
        {/* 상단: 제목 + 결재란 */}
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <h1 className="text-2xl font-extrabold tracking-wide whitespace-nowrap">지출결의서</h1>
            <span
              className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] ${
                approved
                  ? "border-primary/30 bg-primary-soft text-primary"
                  : "border-line text-text-faint"
              }`}
            >
              {approved ? <Check className="size-3" /> : null}
              {approved ? "결재완료" : "미결재"}
            </span>
          </div>
          <table className="border-foreground/70 border-2 text-xs">
            <tbody>
              <tr>
                <td className={`${headCell} text-purple px-2`} rowSpan={2}>
                  결<br />재
                </td>
                <td className={`${headCell} px-5 py-0.5`}>담당자</td>
                <td className={`${headCell} px-5 py-0.5`}>원장</td>
                <td className={`${headCell} px-5 py-0.5`}>대표</td>
              </tr>
              <tr>
                <td className="border-foreground/70 border px-5 py-4 text-center whitespace-nowrap">
                  {author}
                </td>
                <td className="border-foreground/70 text-primary border px-5 py-4 text-center font-bold">
                  {checks.director?.checked ? "✓" : ""}
                </td>
                <td className="border-foreground/70 text-primary border px-5 py-4 text-center font-bold">
                  {checks.ceo?.checked ? "✓" : ""}
                </td>
              </tr>
            </tbody>
          </table>
        </header>

        {/* 기본 정보 */}
        <table className="border-foreground/70 mb-4 w-full table-fixed border-2 text-xs">
          <colgroup>
            <col className="w-[15%]" />
            <col className="w-[35%]" />
            <col className="w-[15%]" />
            <col className="w-[35%]" />
          </colgroup>
          <tbody>
            <tr>
              <td className={headCell}>제목</td>
              <td className={cell}>{expense.title}</td>
              <td className={headCell}>작성일자</td>
              <td className={`${cell} num whitespace-nowrap`}>{expense.createdDate ?? expense.expenseDate}</td>
            </tr>
            <tr>
              <td className={headCell}>사업자 / 작성자</td>
              <td className={cell}>{authorLine || "—"}</td>
              <td className={headCell}>지출일자</td>
              <td className={`${cell} num whitespace-nowrap`}>{expense.expenseDate}</td>
            </tr>
          </tbody>
        </table>

        <p className="text-text-dim mb-3 text-center text-xs">
          아래와 같이 금액을 청구하오니 검토 후 지급을 요청합니다.
        </p>

        {/* 항목 */}
        <table className="border-foreground/70 mb-4 w-full table-fixed border-2 text-xs">
          <colgroup>
            <col className="w-[6%]" />
            <col className="w-[15%]" />
            <col className="w-[16%]" />
            <col className="w-[27%]" />
            <col className="w-[8%]" />
            <col className="w-[14%]" />
            <col className="w-[14%]" />
          </colgroup>
          <thead>
            <tr>
              <th className={headCell}>No.</th>
              <th className={headCell}>용도</th>
              <th className={headCell}>거래처</th>
              <th className={headCell}>사용내역</th>
              <th className={headCell}>수량</th>
              <th className={headCell}>금액</th>
              <th className={headCell}>총액(VAT포함)</th>
            </tr>
          </thead>
          <tbody>
            {items.map((l, i) => (
              <tr key={i}>
                <td className={`${cell} text-center font-bold`}>{i + 1}</td>
                <td className={`${cell} text-center`}>{l.purpose ?? "—"}</td>
                <td className={`${cell} text-center`}>{l.vendor ?? expense.vendor ?? "—"}</td>
                <td className={cell}>{l.description || "—"}</td>
                <td className={`${cell} num text-center whitespace-nowrap`}>{l.quantity || ""}</td>
                <td className={`${cell} num text-right whitespace-nowrap`}>
                  {l.unitPrice ? won(l.unitPrice) : ""}
                </td>
                <td className={`${cell} num text-right whitespace-nowrap`}>
                  {l.total ? won(l.total) : ""}
                  {l.vat && l.total > 0 ? (
                    <span className="text-text-faint ml-0.5 text-[8px]">(VAT)</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* 합계 */}
        <div className="border-foreground/70 mb-4 flex border-2">
          <div className="bg-amber-soft flex-1 px-4 py-2 text-sm font-bold whitespace-nowrap">합계</div>
          <div className="num min-w-[160px] px-4 py-2 text-right text-sm font-bold whitespace-nowrap">
            {won(total)}
          </div>
        </div>

        {/* 정산 정보 */}
        <table className="border-foreground/70 w-full table-fixed border-2 text-xs">
          <colgroup>
            <col className="w-[15%]" />
            <col className="w-[35%]" />
            <col className="w-[15%]" />
            <col className="w-[35%]" />
          </colgroup>
          <tbody>
            <tr>
              <td className={headCell}>정산방법</td>
              <td className={cell}>{expense.paymentMethod ?? "—"}</td>
              <td className={headCell}>분류</td>
              <td className={cell}>{expense.category}</td>
            </tr>
            {hasBankInfo ? (
              <tr>
                <td className={headCell}>{expense.paymentMethod === "계좌이체" ? "은행명" : "카드명"}</td>
                <td className={cell}>{expense.bankName ?? "—"}</td>
                <td className={headCell}>{expense.paymentMethod === "계좌이체" ? "계좌번호" : "카드번호"}</td>
                <td className={`${cell} num`}>{expense.accountNumber ?? "—"}</td>
              </tr>
            ) : null}
            {expense.receiptType || expense.receiptUrls.length > 0 ? (
              <tr>
                <td className={headCell}>증빙자료</td>
                <td className={cell}>{expense.receiptType ?? "—"}</td>
                <td className={headCell}>첨부</td>
                <td className={`${cell} num`}>
                  {expense.receiptUrls.length > 0 ? `${expense.receiptUrls.length}건` : "—"}
                </td>
              </tr>
            ) : null}
            {expense.memo ? (
              <tr>
                <td className={headCell}>비고</td>
                <td className={cell} colSpan={3}>
                  {expense.memo}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </article>
      </div>
    </>
  );
}
