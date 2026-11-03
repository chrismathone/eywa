import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ approve: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/components/workspace/window-link", () => ({ WindowLink: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/features/withdrawal-reports/server/refund-actions", () => ({ approveWithdrawalRefund: mocks.approve }));

import { LaterInvoices } from "./later-invoices";

const id = "11111111-1111-1111-1111-111111111111";
const line = (i: number, description: string, paid: number) => ({ kind: "수업", description, amount: paid + 10000, discount: 10000, paid, key: `${id}#${i}`, paidNet: paid, billingRefund: false, refund: null });
const nov = { id, period: "2026-11", category: "tuition", status: "paid", amountBilled: 515000, amountPaid: 515000, partial: false,
  lines: [line(0, "중등E_중2 심화 Jane", 315000), line(1, "중2 수학 A", 200000)] };
const desks = [{ id: "22222222-2222-2222-2222-222222222222", name: "데스크A" }];

describe("퇴원 뒤 청구(원장 2026-10-29)", () => {
  it("청구가 없으면 '환불할 건 없음' 한 줄(보고서 양식의 환불 확인 칸 — 원장 2026-10-30)", () => {
    render(<LaterInvoices reportId="r" rows={[]} canApprove deskStaff={desks} />);
    expect(screen.getByText("퇴원월 뒤 청구 없음 — 환불할 건이 없습니다.")).toBeInTheDocument();
  });
  it("수납 줄마다 한 행 · 원장이 아니면 보기만", () => {
    render(<LaterInvoices reportId="r" rows={[nov]} canApprove={false} deskStaff={[]} />);
    expect(screen.getByText("2026-11 수강료 · 중등E_중2 심화 Jane")).toBeInTheDocument();
    expect(screen.getByText("2026-11 수강료 · 중2 수학 A")).toBeInTheDocument();
    expect(screen.getAllByText("요청서 없음")).toHaveLength(2);
    expect(screen.queryByRole("switch")).toBeNull();
  });
  it("고른 게 없으면 승인 버튼·담당자 선택이 없다", () => {
    render(<LaterInvoices reportId="r" rows={[nov]} canApprove deskStaff={desks} />);
    expect(screen.getAllByRole("switch")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "환불 승인" })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
  it("원장: 줄 토글로 고름 → 환불 승인 → 담당자 골라야 확정 → 고른 줄만 보냄", async () => {
    mocks.approve.mockResolvedValue({ ok: true, documentId: "d", gates: false });
    render(<LaterInvoices reportId="r" rows={[nov]} canApprove deskStaff={desks} />);
    fireEvent.click(screen.getByRole("switch", { name: "2026-11 수강료 · 중등E_중2 심화 Jane 환불" }));
    expect(screen.getByText("선택 1건 · 환불 315,000원")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "환불 승인" }));
    expect(screen.getByText(/환불을 승인하시겠습니까\?/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "환불 승인" })).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "데스크 담당자" }), { target: { value: desks[0].id } });
    fireEvent.click(screen.getByRole("button", { name: "환불 승인" }));
    await waitFor(() => expect(mocks.approve).toHaveBeenCalledWith("r", [`${id}#0`], desks[0].id));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });
  it("처리 전 보고서면 데스크 환불까지 끝나야 처리한다고 알린다 · 원장급이 아니면 보기만(원장 2026-10-29 규칙)", () => {
    const { unmount } = render(<LaterInvoices reportId="r" rows={[nov]} canApprove deskStaff={desks} gates />);
    expect(screen.getByText(/데스크 환불 처리까지 끝나야 퇴원·수강종료를 처리합니다/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "2026-11 수강료 · 중2 수학 A 환불" }));
    fireEvent.click(screen.getByRole("button", { name: "환불 승인" }));
    expect(screen.getByText(/데스크가 환불을 처리\(환불완료일자 입력\)해야 퇴원·수강종료를 처리합니다/)).toBeInTheDocument();
    unmount();
    render(<LaterInvoices reportId="r" rows={[nov]} canApprove={false} deskStaff={[]} />);
    expect(screen.getByText("환불 승인은 원장만 할 수 있습니다.", { exact: false })).toBeInTheDocument();
  });
  it("이미 요청서가 있는 줄은 담당·완료와 링크 · 낸 돈이 없는 줄은 토글 없음", () => {
    render(<LaterInvoices reportId="r" deskStaff={desks} canApprove rows={[{ ...nov, lines: [
      { ...nov.lines[0], refund: { documentId: "doc", deskName: "데스크A", completed: true } },
      { ...nov.lines[1], paid: 0, paidNet: 0 },
      { ...nov.lines[1], key: `${id}#9`, billingRefund: true },
    ] }]} />);
    expect(screen.getByText("수납 환불 기록")).toBeInTheDocument();
    expect(screen.getByText("환불 완료 · 담당 데스크A · 요청서").closest("a")).toHaveAttribute("href", "/billing/refunds/doc");
    expect(screen.queryByRole("switch")).toBeNull();
  });
});
