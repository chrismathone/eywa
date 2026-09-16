import { afterEach, expect, it } from "vitest";
import { createRequire } from "node:module";
const { extractTable } = createRequire(import.meta.url)("./extract-table.cjs");
afterEach(() => { document.body.innerHTML = ""; });
const parent = (name: string, no: number) => `<tr><td>${no}</td><td>${name}</td><td>2026.09</td><td>수업 A</td><td><input value="312,000"></td></tr>`;
const refund = (amount = "302,000", type = "전체환불") => `<tr><td></td><td colspan="4">└ 환불1 <select><option>부분환불</option><option selected>${type}</option></select><select><option>카드환불</option></select> 환불일자:<input value="2026-09-01"> 환불금액:<input value="${amount}"> 환불사유:<input value=""><button>환불취소</button></td></tr>`;
const table = (body: string) => { document.body.innerHTML = `<table><thead><tr><th>No</th><th>이름</th><th>청구월</th><th>수납명</th><th>청구액</th></tr></thead><tbody>${body}</tbody></table>`; };
it("환불 자식 행은 정확한 부모 수납에 연결하며 원 청구·행수는 보존한다", () => {
  table(parent("김도연", 1) + refund() + parent("다른학생", 2));
  const data = extractTable();
  expect(data.rows).toHaveLength(2);
  expect(data.rows[0].at(-1)).toBe("312,000");
  expect(data.invoiceRefunds[data.rows[0].join("\u0001")]).toEqual([{ type: "full", date: "2026-09-01", amount: 302000, method: "카드환불", status: "active", source: "makeedu" }]);
  expect(data.invoiceRefunds[data.rows[1].join("\u0001")]).toEqual([]);
});
it("부분 환불 여러 건을 보존한다", () => {
  table(parent("학생", 1) + refund("10,000", "부분환불") + refund("20,000", "부분환불"));
  const data = extractTable();
  expect(data.invoiceRefunds[data.rows[0].join("\u0001")].map((r: { amount: number }) => r.amount)).toEqual([10000, 20000]);
});
it("부모·환불 금액·상태를 읽지 못하면 반영 가능한 빈 환불 목록으로 위장하지 않는다", () => {
  table(refund()); expect(() => extractTable()).toThrow("원 수납");
  table(parent("학생", 1) + refund("")); expect(() => extractTable()).toThrow("중단");
  table(parent("학생", 1) + refund().replace("환불취소", "알 수 없음")); expect(() => extractTable()).toThrow("중단");
});
