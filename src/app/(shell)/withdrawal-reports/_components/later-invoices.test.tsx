import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ approve: vi.fn(), decline: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/components/workspace/window-link", () => ({ WindowLink: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/features/withdrawal-reports/server/refund-actions", () => ({ approveWithdrawalRefund: mocks.approve, declineWithdrawalRefund: mocks.decline }));

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
    // 고르지 않은 환불 가능 줄도 함께 보낸다 — 같은 동작에서 '환불하지 않음'으로 남는다(원장 2026-11-06 · 서버가 지금 줄과 같은지 대조).
    await waitFor(() => expect(mocks.approve).toHaveBeenCalledWith("r", [`${id}#0`], desks[0].id, [`${id}#1`]));
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
  it("다른 요청(묶음)의 요청서가 담은 줄(팀장 결정 2026-11-06) — 참고 링크 · 다시 고를 수 있는 건 취소된 요청의 환불 전 요청서뿐", () => {
    const other = (canceled: boolean, completed: boolean) => ({ documentId: "old", deskName: "데스크A", canceled, completed });
    // 취소된 요청의 환불 전 요청서 — 다시 고를 수 있다
    const a = render(<LaterInvoices reportId="r" deskStaff={desks} canApprove rows={[{ ...nov, lines: [{ ...nov.lines[0], otherRefund: other(true, false) }, nov.lines[1]] }]} />);
    expect(screen.getAllByRole("switch")).toHaveLength(2);
    expect(screen.getByText("취소된 요청의 요청서(환불 전) · 다시 환불을 승인하면 이 요청서는 완료할 수 없습니다").closest("a")).toHaveAttribute("href", "/billing/refunds/old");
    a.unmount();
    // 다른 요청에서 환불 완료 · 진행 중인 다른 요청 — 그 줄은 고를 수 없다(결정은 '환불하지 않음'으로만) · 결정 전 표시는 그대로
    const all = [`${id}#0`, `${id}#1`];
    const b = render(<LaterInvoices reportId="r" deskStaff={desks} canApprove decisionOpen decision={{ undecided: all, declined: [] }}
      rows={[{ ...nov, lines: [{ ...nov.lines[0], otherRefund: other(false, true) }, { ...nov.lines[1], otherRefund: other(false, false) }] }]} />);
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByText("다른 요청에서 환불 완료 · 요청서")).toBeInTheDocument();
    expect(screen.getByText("다른 요청의 요청서(데스크 환불 대기) · 요청서")).toBeInTheDocument();
    expect(screen.getAllByText("결정 전")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "환불 없음" })).toBeInTheDocument();
    b.unmount();
    // 원장이 아니어도 같은 참고 표시
    render(<LaterInvoices reportId="r" deskStaff={[]} canApprove={false} rows={[{ ...nov, lines: [{ ...nov.lines[0], otherRefund: other(true, false) }] }]} />);
    expect(screen.getByText("취소된 요청의 요청서(환불 전) · 다시 환불을 승인하면 이 요청서는 완료할 수 없습니다")).toBeInTheDocument();
  });
});

describe("원장 환불 결정(원장 2026-11-06) — 처리 전 보고서의 결정 안 된 줄", () => {
  const all = [`${id}#0`, `${id}#1`];
  it("원장: 줄마다 '결정 전' · 고른 게 없으면 '환불 없음' → 확인 → 이 화면의 환불 가능 줄 전부를 보냄", async () => {
    mocks.decline.mockResolvedValue({ ok: true, processed: true, undecided: 0 });
    render(<LaterInvoices reportId="r" rows={[nov]} canApprove deskStaff={desks} gates decisionOpen decision={{ undecided: all, declined: [] }} />);
    expect(screen.getAllByText("결정 전")).toHaveLength(2);
    expect(screen.getByText(/환불할 건이 없으면 '환불 없음'을 누르세요. 원장이 정하기 전에는 퇴원·수강종료를 처리하지 않습니다/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "환불 없음" }));
    expect(screen.getByRole("alertdialog", { name: "환불 없음 확인" })).toHaveTextContent("환불할 수 있는 2건을 모두 환불하지 않음으로 기록합니다");
    fireEvent.click(screen.getByRole("button", { name: "환불 없음 확인" }));
    await waitFor(() => expect(mocks.decline).toHaveBeenCalledWith("r", all));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });
  it("줄을 고르면 '환불 없음' 대신 '환불 승인' — 확인 칸에 '고르지 않은 N건은 환불하지 않음으로 기록됩니다'", () => {
    render(<LaterInvoices reportId="r" rows={[nov]} canApprove deskStaff={desks} gates decisionOpen decision={{ undecided: all, declined: [] }} />);
    fireEvent.click(screen.getByRole("switch", { name: "2026-11 수강료 · 중2 수학 A 환불" }));
    expect(screen.queryByRole("button", { name: "환불 없음" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "환불 승인" }));
    expect(screen.getByRole("alertdialog", { name: "환불 승인 확인" })).toHaveTextContent("고르지 않은 1건은 환불하지 않음으로 기록됩니다");
  });
  it("'환불하지 않음'으로 정한 줄 표시 · 결정 안 된 줄이 없거나 처리가 끝난 보고서면 '환불 없음'이 없다", () => {
    const { unmount } = render(<LaterInvoices reportId="r" rows={[nov]} canApprove deskStaff={desks} decisionOpen decision={{ undecided: [], declined: all }} />);
    expect(screen.getAllByText("환불 안 함(원장 결정)")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "환불 없음" })).toBeNull();
    unmount();
    render(<LaterInvoices reportId="r" rows={[nov]} canApprove deskStaff={desks} decisionOpen={false} decision={{ undecided: all, declined: [] }} />);
    expect(screen.queryByText("결정 전")).toBeNull();
    expect(screen.queryByRole("button", { name: "환불 없음" })).toBeNull();
  });
  it("원장이 아니면 줄마다 '원장 결정 전'만(단추 없음)", () => {
    render(<LaterInvoices reportId="r" rows={[nov]} canApprove={false} deskStaff={[]} decisionOpen decision={{ undecided: [`${id}#0`], declined: [`${id}#1`] }} />);
    expect(screen.getByText("원장 결정 전")).toBeInTheDocument();
    expect(screen.getByText("환불 안 함(원장 결정)")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("🔴 학원 설정에 데스크 담당자가 없으면 — 안내만 · 담당자 고르기 없음 · 환불 승인 막힘", () => {
    render(<LaterInvoices reportId="r" rows={[nov]} canApprove deskStaff={[]} decisionOpen decision={{ undecided: all, declined: [] }} deskNotice="학원 설정에서 데스크 담당자를 먼저 지정해 주세요" />);
    fireEvent.click(screen.getByRole("switch", { name: "2026-11 수강료 · 중2 수학 A 환불" }));
    fireEvent.click(screen.getByRole("button", { name: "환불 승인" }));
    expect(screen.getByRole("alert")).toHaveTextContent("학원 설정에서 데스크 담당자를 먼저 지정해 주세요");
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("button", { name: "환불 승인" })).toBeDisabled();
  });
});
