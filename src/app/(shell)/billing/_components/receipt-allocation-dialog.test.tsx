import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReceiptAllocationButton } from "./receipt-allocation-dialog";
import { getReceiptAllocation, saveReceiptAllocation, type ReceiptAllocationView } from "@/features/billing/session-terms/server/receipt-allocation-actions";

const h = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("@/lib/realtime/record-channel", () => ({ publishRecordSaved: vi.fn() }));
vi.mock("@/features/billing/session-terms/server/receipt-allocation-actions", () => ({ getReceiptAllocation: vi.fn(), saveReceiptAllocation: vi.fn() }));

const source = [{ kind: "수업", description: "통합 수강료", amount: 300000, discount: 20000, paid: 280000 }];
function view(): ReceiptAllocationView {
  return { source, lines: [{ index: 0, kind: "수업", description: "통합 수강료", amount: 300000, source: source[0] }], terms: [1, 2].map((i) => ({
    id: `term${i}`, invoiceId: "invoice", studentId: "student", studentName: "학생", studentGrade: "중1", subject: "math", classId: `class${i}`, className: `수학${i}반`, monthlyPrice: null, pricingMode: "per_session", plannedSessions: 4, confirmedSessions: 4, unitPrice: 25000 * i, amount: 100000 * i, confirmedAt: "2026-09-16", note: null, classAmount: null,
  })) };
}
async function open(data = view()) {
  vi.mocked(getReceiptAllocation).mockResolvedValueOnce({ data });
  render(<ReceiptAllocationButton invoiceId="invoice" studentName="학생" />);
  fireEvent.click(screen.getByRole("button", { name: "수납 연결·배분" }));
  await screen.findByRole("dialog");
}
beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
});

describe("수납 연결·배분", () => {
  it("모든 반을 연결하고 할인 전 청구액을 비례 배분한 뒤 직접 조정해 저장한다", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("수학1반 수납 항목"), { target: { value: "0" } });
    expect(screen.getByRole("button", { name: "배분 저장" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("수학2반 수납 항목"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "차액 비례 배분" }));
    expect(screen.getByLabelText("수학1반 배분금액")).toHaveValue(100000);
    expect(screen.getByLabelText("수학2반 배분금액")).toHaveValue(200000);
    fireEvent.change(screen.getByLabelText("수학1반 배분금액"), { target: { value: "120000" } });
    expect(screen.getByRole("button", { name: "배분 저장" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("수학2반 배분금액"), { target: { value: "180000" } });
    vi.mocked(saveReceiptAllocation).mockResolvedValueOnce({ ok: true });
    fireEvent.click(screen.getByRole("button", { name: "배분 저장" }));
    await waitFor(() => expect(saveReceiptAllocation).toHaveBeenCalledWith("invoice", source, [
      { termId: "term1", lineIndex: 0, amount: 120000, baseAmount: 100000, confirmedAt: "2026-09-16" },
      { termId: "term2", lineIndex: 0, amount: 180000, baseAmount: 200000, confirmedAt: "2026-09-16" },
    ]));
    expect(h.refresh).toHaveBeenCalledOnce();
  });
  it("미확정 반도 선택할 수 있고 변경된 연결은 다시 선택하게 한다", async () => {
    const data = view();
    Object.assign(data.terms[0], { allocationLineIndex: 0, allocationStale: true });
    Object.assign(data.terms[1], { confirmedSessions: null, amount: null });
    await open(data);
    expect(screen.getByLabelText("수학1반 수납 항목")).toHaveValue("");
    expect(screen.getByLabelText("수학2반 수납 항목")).toBeEnabled();
    expect(screen.getByText(/청구액이나 반 확정값이 바뀌었습니다/)).toBeInTheDocument();
  });
  it("화면 사례: 미확정 반을 연결하면 187,500원·93,750원 잔액을 자동 입력하고 시수 확정 없이 저장", async () => {
    const data = view();
    const bill = [{ kind: "수업", description: "개별 토일", amount: 328125, discount: 10000 }, { kind: "수업", description: "주말보강", amount: 93750 }];
    data.source = bill;
    data.lines = bill.map((source, index) => ({ ...source, index, source }));
    Object.assign(data.terms[0], { amount: 140625, confirmedSessions: 4.5 });
    Object.assign(data.terms[1], { amount: null, unitPrice: null, confirmedSessions: null, confirmedAt: null });
    data.terms.push({ ...data.terms[1], id: "term3", className: "수학3반" });
    await open(data);
    fireEvent.change(screen.getByLabelText("수학1반 수납 항목"), { target: { value: "0" } });
    expect(screen.getByLabelText("수학1반 배분금액")).toHaveValue(140625);
    fireEvent.change(screen.getByLabelText("수학2반 수납 항목"), { target: { value: "0" } });
    expect(screen.getByLabelText("수학2반 배분금액")).toBeEnabled();
    expect(screen.getByLabelText("수학2반 배분금액")).toHaveValue(187500);
    fireEvent.change(screen.getByLabelText("수학3반 수납 항목"), { target: { value: "1" } });
    expect(screen.getByLabelText("수학3반 배분금액")).toHaveValue(93750);
    expect(screen.getAllByText("미확정")).toHaveLength(2);
    vi.mocked(saveReceiptAllocation).mockResolvedValueOnce({ ok: true });
    fireEvent.click(screen.getByRole("button", { name: "배분 저장" }));
    await waitFor(() => expect(saveReceiptAllocation).toHaveBeenCalledWith("invoice", bill, [
      { termId: "term1", lineIndex: 0, amount: 140625, baseAmount: 140625, confirmedAt: "2026-09-16" },
      { termId: "term2", lineIndex: 0, amount: 187500, baseAmount: null, confirmedAt: null },
      { termId: "term3", lineIndex: 1, amount: 93750, baseAmount: null, confirmedAt: null },
    ]));
  });
  it("모두 미확정이어도 잔액을 나누거나 입력을 바꾼 뒤 잔액을 다시 채울 수 있다", async () => {
    const data = view();
    for (const term of data.terms) Object.assign(term, { amount: null, confirmedSessions: null, confirmedAt: null, unitPrice: null });
    await open(data);
    fireEvent.change(screen.getByLabelText("수학1반 수납 항목"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("수학2반 수납 항목"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "남은 금액 나누기" }));
    expect(screen.getByLabelText("수학1반 배분금액")).toHaveValue(150000);
    expect(screen.getByLabelText("수학2반 배분금액")).toHaveValue(150000);
    fireEvent.change(screen.getByLabelText("수학1반 배분금액"), { target: { value: "100000" } });
    fireEvent.click(screen.getByRole("button", { name: "수학2반 남은 금액 적용" }));
    expect(screen.getByLabelText("수학2반 배분금액")).toHaveValue(200000);
    expect(screen.getByRole("button", { name: "배분 저장" })).toBeEnabled();
  });
  it("저장 충돌 오류를 표시하고 입력을 유지한다", async () => {
    await open();
    vi.mocked(saveReceiptAllocation).mockResolvedValueOnce({ error: "수납 내역이 변경되었습니다" });
    fireEvent.click(screen.getByRole("button", { name: "배분 저장" }));
    expect(await screen.findByText("수납 내역이 변경되었습니다")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(h.refresh).not.toHaveBeenCalled();
  });
});
