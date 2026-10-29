import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ approve: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/components/workspace/window-link", () => ({ WindowLink: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/features/withdrawal-reports/server/refund-actions", () => ({ approveWithdrawalRefund: mocks.approve }));

import { LaterInvoices } from "./later-invoices";

const nov = { id: "11111111-1111-1111-1111-111111111111", period: "2026-11", category: "tuition", status: "paid", amountTotal: 720000, amountDiscount: 10000, amountPaid: 710000, refundDocId: null };

describe("퇴원 뒤 청구(원장 2026-10-29)", () => {
  it("청구가 없으면 아무것도 그리지 않는다", () => {
    const { container } = render(<LaterInvoices reportId="r" rows={[]} canApprove />);
    expect(container.innerHTML).toBe("");
  });
  it("원장이 아니면 보기만 — 토글이 없다", () => {
    render(<LaterInvoices reportId="r" rows={[nov]} canApprove={false} />);
    expect(screen.getByText("2026-11 수강료")).toBeInTheDocument();
    expect(screen.getByText("요청서 없음")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
  });
  it("원장: 토글 → '환불을 승인하시겠습니까?' 확인 → 승인 요청", async () => {
    mocks.approve.mockResolvedValue({ ok: true, documentId: "d" });
    render(<LaterInvoices reportId="r" rows={[nov]} canApprove />);
    fireEvent.click(screen.getByRole("switch", { name: "2026-11 환불 승인" }));
    expect(screen.getByText(/환불을 승인하시겠습니까\?/)).toBeInTheDocument();
    expect(mocks.approve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "환불 승인" }));
    await waitFor(() => expect(mocks.approve).toHaveBeenCalledWith("r", nov.id));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });
  it("이미 승인한 청구는 요청서 링크 · 낸 돈이 없거나 환불된 청구는 토글 없음", () => {
    render(<LaterInvoices reportId="r" rows={[{ ...nov, refundDocId: "doc" }, { ...nov, id: "x", period: "2026-12", amountPaid: 0, status: "pending" }]} canApprove />);
    expect(screen.getByText("환불 승인됨 · 요청서 보기").closest("a")).toHaveAttribute("href", "/billing/refunds/doc");
    expect(screen.queryByRole("switch")).toBeNull();
  });
});
