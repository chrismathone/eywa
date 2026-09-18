import { Check } from "@/components/icons/eywa-icon-compat";
import type { ExpenseLineItem, ExpenseRow } from "@/features/billing/server/expense-queries";
import { formatMoney } from "@/features/billing/currencies";
import { ExpensePrintBar } from "./expense-print-bar";

// 지출결의서 — ijw-calander 양식 충실 이식(상단 결재란 / 기본정보 / 항목표 / 합계 / 정산정보).
// 읽기 전용 문서 뷰. 제목 클릭 시 창(또는 임베드 드릴인)으로 표시. 단일 읽기 흐름이라 중앙 정렬 폭 제한.

// 값 칸(cell)과 라벨 칸(headCell)은 여백이 다르다 — 표가 `table-fixed` + 퍼센트 폭이라
// 라벨 칸이 좁아(7~17%) `px-3`(좌우 24px)을 그대로 쓰면 `사업자 / 작성자`·`총액(VAT포함)` 같은
// 라벨이 내용 폭을 넘겨 **칸 밖으로 흘렀다**(원장 제보 2026-08-25 — 문서 폭 ~650px 이하에서
// `총액(VAT포함)`은 표 오른쪽 테두리 밖까지 나갔다).
// ⚠️ 라벨은 자르지 않는다(`truncate`/`overflow-hidden` 금지) — 종이 서식이라 잘린 라벨은 넘치는 것보다 나쁘다.
//    대신 여백을 줄이고(px-1.5) 넘치면 한글 어절 단위로 접는다(`break-keep`, 음절 쪼개짐 방지).
// ⚠️ 값 칸의 `px-3`은 그대로 — 좁히면 값이 답답해진다.
const cellBase = "border-foreground/70 border py-2";
const cell = `${cellBase} px-3`;
const headBase = `${cellBase} bg-bg-soft px-1.5 font-bold break-keep`;
const headCell = `${headBase} text-center`;
// 항목 표 머리는 값 칸과 **같은 쪽**(원장 2026-09-18 *"견적서랑 지출결의서도 맞춰줘"*) — 사용내역(글) 왼쪽 · 금액 오른쪽.
// 정렬 유틸을 뺀 바탕에서 만든다(headCell 뒤에 text-right를 덧붙이면 승자를 생성된 CSS 순서가 정한다 — 위 주석).
// 여백도 값 칸(px-3)과 같게 — 왼쪽·오른쪽 정렬은 여백이 곧 글자 위치다. 단 `총액(VAT포함)`은 칸이 좁아 px-1.5 그대로(넘친다).
const headLeft = `${cellBase} bg-bg-soft px-3 text-left font-bold break-keep`;
const headRight = `${cellBase} bg-bg-soft px-3 text-right font-bold break-keep`;
const headRightTight = `${headBase} text-right`;
// 결재란은 폭이 자동인 별도 표라(퍼센트 폭 아님) 라벨이 접힐 일이 없다 — 옛 headCell 문자열을 **그대로** 뗀 것이다.
// 🔴 한 글자도 바꾸지 말 것: 호출부가 `px-5 py-0.5`·`px-2`로 덮어쓰는데, 충돌하는 Tailwind 유틸의 승자는
//    클래스 문자열 순서가 아니라 **생성된 CSS 순서**라 값을 빼면 승자가 조용히 뒤바뀐다
//    (실측: `py-2`를 뺐더니 `py-0.5`가 이겨 도장칸 머리 행이 34px→22px로 납작해졌다).
const stampCell = "border-foreground/70 border px-3 py-2 bg-bg-soft text-center font-bold whitespace-nowrap";

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
      <div className="paper-scale print-portrait mx-auto max-w-[760px] print:max-w-none">
        <article className="bg-card border-line shadow-card text-foreground rounded-2xl border p-8 sm:p-10 print:rounded-none print:border-0 print:p-0 print:shadow-none">
        {/* 상단: 제목 + 결재란 */}
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <h1 className="text-2xl font-bold tracking-wide whitespace-nowrap">지출결의서</h1>
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
                <td className={`${stampCell} text-purple px-2`} rowSpan={2}>
                  결<br />재
                </td>
                <td className={`${stampCell} px-5 py-0.5`}>담당자</td>
                <td className={`${stampCell} px-5 py-0.5`}>원장</td>
                <td className={`${stampCell} px-5 py-0.5`}>대표</td>
              </tr>
              <tr>
                <td className="border-foreground/70 border px-5 py-4 text-center whitespace-nowrap">
                  {author}
                </td>
                <td className="border-foreground/70 text-primary border px-5 py-4 text-center font-bold">
                  {checks.director?.checked ? <Check className="mx-auto size-3.5" /> : null}
                </td>
                <td className="border-foreground/70 text-primary border px-5 py-4 text-center font-bold">
                  {checks.ceo?.checked ? <Check className="mx-auto size-3.5" /> : null}
                </td>
              </tr>
            </tbody>
          </table>
        </header>

        {/* 기본 정보 */}
        <table className="border-foreground/70 mb-4 w-full table-fixed border-2 text-xs">
          <colgroup>
            {/* 라벨 칸 17% — `사업자 / 작성자`(가장 긴 라벨)가 한 줄에 들어가는 최소치.
                기본정보·정산정보 두 표가 같은 비율이라 세로 구분선이 이어진다. 합 100%. */}
            <col className="w-[17%]" />
            <col className="w-[33%]" />
            <col className="w-[17%]" />
            <col className="w-[33%]" />
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
            {/* 마지막 열 14%→16% — `총액(VAT포함)`이 한 줄에 들어가야 한다(가장 긴 머리글).
                No. 6%→7% — 좁은 창(문서 폭 ~500~650px)에서 `No`/`.`로 쪼개지지 않게.
                늘린 3%는 거래처(2)·사용내역(1)에서 — 둘 다 값이 접히는 칸이고, 사용내역은 여전히 가장 넓다. 합 100%. */}
            <col className="w-[7%]" />
            <col className="w-[15%]" />
            <col className="w-[14%]" />
            <col className="w-[26%]" />
            <col className="w-[8%]" />
            <col className="w-[14%]" />
            <col className="w-[16%]" />
          </colgroup>
          <thead>
            <tr>
              <th className={headCell}>No.</th>
              <th className={headCell}>용도</th>
              <th className={headCell}>거래처</th>
              <th className={headLeft}>사용내역</th>
              <th className={headCell}>수량</th>
              <th className={headRight}>금액</th>
              <th className={headRightTight}>총액(VAT포함)</th>
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
            {/* 라벨 칸 17% — `사업자 / 작성자`(가장 긴 라벨)가 한 줄에 들어가는 최소치.
                기본정보·정산정보 두 표가 같은 비율이라 세로 구분선이 이어진다. 합 100%. */}
            <col className="w-[17%]" />
            <col className="w-[33%]" />
            <col className="w-[17%]" />
            <col className="w-[33%]" />
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
