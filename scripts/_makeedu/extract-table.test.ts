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
it.each([
  '<a href="#" onclick="throw new Error(\'must not click\')"><span>환불</span> 취소</a>',
  '<span role="button" aria-label="환불 취소">×</span>',
  '<input type="button" value="환불취소">',
  '<span onclick="void(0)">환불 취소</span>',
  '<a href="#"><img alt="환불취소"></a>',
  '<input type="image" alt="환불취소">',
  '<button value="환불취소"></button>',
])("환불취소의 링크·버튼 형태를 읽기만 한다: %s", (control) => {
  table(parent("학생", 1) + refund().replace("<button>환불취소</button>", control));
  const data = extractTable();
  expect(data.invoiceRefunds[data.rows[0].join("\u0001")][0].amount).toBe(302000);
});
it("셀·태그 사이에 나뉜 라벨, 전각 콜론, 한 자리 날짜를 읽는다", () => {
  table(parent("학생", 1) + `<tr><td>└ 환불1</td><td><select><option>전액 환불</option></select><select><option>카드환불</option></select></td><td><span>환불</span> <span>일자：</span><input value="2026.9.1"></td><td><span>환 불 금 액：</span><input value="302,000">원</td><td>환불사유:<input value=""><a href="#">환불취소</a></td></tr>`);
  const data = extractTable();
  expect(data.invoiceRefunds[data.rows[0].join("\u0001")][0]).toMatchObject({ type: "full", date: "2026-09-01", amount: 302000 });
});
it("현재 선택/입력값을 읽고 숨김 값·메모에 적힌 환불 유형은 쓰지 않는다", () => {
  table(parent("학생", 1) + refund().replace("환불사유:<input value=\"\">", '환불사유:<input value="부분환불로 바꾸지 않음"><input type="hidden" value="전체환불 999999">'));
  const selects = document.querySelectorAll("tbody select");
  (selects[0] as HTMLSelectElement).selectedIndex = 0;
  const inputs = document.querySelectorAll("tbody tr:last-child input");
  (inputs[1] as HTMLInputElement).value = "10,000";
  const data = extractTable();
  expect(data.invoiceRefunds[data.rows[0].join("\u0001")][0]).toMatchObject({ type: "partial", amount: 10000 });
});
it.each(["2026-02-30", "2026-13-01", "", "날짜 없음"])("유효하지 않은 날짜는 환불일자 오류로 중단: %s", (date) => {
  table(parent("학생", 1) + refund().replace("2026-09-01", date));
  expect(() => extractTable()).toThrow("확인 불가: 환불일자");
});
it.each(["-302,000", "302,000.5", "302,00", "", "미정"])("금액을 추측하거나 일부 숫자로 잘라 읽지 않는다: %s", (amount) => {
  table(parent("학생", 1) + refund(amount));
  expect(() => extractTable()).toThrow("확인 불가: 환불금액");
});
it("0원 환불도 명시된 값으로 보존하고 활성 근거가 없으면 이유를 알린다", () => {
  table(parent("학생", 1) + refund("0"));
  const data = extractTable();
  expect(data.invoiceRefunds[data.rows[0].join("\u0001")][0].amount).toBe(0);
  table(parent("학생", 1) + refund().replace("<button>환불취소</button>", '<input type="hidden" value="환불취소">'));
  expect(() => extractTable()).toThrow("확인 불가: 환불취소 버튼");
});
it("읽기 전용으로 표시된 환불 값도 라벨을 기준으로 읽는다", () => {
  table(parent("학생", 1) + '<tr><td>└ 환불1</td><td colspan="4">전체 환불 환불일자: 2026/9/1 환불금액: ₩302,000 원 환불사유: 부분환불로 바꾸지 않음 <a href="#">환불취소</a></td></tr>');
  const data = extractTable();
  expect(data.invoiceRefunds[data.rows[0].join("\u0001")][0]).toMatchObject({ type: "full", date: "2026-09-01", amount: 302000 });
});
it("서로 모순된 환불 유형은 전체환불로 단정하지 않는다", () => {
  table(parent("학생", 1) + refund().replace("환불일자:", '<select><option>부분환불</option></select>환불일자:'));
  expect(() => extractTable()).toThrow("확인 불가: 전체/부분 환불 구분");
});
