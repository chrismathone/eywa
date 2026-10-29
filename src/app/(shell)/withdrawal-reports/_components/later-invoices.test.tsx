import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ approve: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/components/workspace/window-link", () => ({ WindowLink: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/features/withdrawal-reports/server/refund-actions", () => ({ approveWithdrawalRefund: mocks.approve }));

import { LaterInvoices } from "./later-invoices";

const nov = { id: "11111111-1111-1111-1111-111111111111", period: "2026-11", category: "tuition", status: "paid",
  amountBilled: 315000, amountPaid: 315000, partial: true, refund: null,
  lines: [{ kind: "수업", description: "중등E_중2 심화 Jane", amount: 325000, discount: 10000, paid: 315000 }] };
const desks = [{ id: "22222222-2222-2222-2222-222222222222", name: "데스크A" }];

describe("퇴원 뒤 청구(원장 2026-10-29)", () => {
  it("청구가 없으면 아무것도 그리지 않는다", () => {
    const { container } = render(<LaterInvoices reportId="r" rows={[]} canApprove deskStaff={desks} />);
    expect(container.innerHTML).toBe("");
  });
  it("과목 수강종료는 끝내는 반 몫만 · 원장이 아니면 보기만", () => {
    render(<LaterInvoices reportId="r" rows={[nov]} canApprove={false} deskStaff={[]} />);
    expect(screen.getByText("2026-11 수강료(중등E_중2 심화 Jane)")).toBeInTheDocument();
    expect(screen.getAllByText("315,000원")).toHaveLength(2);
    expect(screen.getByText("요청서 없음")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
  });
  it("원장: 토글 → 데스크 담당자를 골라야 승인 → 승인 요청", async () => {
    mocks.approve.mockResolvedValue({ ok: true, documentId: "d" });
    render(<LaterInvoices reportId="r" rows={[nov]} canApprove deskStaff={desks} />);
    fireEvent.click(screen.getByRole("switch", { name: "2026-11 환불 승인" }));
    expect(screen.getByText(/환불을 승인하시겠습니까\?/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "환불 승인" })).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "데스크 담당자" }), { target: { value: desks[0].id } });
    fireEvent.click(screen.getByRole("button", { name: "환불 승인" }));
    await waitFor(() => expect(mocks.approve).toHaveBeenCalledWith("r", nov.id, desks[0].id));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });
  it("이미 승인한 청구는 담당·완료와 요청서 링크 · 낸 돈이 없는 청구는 토글 없음", () => {
    render(<LaterInvoices reportId="r" deskStaff={desks} canApprove rows={[
      { ...nov, refund: { documentId: "doc", deskName: "데스크A", completed: true } },
      { ...nov, id: "x", period: "2026-12", amountPaid: 0, status: "pending" },
    ]} />);
    expect(screen.getByText("환불 완료 · 담당 데스크A · 요청서").closest("a")).toHaveAttribute("href", "/billing/refunds/doc");
    expect(screen.queryByRole("switch")).toBeNull();
  });
});
