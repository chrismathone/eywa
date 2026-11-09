import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ approve: vi.fn(), decline: vi.fn(), separate: vi.fn(), recheck: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/components/workspace/window-link", () => ({ WindowLink: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/features/withdrawal-reports/server/refund-actions", () => ({ approveWithdrawalRefund: mocks.approve, declineWithdrawalRefund: mocks.decline, recheckWithdrawalRefund: mocks.recheck }));
vi.mock("@/features/withdrawal-reports/server/refund-separate-actions", () => ({ separateWithdrawalRefundIncrease: mocks.separate }));
vi.mock("@/components/embed-link", () => ({ EmbedLink: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

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
      { ...nov.lines[0], refund: { documentId: "doc", deskName: "데스크A", completed: true, exact: true } },
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
    expect(screen.getByText("취소된 요청의 요청서(환불완료일자 없음 · 담당 데스크A — 돌려줬는지 확인한 뒤 다시 승인) · 다시 환불을 승인하면 이 요청서는 완료할 수 없습니다").closest("a")).toHaveAttribute("href", "/billing/refunds/old");
    a.unmount();
    // 다른 요청에서 환불 완료 · 진행 중인 다른 요청 — 그 줄은 고를 수 없다(결정은 '환불하지 않음'으로만) · 결정 전 표시는 그대로
    const all = [`${id}#0`, `${id}#1`];
    const b = render(<LaterInvoices reportId="r" deskStaff={desks} canApprove decisionOpen decision={{ undecided: all, declined: [] }}
      rows={[{ ...nov, lines: [{ ...nov.lines[0], otherRefund: other(false, true) }, { ...nov.lines[1], otherRefund: other(false, false) }] }]} />);
    expect(screen.queryByRole("switch")).toBeNull();
    // 그 요청서의 담당도 함께(옛 데스크에게 확인할 수 있게 · 리뷰 r2 m9)
    expect(screen.getByText("다른 요청에서 환불 완료 · 담당 데스크A · 요청서")).toBeInTheDocument();
    expect(screen.getByText("다른 요청의 요청서(데스크 환불 대기 · 담당 데스크A) · 요청서")).toBeInTheDocument();
    expect(screen.getAllByText("결정 전")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "환불 없음" })).toBeInTheDocument();
    // '환불 없음' 확인은 다른 요청에서 이미 환불을 마친 줄도 이 요청에선 '환불하지 않음'으로 남는다고 말한다(리뷰 r2 m10)
    fireEvent.click(screen.getByRole("button", { name: "환불 없음" }));
    expect(screen.getByRole("alertdialog", { name: "환불 없음 확인" })).toHaveTextContent("다른 요청에서 이미 환불을 마친 1건도 이 요청에선 '환불하지 않음'으로 남습니다(다시 돌려주지 않습니다).");
    b.unmount();
    // 원장이 아니어도 같은 참고 표시
    render(<LaterInvoices reportId="r" deskStaff={[]} canApprove={false} rows={[{ ...nov, lines: [{ ...nov.lines[0], otherRefund: other(true, false) }] }]} />);
    expect(screen.getByText("취소된 요청의 요청서(환불완료일자 없음 · 담당 데스크A — 돌려줬는지 확인한 뒤 다시 승인) · 다시 환불을 승인하면 이 요청서는 완료할 수 없습니다")).toBeInTheDocument();
  });
});

describe("리뷰 r2 — 청구 칸 상태(I3) · 미배분·부분 환불 표시(m11) · 데스크 직급(m15) · 결정 자리 앵커(m8)", () => {
  it("🔴 퇴원월 뒤 청구를 못 읽었거나 수납 열람권이 없으면 '없음'이라고 말하지 않는다", () => {
    const a = render(<LaterInvoices reportId="r" rows={[]} canApprove deskStaff={desks} laterState="failed" />);
    expect(screen.getByRole("alert")).toHaveTextContent("퇴원월 뒤 청구를 불러오지 못했습니다(새로고침).");
    expect(screen.queryByText(/환불할 건이 없습니다/)).toBeNull();
    a.unmount();
    const b = render(<LaterInvoices reportId="r" rows={[]} canApprove={false} deskStaff={[]} laterState="hidden" />);
    expect(screen.getByText("수납 권한이 없어 청구는 보이지 않습니다.")).toBeInTheDocument();
    expect(screen.queryByText(/환불할 건이 없습니다/)).toBeNull();
    b.unmount();
    // 읽었는데 비었으면 종전대로
    const c = render(<LaterInvoices reportId="r" rows={[]} canApprove deskStaff={desks} laterState="ok" />);
    expect(screen.getByText("퇴원월 뒤 청구 없음 — 환불할 건이 없습니다.")).toBeInTheDocument();
    expect(screen.getByLabelText("환불 확인")).toHaveAttribute("id", "refund");
    c.unmount();
    // 청구 120건 상한(리뷰 r3 R2-m10) — '새로고침'이 아니라 수납 정리 안내
    const d = render(<LaterInvoices reportId="r" rows={[]} canApprove deskStaff={desks} laterState="limit" />);
    expect(screen.getByRole("alert")).toHaveTextContent("퇴원월 뒤 청구가 너무 많아(120건 이상) 환불할 수 있는 청구를 다 확인하지 못했습니다 — 수납에서 청구를 정리한 뒤 다시 열어 주세요.");
    expect(screen.getByRole("alert").textContent).not.toMatch(/새로고침/);
    d.unmount();
    render(<LaterInvoices reportId="r" rows={[nov]} canApprove deskStaff={desks} />);
    expect(screen.getByLabelText("환불 확인")).toHaveAttribute("id", "refund");
  });
  it("미배분 납부 줄은 청구액 '—'(청구된 항목이 아니다) · 부분 환불 줄은 남은 낸 돈과 그 내역", () => {
    const rows = [{ ...nov, status: "unpaid", lines: [
      { kind: "미배분", description: "미배분 납부(줄별 납부 기록 없음)", amount: 100000, paid: 100000, key: `${id}#unalloc`, paidNet: 100000, billingRefund: false, refund: null, unallocated: true as const },
      { ...nov.lines[0], paidNet: 265000, billingRefundAmount: 50000 },
    ] }];
    render(<LaterInvoices reportId="r" rows={rows} canApprove={false} deskStaff={[]} />);
    const unalloc = screen.getByText(/미배분 납부/).closest("tr")!;
    expect(unalloc.querySelectorAll("td")[1]!.textContent).toBe("—");
    expect(screen.getByText("265,000원").closest("td")).toHaveTextContent("265,000원 (낸 돈 315,000원 · 환불 50,000원)");
  });
  it("데스크 고르기 목록은 직급 이름(목록·결재란과 같은 표기)", () => {
    render(<LaterInvoices reportId="r" rows={[nov]} canApprove deskStaff={[{ ...desks[0]!, jobTitle: "대리" }]} />);
    fireEvent.click(screen.getByRole("switch", { name: "2026-11 수강료 · 중2 수학 A 환불" }));
    fireEvent.click(screen.getByRole("button", { name: "환불 승인" }));
    expect(screen.getByRole("option", { name: "데스크A 대리" })).toBeInTheDocument();
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
    expect(screen.getByRole("alertdialog", { name: "환불 없음 확인" })).toHaveTextContent("이 보고서에서 정할 2건을 모두 환불하지 않음으로 기록합니다");
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
  it("🔴 낸 돈이 있는 무효(void) 청구 — 상태 칸 '무효 청구'(미납으로 적지 않음) · 낸 돈 줄은 토글·'결정 전'(리뷰 r2 (c))", () => {
    const june = { id, period: "2026-06", category: "tuition", status: "void", amountBilled: 725750, amountPaid: 725750, partial: false, lines: [
      { kind: "수업", description: "가반", amount: 327000, key: `${id}#0`, paidNet: 0, billingRefund: false, refund: null },
      { kind: "미배분", description: "미배분 납부(줄별 납부 기록 없음)", amount: 725750, paid: 725750, key: `${id}#unalloc`, paidNet: 725750, billingRefund: false, refund: null, unallocated: true as const },
      { kind: "교재", description: "교재", amount: 20000, paid: 20000, key: `${id}#1`, paidNet: 20000, billingRefund: false, refund: null },
    ] };
    render(<LaterInvoices reportId="r" rows={[june]} canApprove deskStaff={desks} gates decisionOpen decision={{ undecided: [`${id}#unalloc`, `${id}#1`], declined: [] }} />);
    expect(screen.getByText("무효 청구")).toBeInTheDocument();
    expect(screen.getByText("무효 청구 · 줄별 납부 기록 없음")).toBeInTheDocument();
    expect(screen.getByText("무효 청구 · 낸 돈 있음")).toBeInTheDocument();
    expect(screen.queryByText("미납")).toBeNull();
    expect(screen.getAllByRole("switch")).toHaveLength(2);
    expect(screen.getAllByText("결정 전")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "환불 없음" })).toBeInTheDocument();
    // 재발행 청구가 없으면 경고 없음 · 있으면 경고(결정은 열어 둔다 — 토글 그대로)
    expect(screen.queryByText(/같은 달 재발행 청구가 있습니다/)).toBeNull();
    cleanup();
    render(<LaterInvoices reportId="r" rows={[{ ...june, reissued: true as const }]} canApprove deskStaff={desks} gates decisionOpen decision={{ undecided: [`${id}#unalloc`, `${id}#1`], declined: [] }} />);
    expect(screen.getAllByText("같은 달 재발행 청구가 있습니다 — 낸 돈이 옮겨졌는지 수납에서 확인")).toHaveLength(1);   // 청구마다 한 번(첫 줄)
    expect(screen.getAllByRole("switch")).toHaveLength(2);
  });
  it("🔴 금액 모름 미배분 줄(과목 몫을 셀 수 없음 · 리뷰 r2 I5) — 토글 없음 · '결정 전' · 환불 없음으로만", () => {
    const dec = { id, period: "2026-12", category: "tuition", status: "partial", amountBilled: 0, amountPaid: 50000, partial: true, lines: [
      { kind: "미배분", description: "미배분 납부(줄별 납부 기록 없음)", amount: 50000, paid: 50000, key: `${id}#unalloc:math`, paidNet: 50000, billingRefund: false, refund: null,
        unallocated: true as const, unallocTotal: 50000, unallocScope: "math", amountUnknown: true as const },
    ] };
    render(<LaterInvoices reportId="r" rows={[dec]} canApprove deskStaff={desks} gates decisionOpen decision={{ undecided: [`${id}#unalloc:math`], declined: [] }} subjectLabels={{ math: "수학" }} />);
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByText("결정 전")).toBeInTheDocument();
    expect(screen.getByText(/수학 몫 · 몫을 계산할 수 없음\(환불하지 않음만\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "환불 없음" })).toBeInTheDocument();
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

describe("리뷰 r3 — 늘어난 몫 따로 환불(원장 결정 2026-11-09) · 뺄 몫(R2-I2) · 환불 칸 안 안내(R2-I1) · 결정 기록 조회 실패(R2-m10) · 미배분 표시(R2-m11)", () => {
  const DOC = "33333333-3333-3333-3333-333333333333";
  const done = (paidNet: number) => ({ ...nov, lines: [{ ...nov.lines[0]!, paidNet, refund: { documentId: DOC, deskName: "데스크A", completed: true, exact: true } }, nov.lines[1]!] });
  const claim = { key: `${id}#0`, reason: "increase" as const, before: 315000, now: 365000, documentId: DOC, separable: true };
  it("🔴 환불을 마친 줄에 낸 돈이 늘면 — 늘어난 금액 · '환불하지 않음 — 늘어난 몫은 수납에서 따로 처리' → 확인 → 그 줄만 보냄(첫 요청서는 그대로)", async () => {
    mocks.separate.mockResolvedValue({ ok: true, processed: false, undecided: 1, amount: 50000, notified: true });
    render(<LaterInvoices reportId="r" rows={[done(365000)]} canApprove deskStaff={desks} gates decisionOpen decision={{ undecided: [`${id}#0`, `${id}#1`], declined: [], openClaims: [claim] }} />);
    expect(screen.getByText(/환불을 마친 뒤 낸 돈이 늘었습니다\(315,000원 → 365,000원 · \+50,000원\) — 이 요청서는 그대로 두고, 늘어난 50,000원은 수납에서 따로 환불하거나 '환불 없음'으로 정하세요/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/비우|지우고 다시/);
    fireEvent.click(screen.getByRole("button", { name: "환불하지 않음 — 늘어난 몫은 수납에서 따로 처리" }));
    expect(screen.getByRole("alertdialog", { name: "늘어난 몫 따로 환불 확인" })).toHaveTextContent("늘어난 50,000원은 수납에서 일반 환불 요청서로 따로 환불합니다");
    fireEvent.click(screen.getByRole("button", { name: "따로 환불 확인" }));
    await waitFor(() => expect(mocks.separate).toHaveBeenCalledWith("r", `${id}#0`));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    // '환불 없음' 확인 칸은 늘어난 몫도 환불하지 않음으로 남는다고 말한다(따로 환불은 그 줄의 단추)
    await waitFor(() => expect(screen.getByRole("button", { name: "환불 없음" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "환불 없음" }));
    expect(screen.getByRole("alertdialog", { name: "환불 없음 확인" })).toHaveTextContent("환불을 마친 줄의 늘어난 몫 50,000원도 환불하지 않음으로 남습니다");
  });
  it("환불 전 요청서 · 처리 끝난 보고서 · 원장 아님 — 따로 환불 단추 없음(환불 전이면 지우고 다시 승인 안내 · 끝났으면 수납 확인)", () => {
    const a = render(<LaterInvoices reportId="r" rows={[{ ...done(365000), lines: [{ ...done(365000).lines[0]!, refund: { documentId: DOC, deskName: null, completed: false, exact: true } }] }]} canApprove deskStaff={desks} decisionOpen decision={{ undecided: [`${id}#0`], declined: [], openClaims: [{ ...claim, separable: false }] }} />);
    expect(screen.queryByRole("button", { name: /따로 처리/ })).toBeNull();
    // 완료일자가 없을 뿐 이미 돌려줬을 수 있다 — '환불 전'이라 단정하지 않는다(리뷰 r3 R3-m1)
    expect(screen.getByText(/이 요청서는 완료일자가 없을 뿐 이미 돌려줬을 수 있습니다\. 수납에서 확인한 뒤, 돌려주지 않았으면 요청서를 지우고 다시 환불 승인/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/환불 전\)/);
    a.unmount();
    const b = render(<LaterInvoices reportId="r" rows={[done(365000)]} canApprove deskStaff={desks} decisionOpen={false} decision={{ undecided: [], declined: [], openClaims: [claim] }} />);
    expect(screen.queryByRole("button", { name: /따로 처리/ })).toBeNull();
    expect(screen.getByText(/늘어난 몫은 수납에서 따로 확인하세요/)).toBeInTheDocument();
    b.unmount();
    render(<LaterInvoices reportId="r" rows={[done(365000)]} canApprove={false} deskStaff={[]} decisionOpen decision={{ undecided: [`${id}#0`], declined: [], openClaims: [claim] }} />);
    expect(screen.queryByRole("button", { name: /따로 처리/ })).toBeNull();
  });
  it("따로 환불하기로 정한 줄 — 데스크가 상세에서 알 수 있게 금액·날짜·결정자", () => {
    render(<LaterInvoices reportId="r" rows={[done(365000)]} canApprove={false} deskStaff={[]} decision={{ undecided: [], declined: [], deductions: [{ key: `${id}#0`, refunded: 315000, separate: 50000, separateAt: "2026-11-09T01:00:00Z", separateBy: "b", byName: "가원장 원장" }] }} />);
    expect(screen.getByText("늘어난 몫 50,000원은 수납에서 따로 환불하기로 정함 · 2026-11-09 · 가원장 원장 — 일반 환불 요청서로 처리합니다")).toBeInTheDocument();
    expect(screen.queryByText(/이전 환불 완료 기록/)).toBeNull();   // 요청서가 살아 있는 줄은 그 요청서가 곧 환불 기록
  });
  it("🔴 요청서가 지워진 줄을 다시 정할 때 — '이전 환불 완료 기록 · 따로 환불'을 보이고 빼고 요청 · 남은 돈이 없으면 토글 없음", async () => {
    mocks.approve.mockResolvedValue({ ok: true, documentId: "d", gates: true, undecided: 0 });
    const ded = { key: `${id}#0`, refunded: 315000, separate: 0, separateAt: null, separateBy: null };
    const { unmount } = render(<LaterInvoices reportId="r" rows={[{ ...nov, lines: [{ ...nov.lines[0]!, paidNet: 365000 }] }]} canApprove deskStaff={desks} gates decisionOpen decision={{ undecided: [`${id}#0`], declined: [], deductions: [ded] }} />);
    expect(screen.getByText("이전 환불 완료 기록 315,000원 — 다시 승인하면 빼고 50,000원만 요청합니다")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByText("선택 1건 · 환불 50,000원")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "환불 승인" }));
    expect(screen.getByRole("alertdialog", { name: "환불 승인 확인" })).toHaveTextContent("(낸 돈 365,000원 − 이전 환불·따로 환불 315,000원)");
    unmount();
    render(<LaterInvoices reportId="r" rows={[{ ...nov, lines: [{ ...nov.lines[0]!, paidNet: 315000 }] }]} canApprove deskStaff={desks} gates decisionOpen decision={{ undecided: [`${id}#0`], declined: [], deductions: [ded] }} />);
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByText("이전 환불 완료 기록 315,000원 — 다시 승인하면 빼고 돌려줄 남은 돈이 없습니다(환불하지 않음만)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "환불 없음" })).toBeInTheDocument();
  });
  it("🔴 결정 기록·대기 표시를 못 읽으면 — '불러오지 못함' · 결정 단추·토글 없음(이미 정한 줄을 다시 정하지 않게)", () => {
    const { unmount } = render(<LaterInvoices reportId="r" rows={[nov]} canApprove deskStaff={desks} decisionOpen decision={{ undecided: [], declined: [], failed: true, decisionsFailed: true }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("환불 결정 기록을 불러오지 못했습니다(새로고침)");
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("button", { name: "환불 없음" })).toBeNull();
    expect(screen.getAllByText("결정 기록 확인 못 함")).toHaveLength(2);
    unmount();
    // 결정 대기 표시만 못 읽음 — 줄 표시는 그대로(결정 기록은 읽었다) · 단추는 막는다
    render(<LaterInvoices reportId="r" rows={[nov]} canApprove deskStaff={desks} decisionOpen decision={{ undecided: [`${id}#0`], declined: [`${id}#1`], failed: true }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("환불 결정 대기 표시를 불러오지 못했습니다(새로고침) — 결정 단추를 막았습니다.");
    expect(screen.getByText("결정 전")).toBeInTheDocument();
    expect(screen.getByText("환불 안 함(원장 결정)")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("button", { name: "환불 없음" })).toBeNull();
  });
  it("🔴 목록 표시와 다를 때의 안내·'지금 다시 판정'이 '환불 확인' 칸 안에(목록 링크가 떨어지는 자리 · R2-I1) — 청구가 없어도", () => {
    const notes = [{ key: "gap", tone: "note" as const, place: "refund" as const, text: "목록 표시와 다릅니다 — 정할 건이 없습니다.", recheck: true }];
    render(<LaterInvoices reportId="r" rows={[]} canApprove deskStaff={desks} decisionOpen decision={{ undecided: [], declined: [], notes }} />);
    const box = screen.getByLabelText("환불 확인");
    expect(box).toHaveAttribute("id", "refund");
    expect(box).toHaveTextContent("목록 표시와 다릅니다 — 정할 건이 없습니다.");
    expect(box.querySelector("button")).toHaveTextContent("지금 다시 판정");
  });
  it("미배분이 있는 청구의 0원 줄은 '미납'이 아니라 '줄별 납부 기록 없음' · 금액 모름 줄 납부 칸 '—' + 청구 전체 미배분액(참고)", () => {
    const rows = [{ ...nov, status: "partial", lines: [
      { ...nov.lines[0]!, paidNet: 0, paid: 0 },
      { kind: "미배분", description: "미배분 납부(줄별 납부 기록 없음)", amount: 300000, paid: 300000, key: `${id}#unalloc:math`, paidNet: 300000, billingRefund: false, refund: null,
        unallocated: true as const, unallocTotal: 300000, unallocScope: "math", amountUnknown: true as const },
    ] }];
    render(<LaterInvoices reportId="r" rows={rows} canApprove={false} deskStaff={[]} subjectLabels={{ math: "수학" }} />);
    expect(screen.queryByText("미납")).toBeNull();
    const first = screen.getByText("2026-11 수강료 · 중등E_중2 심화 Jane").closest("tr")!;
    expect(first.querySelectorAll("td")[3]!.textContent).toBe("줄별 납부 기록 없음");
    const unalloc = screen.getByText(/미배분 납부/).closest("tr")!;
    expect(unalloc.querySelectorAll("td")[2]!.textContent).toBe("—");
    expect(unalloc.textContent).toContain("청구 전체 미배분 300,000원(참고)");
  });
});

describe("리뷰 r3 R3-I1 — 늘어난 몫 줄이 정해지지 않았으면 다른 줄의 환불 승인을 막는다", () => {
  const DOC = "33333333-3333-3333-3333-333333333333";
  const rows = [{ ...nov, lines: [{ ...nov.lines[0]!, paidNet: 365000, refund: { documentId: DOC, deskName: "데스크A", completed: true, exact: true } }, nov.lines[1]!] }];
  const claim = { key: `${id}#0`, reason: "increase" as const, before: 315000, now: 365000, documentId: DOC, separable: true };
  it("🔴 처리 전 — 단추 옆·확인 칸에 이유 · 확인 칸의 '환불 승인' 막힘 · 줄은 '따로 처리' 또는 '환불 없음'으로 정한다", () => {
    render(<LaterInvoices reportId="r" rows={rows} canApprove deskStaff={desks} gates decisionOpen decision={{ undecided: [`${id}#0`, `${id}#1`], declined: [], openClaims: [claim] }} />);
    fireEvent.click(screen.getByRole("switch", { name: "2026-11 수강료 · 중2 수학 A 환불" }));
    expect(screen.getByRole("note")).toHaveTextContent("늘어난 몫 50,000원 줄을 먼저 정하세요 — 따로 처리 또는 환불 없음");
    fireEvent.click(screen.getByRole("button", { name: "환불 승인" }));
    const dialog = screen.getByRole("alertdialog", { name: "환불 승인 확인" });
    expect(dialog).toHaveTextContent("늘어난 몫 50,000원 줄을 먼저 정하세요 — 따로 처리 또는 환불 없음");
    fireEvent.change(screen.getByRole("combobox", { name: "데스크 담당자" }), { target: { value: desks[0].id } });
    expect(screen.getAllByRole("button", { name: "환불 승인" }).at(-1)).toBeDisabled();
  });
  it("처리가 끝난 보고서 — 막지 않고(정할 길이 없다) 확인 칸이 그 몫이 환불하지 않음으로 남는다고 말한다 · 늘어난 몫이 없으면 종전대로", () => {
    const a = render(<LaterInvoices reportId="r" rows={rows} canApprove deskStaff={desks} decisionOpen={false} decision={{ undecided: [], declined: [], openClaims: [claim] }} />);
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "환불 승인" }));
    expect(screen.getByRole("alertdialog", { name: "환불 승인 확인" })).toHaveTextContent("결정 뒤 늘어난 몫 50,000원은 이 승인으로 환불하지 않음으로 남습니다(수납에서 따로 확인)");
    fireEvent.change(screen.getByRole("combobox", { name: "데스크 담당자" }), { target: { value: desks[0].id } });
    expect(screen.getAllByRole("button", { name: "환불 승인" }).at(-1)).not.toBeDisabled();
    a.unmount();
    render(<LaterInvoices reportId="r" rows={[nov]} canApprove deskStaff={desks} gates decisionOpen decision={{ undecided: [`${id}#0`, `${id}#1`], declined: [] }} />);
    fireEvent.click(screen.getByRole("switch", { name: "2026-11 수강료 · 중2 수학 A 환불" }));
    expect(screen.queryByText(/늘어난 몫/)).toBeNull();
  });
  it("따로 처리 뒤 알림을 못 보냈으면 사실대로(리뷰 r3 R3-m2) · 확인 칸도 '알림이 갑니다'라고 단정하지 않는다", async () => {
    mocks.separate.mockResolvedValue({ ok: true, processed: false, undecided: 1, amount: 50000, notified: false });
    const { toast } = await import("sonner");
    render(<LaterInvoices reportId="r" rows={rows} canApprove deskStaff={desks} gates decisionOpen decision={{ undecided: [`${id}#0`, `${id}#1`], declined: [], openClaims: [claim] }} />);
    fireEvent.click(screen.getByRole("button", { name: "환불하지 않음 — 늘어난 몫은 수납에서 따로 처리" }));
    expect(screen.getByRole("alertdialog", { name: "늘어난 몫 따로 환불 확인" })).toHaveTextContent("담당 데스크에게 알림을 보냅니다(담당이 퇴사했거나 없으면 보내지 못하고 결과에 알립니다)");
    fireEvent.click(screen.getByRole("button", { name: "따로 환불 확인" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("담당 데스크에게 알리지 못했습니다(퇴사·지정 없음 등). 수납 담당에게 직접 알려 주세요.")));
  });
});
