import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReceiptAllocationButton } from "./receipt-allocation-dialog";
import { getReceiptAllocation, mergeReceiptItems, saveReceiptAllocation, type ReceiptAllocationView } from "@/features/billing/session-terms/server/receipt-allocation-actions";

const h = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("@/lib/realtime/record-channel", () => ({ publishRecordSaved: vi.fn() }));
vi.mock("@/features/billing/session-terms/server/receipt-allocation-actions", () => ({ getReceiptAllocation: vi.fn(), saveReceiptAllocation: vi.fn(), mergeReceiptItems: vi.fn() }));

const source = [{ kind: "수업", description: "통합 수강료", amount: 300000, discount: 20000, paid: 280000 }];
function view(): ReceiptAllocationView {
  return { source, lines: [{ index: 0, kind: "수업", description: "통합 수강료", amount: 300000, source: source[0] }], terms: [1, 2].map((i) => ({
    id: `term${i}`, invoiceId: "invoice", studentId: "student", studentName: "학생", studentGrade: "중1", subject: "math", classId: `class${i}`, className: `수학${i}반`, monthlyPrice: null, pricingMode: "per_session", plannedSessions: 4, confirmedSessions: 4, unitPrice: 25000 * i, amount: 100000 * i, confirmedAt: "2026-09-16", note: null, classAmount: null, termState: "term" as const,
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
  it("명확한 자동 제안은 열 때 선택되고 저장 전까지 DB에 쓰지 않는다", async () => {
    const data = view(); data.terms = [data.terms[0]];
    data.suggestions = [{ lineIndex: 0, kind: "match", reason: "반명 일치", rows: [{ termId: "term1", amount: 300000 }] }];
    await open(data);
    expect(screen.getByLabelText("수학1반 수납 항목")).toHaveValue("0");
    expect(screen.getByLabelText("수학1반 배분금액")).toHaveValue(300000);
    expect(saveReceiptAllocation).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "배분 저장" })).toBeEnabled();
  });
  it("저장된 0원은 보존하고 이력 제안을 누를 때만 입력값을 재배분한다", async () => {
    const data = view();
    Object.assign(data.terms[0], { allocationLineIndex: 0, allocatedAmount: 300000 });
    Object.assign(data.terms[1], { allocationLineIndex: 0, allocatedAmount: 0 });
    data.suggestions = [{ lineIndex: 0, kind: "transfer", reason: "반 이동 이력", rows: [{ termId: "term1", amount: 60000 }, { termId: "term2", amount: 240000 }] }];
    await open(data);
    expect(screen.getByLabelText("수학2반 배분금액")).toHaveValue(0);
    fireEvent.click(screen.getByRole("button", { name: "이력대로 배분" }));
    expect(screen.getByLabelText("수학1반 배분금액")).toHaveValue(60000);
    expect(screen.getByLabelText("수학2반 배분금액")).toHaveValue(240000);
    expect(saveReceiptAllocation).not.toHaveBeenCalled();
  });
  it("이동 수납을 선택 합산하고 입력한 배분금액·종료일 표시를 유지한다", async () => {
    const data = view();
    const originals = [{ kind: "수업", description: "이전 반", amount: 100000, paid: 100000, unpaid: 0 }, { kind: "수업", description: "현재 반", amount: 200000, paid: 200000, unpaid: 0 }];
    data.source = originals; data.lines = originals.map((source, index) => ({ ...source, index, source }));
    data.terms[0].enrollmentLabel = "9/1~9/7 · 종료";
    await open(data);
    expect(screen.getByText("9/1~9/7 · 종료")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("수학1반 수납 항목"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("수학2반 수납 항목"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("수학1반 배분금액"), { target: { value: "120000" } });
    fireEvent.change(screen.getByLabelText("수학2반 배분금액"), { target: { value: "180000" } });
    fireEvent.click(screen.getByRole("button", { name: "수납 항목 합산" }));
    fireEvent.click(screen.getByLabelText("이전 반 합산 선택")); fireEvent.click(screen.getByLabelText("현재 반 합산 선택"));
    const merged = { kind: "수업", description: "이전 반 + 현재 반", amount: 300000, paid: 300000, unpaid: 0, receiptGroupId: "group", sourceItems: originals };
    vi.mocked(mergeReceiptItems).mockResolvedValueOnce({ data: { ...data, source: [merged], lines: [{ ...merged, index: 0, source: merged }] }, committed: true });
    fireEvent.click(screen.getByRole("button", { name: "선택 항목 합산" }));
    await screen.findByRole("status");
    expect(mergeReceiptItems).toHaveBeenCalledWith("invoice", originals, [0, 1], "이전 반 + 현재 반", undefined);
    expect(screen.getByLabelText("수학1반 배분금액")).toHaveValue(120000);
    expect(screen.getByLabelText("수학2반 배분금액")).toHaveValue(180000);
    expect(screen.getByLabelText("수학2반 수납 항목")).toHaveValue("0");
    expect(screen.getByRole("button", { name: "배분 저장" })).toBeEnabled();
    vi.mocked(saveReceiptAllocation).mockResolvedValueOnce({ ok: true });
    fireEvent.click(screen.getByRole("button", { name: "배분 저장" }));
    await waitFor(() => expect(saveReceiptAllocation).toHaveBeenCalledWith("invoice", [merged], expect.arrayContaining([expect.objectContaining({ termId: "term2", lineIndex: 0, amount: 180000 })])));
  });
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
  it("연결할 수납 항목이 없는 확정 반은 '연결 안 함'이면 0원으로 표시·저장한다 (원장 2026-09-17)", async () => {
    const data = view();
    const one = [{ kind: "수업", description: "수학1반", amount: 100000, discount: 0, paid: 100000 }];
    Object.assign(data, { source: one, lines: [{ index: 0, kind: "수업", description: "수학1반", amount: 100000, source: one[0] }] });
    await open(data);
    fireEvent.change(screen.getByLabelText("수학1반 수납 항목"), { target: { value: "0" } });
    expect(screen.getByLabelText("수학1반 배분금액")).toHaveValue(100000);
    // 수학2반은 연결 안 함 → 0원(입력은 잠김) · 저장 가능 · 무엇을 저장하는지 말한다.
    expect(screen.getByLabelText("수학2반 수납 항목")).toHaveValue("");
    expect(screen.getByLabelText("수학2반 배분금액")).toHaveValue(0);
    expect(screen.getByLabelText("수학2반 배분금액")).toBeDisabled();
    expect(screen.getByText(/연결하지 않은 확정 반 1개는 0원으로 저장합니다/)).toBeInTheDocument();
    vi.mocked(saveReceiptAllocation).mockResolvedValueOnce({ ok: true });
    fireEvent.click(screen.getByRole("button", { name: "배분 저장" }));
    await waitFor(() => expect(saveReceiptAllocation).toHaveBeenCalledWith("invoice", one, [
      { termId: "term1", lineIndex: 0, amount: 100000, baseAmount: 100000, confirmedAt: "2026-09-16" },
      { termId: "term2", lineIndex: null, amount: 0, baseAmount: 200000, confirmedAt: "2026-09-16" },
    ]));
  });
  const withLines = (descriptions: [string, number][]) => {
    const data = view();
    const lines = descriptions.map(([description, amount]) => ({ kind: "수업", description, amount }));
    return Object.assign(data, { source: lines, lines: lines.map((l, index) => ({ index, kind: "수업", description: l.description, amount: l.amount, source: l })) });
  };
  it("0원이 빠뜨린 연결을 덮지 않는다 ① 이름이 맞는 수납 항목이 있는 반은 0원으로 저장하지 않는다", async () => {
    await open(withLines([["수학1반", 100000], ["수학2반", 200000]]));
    fireEvent.change(screen.getByLabelText("수학1반 수납 항목"), { target: { value: "0" } });
    expect(screen.getByRole("button", { name: "배분 저장" })).toBeDisabled();
    expect(screen.getByText(/수학2반에 맞는 수납 항목이 있습니다/)).toBeInTheDocument();
  });
  it("0원이 빠뜨린 연결을 덮지 않는다 ② 어느 반에도 안 붙은 수업 항목이 남으면 보여 주고 저장할 때 확인받는다(취소하면 안 보낸다)", async () => {
    await open(withLines([["수학1반", 100000], ["특강", 50000]]));
    fireEvent.change(screen.getByLabelText("수학1반 수납 항목"), { target: { value: "0" } });
    expect(screen.getByText(/어느 반에도 연결하지 않은 수업 항목이 남습니다\(특강 50,000원\)/)).toBeInTheDocument();
    const ask = vi.fn(() => false);
    vi.stubGlobal("confirm", ask);
    fireEvent.click(screen.getByRole("button", { name: "배분 저장" }));
    expect(ask).toHaveBeenCalledWith(expect.stringContaining("특강 50,000원"));
    expect(saveReceiptAllocation).not.toHaveBeenCalled();
    ask.mockReturnValue(true);
    vi.mocked(saveReceiptAllocation).mockResolvedValueOnce({ ok: true });
    fireEvent.click(screen.getByRole("button", { name: "배분 저장" }));
    await waitFor(() => expect(saveReceiptAllocation).toHaveBeenCalledWith("invoice", expect.anything(), [
      { termId: "term1", lineIndex: 0, amount: 100000, baseAmount: 100000, confirmedAt: "2026-09-16" },
      { termId: "term2", lineIndex: null, amount: 0, baseAmount: 200000, confirmedAt: "2026-09-16", ackUnlinked: true },
    ]));
    vi.unstubAllGlobals();
  });
  it("차액 비례 배분은 눌러도 바뀌는 게 없으면(이미 그 비율) 잠기고, 입력이 비율과 어긋나면 다시 열린다", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("수학1반 수납 항목"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("수학2반 수납 항목"), { target: { value: "0" } });
    const button = () => screen.getByRole("button", { name: "차액 비례 배분" });
    expect(button()).toBeDisabled();
    expect(button()).toHaveAttribute("title", "입력한 금액이 이미 나눈 결과와 같습니다");
    fireEvent.change(screen.getByLabelText("수학1반 배분금액"), { target: { value: "120000" } });
    expect(button()).toBeEnabled();
    fireEvent.click(button());
    expect(screen.getByLabelText("수학1반 배분금액")).toHaveValue(100000);
    expect(button()).toBeDisabled();
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

describe("회차 행이 없는 반(출석부 줄에 맞춤, 원장 2026-09-18)", () => {
  it("'회차 없음' 반은 한글 표식 + 저장하면 행이 생긴다는 안내가 서고, 연결하면 가상 id 그대로 서버에 보낸다(서버가 만든다)", async () => {
    const data = view();
    const VID = "v:11111111-1111-4111-8111-111111111111:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    Object.assign(data.terms[1], { id: VID, termState: "missing", confirmedSessions: null, unitPrice: null, amount: null, confirmedAt: null });
    vi.mocked(saveReceiptAllocation).mockResolvedValueOnce({ ok: true });
    await open(data);
    expect(screen.getByText("회차 없음")).toBeInTheDocument();
    expect(screen.getByText(/배분을 저장하는 순간 회차 행이 만들어집니다/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("수학1반 수납 항목"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("수학1반 배분금액"), { target: { value: "150000" } });
    fireEvent.change(screen.getByLabelText("수학2반 수납 항목"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("수학2반 배분금액"), { target: { value: "150000" } });
    fireEvent.click(screen.getByRole("button", { name: "배분 저장" }));
    await waitFor(() => expect(saveReceiptAllocation).toHaveBeenCalled());
    const rows = vi.mocked(saveReceiptAllocation).mock.calls[0][2];
    expect(rows.map((r) => r.termId).sort()).toEqual(["term1", VID].sort());
  });
});
