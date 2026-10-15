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
it("화면에 숨겨진 텍스트는 수납 금액 입력값보다 우선하지 않는다", () => {
  table(parent("학생", 1).replace('<input value="312,000">', '<span style="display:none">0</span><input value="312,000">'));
  const cell = document.querySelector("tbody td:last-child")!;
  // Chromium innerText excludes the hidden helper; textContent contains "0".
  Object.defineProperty(cell, "innerText", { value: "", configurable: true });
  expect(cell.textContent).toBe("0");
  expect(extractTable().rows[0].at(-1)).toBe("312,000");
});
it("직원 출퇴근 표는 두 줄 머리를 칸 단위로 맞추고 줄의 직원 번호를 마지막 칸에 붙인다", () => {
  document.body.innerHTML = `<table class="list"><thead>
    <tr><th rowspan="2">No</th><th rowspan="2">이름</th><th rowspan="2">고용형태</th><th rowspan="2">일자</th><th colspan="3">출근</th><th colspan="3">퇴근</th><th rowspan="2">근무시간</th><th rowspan="2">메모</th></tr>
    <tr><th>일시</th><th>태그IP</th><th>사진</th><th>일시</th><th>태그IP</th><th>사진</th></tr></thead><tbody>
    <tr><td>2<input type="hidden" name="attYmd" value="20261015"><input type="hidden" name="staffMno" value="040A055D20280817"></td><td>홍길동</td><td>정규직</td><td>2026-10-15</td><td>2026-10-15 13:27:32</td><td>1.2.3.4</td><td></td><td>2026-10-15 21:02:10</td><td>1.2.3.4</td><td></td><td>7시간 34분</td><td></td></tr>
    <tr><td>1<input type="hidden" name="staffMno" value="040A051120331F3B"></td><td>김철수(Amy)</td><td>정규직</td><td>2026-10-14</td><td>2026-10-14 12:51:52</td><td></td><td></td><td></td><td></td><td></td><td></td><td>외근</td></tr>
  </tbody></table>`;
  const data = extractTable();
  expect(data.headers).toEqual(["No", "이름", "고용형태", "일자", "출근 일시", "출근 태그IP", "출근 사진", "퇴근 일시", "퇴근 태그IP", "퇴근 사진", "근무시간", "메모", "직원번호"]);
  expect(data.rows).toHaveLength(2);
  expect(data.rows[0]).toHaveLength(13);
  expect(data.rows[0].at(-1)).toBe("040A055D20280817");
  expect(data.rows[1].at(-1)).toBe("040A051120331F3B");
});
it("두 줄 머리가 아닌 다른 목록의 열 이름·셀은 그대로다(직원 번호 칸을 붙이지 않는다)", () => {
  table(parent("학생", 1));
  const data = extractTable();
  expect(data.headers).toEqual(["No", "이름", "청구월", "수납명", "청구액"]);
  expect(data.rows[0]).toHaveLength(5);
});
