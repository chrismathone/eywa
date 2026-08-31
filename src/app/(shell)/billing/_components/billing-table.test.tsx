/**
 * 수납 표 접힘/펼침 — 원장 2026-08-31 *"기본적으로 접어진상태로 합계금액이 보이도록 해주고,
 * 클릭하거나 펼쳤을때 세부내역 보이도록"* + *"클릭해서 펼치거나, 전체 펼치기 버튼 추가하거나 등"*.
 *
 * 🔴 지키는 것 넷: ① 기본은 접힘 ② 접힌 줄이 **합계**를 말한다(라인 값이 아니라)
 *    ③ 라인이 하나뿐인 청구서는 접을 게 없어 화살표를 놓지 않는다 ④ 열 수가 어디서도 어긋나지 않는다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BillingTable } from "./billing-table";
import type { InvoiceRow } from "@/features/billing/server/queries";

afterEach(cleanup);

const row = (p: Partial<InvoiceRow> = {}): InvoiceRow => ({
  id: "inv-1",
  studentId: "stu-1",
  studentName: "김지우",
  studentGrade: "중2",
  period: "2026-09",
  category: "tuition",
  amountTotal: 466500,
  amountPaid: 12000,
  amountDiscount: 20000,
  status: "unpaid",
  dueDate: null,
  paidAt: null,
  notes: null,
  lineItems: [
    { kind: "수업", description: "중고E_중2 최상위 Elsa", amount: 262500, discount: 10000, paid: 0, unpaid: 252500, dueDay: 1 },
    { kind: "수업", description: "중등M 개별 BS3R", amount: 192000, discount: 10000, paid: 0, unpaid: 182000, dueDay: 1 },
    { kind: "교재", description: "중2-2 중간 내신대비", amount: 12000, paid: 12000, unpaid: 0, dueDay: 1 },
  ],
  paymentMethod: null,
  cardCompany: null,
  cashReceiptNumber: null,
  pointsUsed: 0,
  discountReason: null,
  billedAt: "2026-09-01",
  syncAddedAt: null,
  updatedAt: null,
  ...p,
});

const single = (): InvoiceRow =>
  row({
    id: "inv-2",
    studentId: "stu-2",
    studentName: "윤나연",
    studentGrade: "고3",
    amountTotal: 163500,
    amountPaid: 0,
    amountDiscount: 0,
    lineItems: [{ kind: "수업", description: "고등E_고3 정규 Charlie", amount: 163500, paid: 0, unpaid: 163500 }],
  });

describe("BillingTable — 접힘이 기본", () => {
  it("기본은 접힘 — 세부 항목명은 안 보이고 합계만 보인다", () => {
    render(<BillingTable rows={[row()]} />);
    expect(screen.queryByText("중등M 개별 BS3R")).toBeNull();
    expect(screen.getAllByText("466,500원").length).toBeGreaterThan(0); // 청구 합계
    expect(screen.getAllByText("434,500원").length).toBeGreaterThan(0); // 미납 합계
    expect(screen.getByText(/외/)).toBeTruthy();
  });

  it("줄을 누르면 세부 항목이 펼쳐지고, 다시 누르면 접힌다", () => {
    render(<BillingTable rows={[row()]} />);
    fireEvent.click(screen.getByRole("button", { name: /세부 항목 3개 펼치기/ }));
    expect(screen.getByText("중등M 개별 BS3R")).toBeTruthy();
    expect(screen.getByText("중2-2 중간 내신대비")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /세부 항목 접기/ }));
    expect(screen.queryByText("중등M 개별 BS3R")).toBeNull();
  });

  it("'전체 펼치기'가 모든 청구서를 한 번에 편다", () => {
    render(<BillingTable rows={[row(), row({ id: "inv-3", studentName: "정주원" })]} />);
    fireEvent.click(screen.getByRole("button", { name: "전체 펼치기" }));
    expect(screen.getAllByText("중등M 개별 BS3R").length).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "전체 접기" }));
    expect(screen.queryByText("중등M 개별 BS3R")).toBeNull();
  });

  it("🔴 라인이 하나뿐인 청구서엔 화살표가 없다(접어도 같은 줄)", () => {
    render(<BillingTable rows={[single()]} />);
    expect(screen.queryByRole("button", { name: /세부 항목/ })).toBeNull();
    expect(screen.getByText("고등E_고3 정규 Charlie")).toBeTruthy();
  });

  it("접힌 줄의 합계가 표 아래 '이 페이지 합계'와 같은 값이다", () => {
    render(<BillingTable rows={[row()]} />);
    const foot = document.querySelector("tfoot")!;
    // 합계 줄의 청구액과 접힌 줄의 청구액이 같은 문자열이어야 한다(둘 다 라인 합).
    expect(within(foot).getByText("466,500원")).toBeTruthy();
    expect(screen.getAllByText("466,500원").length).toBe(2);
  });

  it("🔴 열 수가 머리·접힘·펼침·합계에서 모두 같다(어긋나면 표가 통째로 밀린다)", () => {
    render(<BillingTable rows={[row()]} />);
    const cols = document.querySelectorAll("thead tr th").length;
    const span = (tr: Element) =>
      Array.from(tr.children).reduce((n, c) => n + (Number(c.getAttribute("colspan")) || 1), 0);
    expect(span(document.querySelector("tbody tr")!)).toBe(cols); // 접힌 줄
    expect(span(document.querySelector("tfoot tr")!)).toBe(cols); // 합계 줄
    fireEvent.click(screen.getByRole("button", { name: /세부 항목 3개 펼치기/ }));
    for (const tr of document.querySelectorAll("tbody tr")) expect(span(tr)).toBe(cols);
  });
});

describe("🔴 클라 컴포넌트가 된 대가 — 서버 전용 모듈을 런타임으로 끌고 오지 않는다", () => {
  // [[#61]] `import "server-only"`가 붙은 모듈을 클라가 **값으로** import하면 빌드가 깨진다.
  // 타입만 쓰는 import는 컴파일에서 지워지므로 안전하다 — 그 형태를 못박는다(값 import로 바뀌면 걸린다).
  const linesWith = (path: string[], needle: string) =>
    readFileSync(join(process.cwd(), ...path), "utf8")
      .split("\n")
      .filter((l) => l.includes(needle));

  it("표와 요약 헬퍼 모두 server/queries를 타입으로만 가져온다", () => {
    const table = linesWith(
      ["src", "app", "(shell)", "billing", "_components", "billing-table.tsx"],
      "billing/server/queries",
    );
    expect(table.length).toBeGreaterThan(0);
    for (const l of table) expect(l.trimStart().startsWith("import type")).toBe(true);

    const pure = linesWith(["src", "features", "billing", "line-summary.ts"], "server/queries");
    expect(pure.length).toBeGreaterThan(0);
    for (const l of pure) expect(l.trimStart().startsWith("import type")).toBe(true);
  });
});
