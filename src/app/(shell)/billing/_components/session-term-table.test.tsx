import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { RecordSavedMessage } from "@/lib/realtime/record-channel";
import { SessionTermGroups as Table, type ClassGroup } from "./session-term-table";
import { SessionTermsState, SessionTermsConfirmedCount } from "./session-terms-state";
import { confirmSessionTerm, unconfirmSessionTerm, confirmClassTerms } from "@/features/billing/session-terms/server/actions";
import type { SessionTermActionState } from "@/features/billing/session-terms/server/actions";
import { DEFAULT_SESSION_PRICES } from "@/features/billing/session-pricing";
import { updateMonthlyTermSessions } from "@/features/billing/session-terms/server/monthly-sessions";
import { updateSessionTermNote } from "@/features/billing/session-terms/server/note-actions";
import { confirmSelectedTerms } from "@/features/billing/session-terms/server/selected-confirm-actions";
import { unconfirmClassTerms } from "@/features/billing/session-terms/server/class-unconfirm-actions";
import { deleteSessionTerm, getSessionTermDeletePreview } from "@/features/billing/session-terms/server/delete-actions";
import { publishRecordSaved } from "@/lib/realtime/record-channel";
import { NO_LESSON_LABEL, TERM_STATE_LABEL } from "@/features/billing/session-terms/month-roster";

const h = vi.hoisted(() => ({ refresh: vi.fn(), saved: null as null | ((message: RecordSavedMessage) => void) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("@/lib/realtime/record-channel", () => ({
  publishRecordSaved: vi.fn(),
  subscribeRecordSaved: (callback: (message: RecordSavedMessage) => void) => { h.saved = callback; return () => { h.saved = null; }; },
}));
vi.mock("@/features/billing/session-terms/server/actions", () => ({
  confirmSessionTerm: vi.fn(), unconfirmSessionTerm: vi.fn(), confirmClassTerms: vi.fn(), refreshPlannedTerms: vi.fn(),
}));
vi.mock("@/features/billing/session-terms/server/monthly-sessions", () => ({ updateMonthlyTermSessions: vi.fn() }));
vi.mock("@/features/billing/session-terms/server/note-actions", () => ({ updateSessionTermNote: vi.fn() }));
vi.mock("@/features/billing/session-terms/server/selected-confirm-actions", () => ({ confirmSelectedTerms: vi.fn() }));
vi.mock("@/features/billing/session-terms/server/class-unconfirm-actions", () => ({ unconfirmClassTerms: vi.fn() }));
vi.mock("@/features/billing/session-terms/server/delete-actions", () => ({ deleteSessionTerm: vi.fn(), getSessionTermDeletePreview: vi.fn() }));
vi.mock("@/features/billing/session-terms/server/receipt-allocation-actions", () => ({ getReceiptAllocation: vi.fn(), saveReceiptAllocation: vi.fn() }));
vi.mock("@/components/ui/drag-scroll-area", () => ({ DragScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

const group = (subjectLabel: string, monthlyPrice: number | null = null): ClassGroup => ({
  classId: subjectLabel, className: `${subjectLabel}반`, subjectLabel,
  students: [{
    id: subjectLabel, invoiceId: "invoice", studentId: subjectLabel, studentName: `${subjectLabel}학생`, studentGrade: "중1",
    subject: subjectLabel === "수학" ? "math" : "english", subjectLabel,
    classId: subjectLabel, className: `${subjectLabel}반`, monthlyPrice, pricingMode: "per_session",
    plannedSessions: 9, confirmedSessions: null, unitPrice: null, amount: null, confirmedAt: null, note: null, classAmount: null, termState: "term",
  }],
});

// 기본은 쓰기 권한(종전 테스트 그대로) — 읽기 권한 화면은 아래 '읽기 권한' 묶음이 `canWrite={false}`로 따로 본다.
function SessionTermGroups({ canWrite = true, ...props }: Omit<React.ComponentProps<typeof Table>, "canWrite"> & { canWrite?: boolean }) {
  return <SessionTermsState rows={props.groups.flatMap((g) => g.students)}><div data-testid="confirmed-count"><SessionTermsConfirmedCount /></div><Table {...props} canWrite={canWrite} /></SessionTermsState>;
}

beforeEach(() => vi.clearAllMocks());

describe("읽기 권한(원장 2026-11-05 — 저장해야 거절되던 자리)", () => {
  it("미확정 반 — 일괄 입력·확정·선택·행 확정·삭제·메모 편집을 그리지 않고, 시수·단가 칸은 값만 보이게 잠근다", () => {
    render(<SessionTermGroups groups={[group("수학")]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" canWrite={false} />);
    expect(screen.queryByRole("button", { name: /일괄/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "확정" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /회차 삭제/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /메모/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("수학반 반 회차")).not.toBeInTheDocument();
    const sessions = screen.getByLabelText("수학학생 확정 회차");
    expect(sessions).toBeDisabled();
    expect(sessions).toHaveValue(9);
    expect(screen.getByLabelText("수학학생 회당 단가")).toBeDisabled();
    expect(screen.getByLabelText("수학학생 회당 단가")).toHaveAttribute("placeholder", "수납관리 작성 권한이 필요합니다");
  });

  it("확정된 줄 — 해제·배분·이월·월정액 시수 편집 없이 값만 보인다", () => {
    const g = group("EiE", 270000);
    g.students[0] = { ...g.students[0]!, confirmedSessions: 8, unitPrice: 270000, amount: 270000, pricingMode: "monthly", confirmedAt: "2026-09-01T00:00:00Z", note: "휴원 1회" };
    render(<SessionTermGroups groups={[g]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" canWrite={false} />);
    expect(screen.queryByRole("button", { name: /해제/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /배분/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /이월/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /월 정액 시수 수정/ })).not.toBeInTheDocument();
    expect(screen.getByText("휴원 1회")).toBeInTheDocument();
  });
});

describe("회차 삭제", () => {
  const preview = { updatedAt: "2026-09-22T01:02:03Z", confirmedSessions: 0, amount: 0, note: "종료반", blockedReason: null };
  async function openDeletion() {
    render(<SessionTermGroups groups={[group("수학")]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    fireEvent.click(screen.getByRole("button", { name: "수학학생 수학반 회차 삭제" }));
    const dialog = await screen.findByRole("dialog", { name: "회차 삭제" });
    await waitFor(() => expect(within(dialog).queryByRole("status")).not.toBeInTheDocument());
    return dialog;
  }

  it("최신 확정값과 메모·재생성 안내를 보여주고 취소하면 삭제하지 않는다", async () => {
    vi.mocked(getSessionTermDeletePreview).mockResolvedValueOnce({ preview });
    const dialog = await openDeletion();
    expect(dialog).toHaveTextContent("확정 0시수 · 0원");
    expect(dialog).toHaveTextContent("메모: 종료반");
    expect(dialog).toHaveTextContent("회차 없음");
    expect(getSessionTermDeletePreview).toHaveBeenCalledWith("수학", "2026-09");
    fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
    expect(deleteSessionTerm).not.toHaveBeenCalled();
  });

  it("배분·이월이 남으면 사유를 보여주고 삭제를 막는다", async () => {
    vi.mocked(getSessionTermDeletePreview).mockResolvedValueOnce({ preview: { ...preview, blockedReason: "수납 배분금이 남아 있습니다" } });
    const dialog = await openDeletion();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("수납 배분금이 남아 있습니다");
    expect(within(dialog).getByRole("button", { name: "회차 삭제" })).toBeDisabled();
  });

  it("삭제 중 재클릭을 차단하고 성공 후 목록과 다른 창을 갱신한다", async () => {
    vi.mocked(getSessionTermDeletePreview).mockResolvedValueOnce({ preview });
    let finish!: (value: { ok: true }) => void;
    vi.mocked(deleteSessionTerm).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const dialog = await openDeletion();
    const button = within(dialog).getByRole("button", { name: "회차 삭제" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(deleteSessionTerm).toHaveBeenCalledTimes(1);
    expect(deleteSessionTerm).toHaveBeenCalledWith("수학", "2026-09", preview.updatedAt);
    expect(within(dialog).getByRole("button", { name: "삭제 중…" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "취소" })).toBeDisabled();
    await act(async () => finish({ ok: true }));
    expect(h.refresh).toHaveBeenCalled();
    expect(publishRecordSaved).toHaveBeenCalledWith("billing:session-terms");
  });

  it("실패는 창 안에 남고 성공 신호나 목록 갱신을 보내지 않는다", async () => {
    vi.mocked(getSessionTermDeletePreview).mockResolvedValueOnce({ preview });
    vi.mocked(deleteSessionTerm).mockResolvedValueOnce({ error: "회차가 변경되었습니다" });
    const dialog = await openDeletion();
    fireEvent.click(within(dialog).getByRole("button", { name: "회차 삭제" }));
    await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("회차가 변경되었습니다"));
    expect(h.refresh).not.toHaveBeenCalled();
    expect(publishRecordSaved).not.toHaveBeenCalled();
  });

  it.each(["missing", "no_invoice", "void_invoice"] as const)("%s 가상 줄에는 삭제 버튼이 없다", (termState) => {
    const g = group("수학");
    Object.assign(g.students[0], { id: "v:student:class", termState });
    render(<SessionTermGroups groups={[g]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    expect(screen.queryByRole("button", { name: "수학학생 수학반 회차 삭제" })).not.toBeInTheDocument();
  });
});

describe("회차 단가 선택", () => {
  it("배분된 행도 해제 응답 직후 입력할 수 있고 재조회는 별도 작업으로 진행한다", async () => {
    vi.useFakeTimers();
    try {
      const g = group("수학");
      Object.assign(g.students[0], { confirmedSessions: 7, unitPrice: 21250, amount: 148750, allocatedAmount: 148750, invoiceHasAllocations: true });
      vi.mocked(unconfirmSessionTerm).mockResolvedValueOnce({ ok: true, terms: [{ id: "수학", confirmedSessions: null, unitPrice: null, amount: null, pricingMode: "per_session", confirmedAt: null }] });
      render(<SessionTermGroups groups={[g]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "해제" })));
      expect(screen.getByRole("button", { name: "확정" })).toBeEnabled();
      expect(screen.queryByText("배분 완료")).not.toBeInTheDocument();
      expect(h.refresh).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(200));
      expect(h.refresh).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it("미배분 필터에서 일괄 확정은 화면에 표시된 학생 ID만 보낸다", async () => {
    vi.mocked(confirmClassTerms).mockResolvedValueOnce({ confirmed: 1, terms: [] });
    render(<SessionTermGroups groups={[group("수학")]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" visibleOnly />);
    fireEvent.change(screen.getByLabelText("수학반 반 회차"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("수학반 회당 단가"), { target: { value: "24000" } });
    fireEvent.click(screen.getByRole("button", { name: "이 반 일괄 확정" }));
    await waitFor(() => expect(confirmClassTerms).toHaveBeenCalledWith("2026-09", "수학", 24000, 8, ["수학"]));
  });
  it("EiE 확정 시수만 수정해도 이전 월 금액을 유지한다", async () => {
    const g = group("EiE", 290000);
    Object.assign(g.students[0], { confirmedSessions: 39, unitPrice: 270000, amount: 270000, pricingMode: "monthly", confirmedAt: "2026-09-16" });
    vi.mocked(updateMonthlyTermSessions).mockResolvedValueOnce({ terms: [{ id: "EiE", confirmedSessions: 15.5, unitPrice: 270000, amount: 270000, pricingMode: "monthly", confirmedAt: "2026-09-17" }] });
    render(<SessionTermGroups groups={[g]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    fireEvent.click(screen.getByLabelText("EiE학생 월 정액 시수 수정"));
    fireEvent.change(screen.getByLabelText("EiE학생 월 정액 확정 시수"), { target: { value: "15.5" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(screen.getByLabelText("EiE학생 월 정액 시수 수정")).toHaveTextContent("15.5"));
    expect(updateMonthlyTermSessions).toHaveBeenCalledWith("EiE", 15.5, "2026-09-16");
    expect(screen.getAllByText("270,000원").length).toBeGreaterThan(0);
  });
  it("4.5시수 × 31,250원의 예상금액을 확정 전에 보여준다", () => {
    const g = group("수학"); g.students[0].plannedSessions = 4.5;
    render(<SessionTermGroups groups={[g]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    fireEvent.change(screen.getByLabelText("수학학생 회당 단가"), { target: { value: "31250" } });
    expect(screen.getByLabelText("수학학생 예상금액")).toHaveTextContent("140,625원");
    expect(screen.getByLabelText("수학학생 예상금액")).toHaveTextContent("4.5시수 × 31,250원");
    expect(screen.getByLabelText("수학학생 확정 회차")).toBeValid();
    expect(confirmSessionTerm).not.toHaveBeenCalled();
  });
  it("수학·영어의 반 일괄·개별 입력이 모두 13개짜리 한 목록을 쓴다", () => {
    const { container } = render(<SessionTermGroups groups={[group("수학"), group("영어")]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    const list = container.querySelector("datalist")!;
    expect(container.querySelectorAll("datalist")).toHaveLength(1);
    expect(list.querySelectorAll("option")).toHaveLength(13);
    const inputs = container.querySelectorAll("input[list]");
    expect(inputs).toHaveLength(4);
    for (const input of inputs) expect(input.getAttribute("list")).toBe(list.id);
    expect(list.querySelector('option[value="270000"]')).toBeNull();
  });

  it("설정 저장 신호로 갱신하고 입력 중인 개인 단가는 보존한다", () => {
    const groups = [group("수학")];
    const { container, rerender } = render(<SessionTermGroups groups={groups} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    fireEvent.change(screen.getByLabelText("수학학생 회당 단가"), { target: { value: "24000" } });
    h.saved?.({ type: "saved", scope: "tenant-settings:profile", senderId: "other" });
    expect(h.refresh).not.toHaveBeenCalled();
    h.saved?.({ type: "saved", scope: "tenant-settings:billing", senderId: "other" });
    expect(h.refresh).toHaveBeenCalledOnce();
    rerender(<SessionTermGroups groups={groups} catalog={[{ price: 26000, label: "수정" }]} period="2026-09" />);
    expect(container.querySelectorAll("datalist option")).toHaveLength(1);
    expect(container.querySelector("datalist option")).toHaveAttribute("value", "26000");
    expect(screen.getByLabelText("수학학생 회당 단가")).toHaveValue("24000");
  });

  it("EiE는 회당 입력 대신 월 금액 확정 버튼을 제공한다", () => {
    render(<SessionTermGroups groups={[group("EiE", 270000)]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    expect(screen.getByText("EiE 월 270,000원")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "이 반 일괄 확정" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "확정" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "월 금액 확정" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "월 금액 일괄 확정" })).toBeInTheDocument();
    expect(screen.queryByLabelText("EiE학생 회당 단가")).not.toBeInTheDocument();
  });

  it("EiE 구분이 꺼진 지점에 남은 월정액 반만 반 머리에 경고한다", () => {
    const { rerender } = render(<SessionTermGroups groups={[group("EiE", 270000)]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" eieEnabled={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("이 반은 월정액으로 확정됩니다");

    rerender(<SessionTermGroups groups={[group("EiE", 270000)]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" eieEnabled />);
    expect(screen.queryByText("이 반은 월정액으로 확정됩니다")).not.toBeInTheDocument();

    rerender(<SessionTermGroups groups={[group("수학")]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" eieEnabled={false} />);
    expect(screen.queryByText("이 반은 월정액으로 확정됩니다")).not.toBeInTheDocument();
  });

  it("회차 없이 반 단가만 입력하면 미확정 입력칸과 예상금액만 바뀐다", () => {
    render(<SessionTermGroups groups={[group("수학")]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    fireEvent.change(screen.getByLabelText("수학학생 확정 회차"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("수학반 회당 단가"), { target: { value: "21,250" } });
    fireEvent.click(screen.getByRole("button", { name: "단가 일괄 입력" }));
    expect(screen.getByLabelText("수학학생 회당 단가")).toHaveValue("21250");
    expect(screen.getByLabelText("수학학생 확정 회차")).toHaveValue(7);
    expect(screen.getByLabelText("수학학생 예상금액")).toHaveTextContent("148,750원");
    expect(screen.getByLabelText("수학학생 예상금액")).toHaveTextContent("7시수 × 21,250원");
    expect(screen.getByTestId("confirmed-count")).toHaveTextContent("0");
    expect(confirmClassTerms).not.toHaveBeenCalled();
    expect(confirmSessionTerm).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("수학학생 확정 회차"), { target: { value: "8" } });
    expect(screen.getByLabelText("수학학생 예상금액")).toHaveTextContent("170,000원");
    fireEvent.change(screen.getByLabelText("수학학생 회당 단가"), { target: { value: "" } });
    expect(screen.queryByLabelText("수학학생 예상금액")).not.toBeInTheDocument();
  });

  it("해제 요청 중에는 중복 클릭을 막고 완료하면 목록 전체 조회 없이 해당 행과 확정 수를 바꾼다", async () => {
    const g = group("수학");
    Object.assign(g.students[0], { confirmedSessions: 7, unitPrice: 21250, amount: 148750 });
    let complete!: (value: SessionTermActionState) => void;
    vi.mocked(unconfirmSessionTerm).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    render(<SessionTermGroups groups={[g]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    fireEvent.click(screen.getByRole("button", { name: "해제" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "해제 중…" })).toBeDisabled());
    expect(vi.mocked(unconfirmSessionTerm).mock.calls[0][1].get("id")).toBe("수학");
    await act(async () => complete({ ok: true, terms: [{ id: "수학", confirmedSessions: null, unitPrice: null, amount: null, pricingMode: "per_session", confirmedAt: null }] }));
    expect(screen.getByRole("button", { name: "확정" })).toBeEnabled();
    expect(screen.getByTestId("confirmed-count")).toHaveTextContent("0");
    expect(screen.getByLabelText("수학학생 예상금액")).toHaveTextContent("148,750원");
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("해제 실패는 기존 확정값을 유지하고 오류를 표시한다", async () => {
    const g = group("수학");
    Object.assign(g.students[0], { confirmedSessions: 7, unitPrice: 21250, amount: 148750 });
    vi.mocked(unconfirmSessionTerm).mockResolvedValueOnce({ error: "저장 실패" });
    render(<SessionTermGroups groups={[g]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    fireEvent.click(screen.getByRole("button", { name: "해제" }));
    expect(await screen.findByText("저장 실패")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "해제" })).toBeEnabled();
    expect(screen.getByTestId("confirmed-count")).toHaveTextContent("1");
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("개별 확정은 서버가 저장한 금액으로 즉시 반영하고 재조회하지 않는다", async () => {
    vi.mocked(confirmSessionTerm).mockResolvedValueOnce({ ok: true, terms: [{ id: "수학", confirmedSessions: 9, unitPrice: 24000, amount: 216000, pricingMode: "per_session", confirmedAt: "2026-09-16" }] });
    render(<SessionTermGroups groups={[group("수학")]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    fireEvent.change(screen.getByLabelText("수학학생 회당 단가"), { target: { value: "24000" } });
    fireEvent.click(screen.getByRole("button", { name: "확정" }));
    // 확정값 반영(버튼이 '해제'로 바뀜)은 요청이 끝나기 직전에 먼저 그려진다 — 잠김이 풀릴 때까지 기다린다.
    await waitFor(() => expect(screen.getByRole("button", { name: "해제" })).toBeEnabled());
    expect(screen.getByTestId("confirmed-count")).toHaveTextContent("1");
    expect(screen.getByText("216,000원")).toBeInTheDocument();
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("단가 일괄 입력은 이미 확정한 학생의 금액을 바꾸지 않는다", () => {
    const g = group("수학");
    g.students.push({ ...g.students[0], id: "confirmed", studentName: "확정학생", confirmedSessions: 8, unitPrice: 25000, amount: 200000 });
    render(<SessionTermGroups groups={[g]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    fireEvent.change(screen.getByLabelText("수학반 회당 단가"), { target: { value: "24000" } });
    fireEvent.click(screen.getByRole("button", { name: "단가 일괄 입력" }));
    expect(screen.getByText("200,000원")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "해제" })).toBeEnabled();
    expect(screen.getByTestId("confirmed-count")).toHaveTextContent("1");
    expect(confirmClassTerms).not.toHaveBeenCalled();
  });

  it("회차를 명시한 반 일괄 확정은 저장 응답으로 반영한다", async () => {
    vi.mocked(confirmClassTerms).mockResolvedValueOnce({ confirmed: 1, terms: [{ id: "수학", confirmedSessions: 8, unitPrice: 24000, amount: 192000, pricingMode: "per_session", confirmedAt: "2026-09-16" }] });
    render(<SessionTermGroups groups={[group("수학")]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    fireEvent.change(screen.getByLabelText("수학반 반 회차"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("수학반 회당 단가"), { target: { value: "24000" } });
    fireEvent.click(screen.getByRole("button", { name: "이 반 일괄 확정" }));
    expect(await screen.findByRole("button", { name: "해제" })).toBeEnabled();
    expect(confirmClassTerms).toHaveBeenCalledWith("2026-09", "수학", 24000, 8);
    expect(screen.getByText("192,000원")).toBeInTheDocument();
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("EiE 예상금액은 계획 회차와 무관하게 월 금액이다", () => {
    render(<SessionTermGroups groups={[group("EiE", 270000)]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    expect(screen.getByLabelText("EiE학생 예상금액")).toHaveTextContent("270,000원");
    expect(screen.getByLabelText("EiE학생 예상금액")).toHaveTextContent("예상 · 월 정액");
  });
});

describe("한 행 = 한 줄 (원장 2026-09-16)", () => {
  const confirmedGroup = (patch: Partial<ClassGroup["students"][number]>) => {
    const g = group("수학");
    Object.assign(g.students[0], { confirmedSessions: 7, unitPrice: 21250, amount: 148750 }, patch);
    return g;
  };

  it("일수 기준 확정값은 붉은 숫자 + 마우스 오버 카드 — 칸 안에 문장 줄을 세우지 않는다", () => {
    const { container } = render(<SessionTermGroups groups={[confirmedGroup({ quantityBasis: "days" })]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    const mark = container.querySelector("span.text-danger[data-tip]");
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toContain("7");
    expect(mark!.getAttribute("data-tip")).toContain("해제한 뒤 시수를 확인해 다시 확정하세요");
    // 화면 낭독용 문구만 남고, 보이는 블록 줄(옛 `block text-xs`)은 없다.
    expect(mark!.querySelector(".sr-only")!.textContent).toContain("일수 기준 · 재확정 필요");
    expect(mark!.closest("td")!.querySelector(".block")).toBeNull();
  });

  it("시수 기준 확정값은 표시 없이 그대로", () => {
    const { container } = render(<SessionTermGroups groups={[confirmedGroup({ quantityBasis: "attendance_units", plannedSessions: 7 })]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    expect(container.querySelector("[data-tip]")).toBeNull();
    expect(container.textContent).not.toContain("재확정 필요");
  });

  it("실납 청구액은 금액 · 꼬리표 · 수납 연결을 한 줄에 — 배분 재확인은 꼬리표 자리에 앰버 + 카드", () => {
    const { container, rerender } = render(<SessionTermGroups groups={[confirmedGroup({ allocatedAmount: 148750 })]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    const cell = () => screen.getByRole("button", { name: "배분" }).closest("td")!;
    expect(cell().textContent).toBe("148,750원배분 완료배분");
    expect(cell().querySelector("div")!.className).toContain("inline-flex");
    rerender(<SessionTermGroups groups={[confirmedGroup({ classAmount: 148750 })]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    expect(cell().textContent).toBe("148,750원이름 매칭 참고배분");
    rerender(<SessionTermGroups groups={[confirmedGroup({ classAmount: 148750, allocationStale: true })]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    const stale = within(cell()).getByText("배분 재확인 필요");
    expect(stale.className).toContain("text-amber");
    expect(stale.getAttribute("data-tip")).toContain("‘배분’을 눌러 다시 배분하세요");
    expect(cell().textContent).not.toContain("이름 매칭 참고");
    expect(stale.getAttribute("data-tip")).toContain("이름 매칭 참고값");
    rerender(<SessionTermGroups groups={[confirmedGroup({ classAmount: null, allocationStale: true })]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    expect(within(cell()).getByText("배분 재확인 필요").getAttribute("data-tip")).not.toContain("이름 매칭 참고값");
    // 학생 행의 칸은 줄바꿈하지 않는다 — 폭은 표의 최소 폭이 보장한다.
    const row = cell().closest("tr")!;
    expect(row.className).toContain("[&>td]:whitespace-nowrap");
    expect(container.querySelector("table")!.className).toContain("min-w-[1640px]");
  });
});

describe("열 11개 — 선택·학교학년·담임·메모 (원장 2026-09-17)", () => {
  const withInfo = () => {
    const g = group("수학");
    Object.assign(g.students[0], { studentSchool: "칠성초", studentGrade: "초6", homeroomTeacherName: "이수진" });
    return g;
  };

  it("열 머리는 원장이 적은 순서 그대로이고 반 머리 줄이 열 전체를 덮는다", () => {
    const { container } = render(<SessionTermGroups groups={[withInfo()]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    const heads = [...container.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(heads).toEqual(["선택", "이름", "학교학년", "담임", "예정 시수", "확정 시수", "단가 및 수강료", "예상 및 확정 청구액", "실납 청구액", "메모(특이사항)", "기타"]);
    expect(container.querySelectorAll("colgroup col")).toHaveLength(11);
    // 반 머리 줄 = 선택 칸 1 + 나머지 10칸을 덮는 칸.
    const band = container.querySelector("tbody td[colspan]")!;
    expect(band.getAttribute("colspan")).toBe("10");
    expect(band.closest("tr")!.children).toHaveLength(2);
    // 학생 행도 같은 11칸.
    expect(screen.getByText("수학학생").closest("tr")!.children).toHaveLength(11);
    // 오른쪽 끝 '기타' 열은 고정(불투명 바탕) — 표가 창보다 넓어도 확정·해제 버튼이 보인다.
    expect(container.querySelector("thead th:last-child")!.className).toContain("sticky right-0");
    expect(screen.getByText("수학학생").closest("tr")!.lastElementChild!.className).toMatch(/sticky right-0 .*bg-card/);
  });

  it("이름 옆 칸에 학교·학년을 붙여(칠성초6) 쓰고 담임 이름을 싣는다 — 모르면 —", () => {
    const { rerender } = render(<SessionTermGroups groups={[withInfo()]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    const cells = () => [...screen.getByText("수학학생").closest("tr")!.children].map((td) => td.textContent);
    expect(cells().slice(1, 4)).toEqual(["수학학생", "칠성초6", "이수진"]);
    const g = group("수학");
    Object.assign(g.students[0], { studentGrade: null });
    rerender(<SessionTermGroups groups={[g]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    expect(cells().slice(1, 4)).toEqual(["수학학생", "—", "—"]);
  });

  it("메모를 누르면 그 자리에서 고치고 Enter로 저장 — 저장된 메모는 한 줄 + 마우스 오버 카드", async () => {
    vi.mocked(updateSessionTermNote).mockResolvedValueOnce({ note: "10/5 보강 1회" });
    render(<SessionTermGroups groups={[withInfo()]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    fireEvent.click(screen.getByRole("button", { name: "수학학생 메모 추가" }));
    const input = screen.getByLabelText("수학학생 메모");
    fireEvent.change(input, { target: { value: "10/5 보강 1회" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const saved = await screen.findByRole("button", { name: "수학학생 메모 수정: 10/5 보강 1회" });
    expect(updateSessionTermNote).toHaveBeenCalledTimes(1);
    expect(updateSessionTermNote).toHaveBeenCalledWith("수학", "10/5 보강 1회");
    expect(saved.getAttribute("data-tip")).toContain("10/5 보강 1회");
    expect(saved).not.toHaveAttribute("title");
    expect(saved.className).toContain("truncate");
    // 메모는 확정 경로가 아니다 — 확정 수가 안 바뀐다.
    expect(screen.getByTestId("confirmed-count")).toHaveTextContent("0");
  });

  it("Esc는 저장하지 않고 닫고, 바뀐 게 없으면 칸을 떠나도 저장하지 않는다", () => {
    const g = withInfo();
    g.students[0].note = "환불 문의";
    render(<SessionTermGroups groups={[g]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    fireEvent.click(screen.getByRole("button", { name: "수학학생 메모 수정: 환불 문의" }));
    const input = screen.getByLabelText("수학학생 메모");
    expect(input).toHaveValue("환불 문의");
    fireEvent.change(input, { target: { value: "바꿈" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getByRole("button", { name: "수학학생 메모 수정: 환불 문의" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "수학학생 메모 수정: 환불 문의" }));
    fireEvent.blur(screen.getByLabelText("수학학생 메모"));
    expect(updateSessionTermNote).not.toHaveBeenCalled();
  });

  it("저장 실패는 입력을 남기고 이유를 보여 준다", async () => {
    vi.mocked(updateSessionTermNote).mockResolvedValueOnce({ error: "수납 관리 권한이 없습니다" });
    render(<SessionTermGroups groups={[withInfo()]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    fireEvent.click(screen.getByRole("button", { name: "수학학생 메모 추가" }));
    fireEvent.change(screen.getByLabelText("수학학생 메모"), { target: { value: "메모" } });
    fireEvent.blur(screen.getByLabelText("수학학생 메모"));
    expect(await screen.findByRole("alert")).toHaveTextContent("수납 관리 권한이 없습니다");
    expect(screen.getByLabelText("수학학생 메모")).toHaveValue("메모");
  });
});

describe("선택 일괄 확정 · 확정≠예정 · 새 창 링크 (원장 2026-09-17)", () => {
  const two = () => {
    const g = group("수학");
    g.students.push({ ...g.students[0], id: "수학2", studentId: "수학2", studentName: "둘째학생", plannedSessions: 4.5 });
    return g;
  };

  it("단가 일괄 입력 → 체크한 학생만 → 선택 일괄 확정: 각 행에 보이는 시수 × 단가로 보낸다", async () => {
    vi.mocked(confirmSelectedTerms).mockResolvedValueOnce({ confirmed: 1, skipped: 0, terms: [{ id: "수학2", confirmedSessions: 4.5, unitPrice: 24000, amount: 108000, pricingMode: "per_session", confirmedAt: "2026-09-17", quantityBasis: "attendance_units" }] });
    render(<SessionTermGroups groups={[two()]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    const button = () => screen.getByRole("button", { name: /^선택 일괄 확정/ });
    expect(button()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("수학반 회당 단가"), { target: { value: "24000" } });
    fireEvent.click(screen.getByRole("button", { name: "단가 일괄 입력" }));
    fireEvent.click(screen.getByLabelText("둘째학생 선택"));
    expect(button()).toHaveTextContent("선택 일괄 확정 (1)");
    // 버튼은 '단가 일괄 입력' 바로 오른쪽.
    expect(screen.getByRole("button", { name: "단가 일괄 입력" }).nextElementSibling).toBe(button());
    fireEvent.click(button());
    await waitFor(() => expect(confirmSelectedTerms).toHaveBeenCalledWith("2026-09", "수학", [{ id: "수학2", sessions: 4.5, unitPrice: 24000, monthly: false }]));
    // 확정되면 그 행은 해제 버튼 + 체크박스 잠금, 선택 수는 0.
    expect(await screen.findByRole("button", { name: "해제" })).toBeEnabled();
    expect(screen.getByLabelText("둘째학생 선택")).toBeDisabled();
    expect(screen.getByLabelText("둘째학생 선택")).not.toBeChecked();
    expect(button()).toHaveTextContent(/^선택 일괄 확정$/);
    expect(screen.getByTestId("confirmed-count")).toHaveTextContent("1");
  });

  it("단가가 빈 학생이 섞이면 보내지 않고 이름을 알린다 · 반 전체 선택은 미확정 학생만 고른다", () => {
    const g = two();
    Object.assign(g.students[0], { confirmedSessions: 7, unitPrice: 21250, amount: 148750 });
    g.students.push({ ...g.students[1], id: "수학3", studentId: "수학3", studentName: "셋째학생" });
    render(<SessionTermGroups groups={[g]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    fireEvent.click(screen.getByLabelText("수학반 미확정 학생 전체 선택"));
    expect(screen.getByLabelText("수학학생 선택")).not.toBeChecked();
    expect(screen.getByLabelText("둘째학생 선택")).toBeChecked();
    expect(screen.getByLabelText("셋째학생 선택")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "선택 일괄 확정 (2)" }));
    expect(screen.getByRole("alert")).toHaveTextContent("시수·단가를 확인해 주세요: 둘째학생, 셋째학생");
    expect(confirmSelectedTerms).not.toHaveBeenCalled();
    // 하나를 풀면 전체 선택 칸은 '일부'(indeterminate).
    fireEvent.click(screen.getByLabelText("셋째학생 선택"));
    expect((screen.getByLabelText("수학반 미확정 학생 전체 선택") as HTMLInputElement).indeterminate).toBe(true);
  });

  it("선택 확정에서 일부가 실패하면 그 학생 이름과 사유를 반 머리 줄 둘째 줄에 보여 준다 · 반이 없는 묶음엔 선택이 없다", async () => {
    vi.mocked(confirmSelectedTerms).mockResolvedValueOnce({ confirmed: 1, skipped: 0, failedIds: ["수학2"], error: "1명은 확정하지 못했습니다 — 배분금액이 있는 반은 0시수로 확정할 수 없습니다", terms: [{ id: "수학", confirmedSessions: 9, unitPrice: 24000, amount: 216000, pricingMode: "per_session", confirmedAt: "2026-09-17", quantityBasis: "attendance_units" }] });
    const g = two();
    const noClass: ClassGroup = { ...group("수학"), classId: "noclass:?", className: "(반 미지정)", students: [{ ...group("수학").students[0], id: "고아", studentName: "고아학생", classId: null }] };
    render(<SessionTermGroups groups={[g, noClass]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    fireEvent.change(screen.getByLabelText("수학반 회당 단가"), { target: { value: "24000" } });
    fireEvent.click(screen.getAllByRole("button", { name: "단가 일괄 입력" })[0]!);
    fireEvent.click(screen.getByLabelText("수학반 미확정 학생 전체 선택"));
    fireEvent.click(screen.getByRole("button", { name: "선택 일괄 확정 (2)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("배분금액이 있는 반은 0시수로 확정할 수 없습니다 (둘째학생)");
    // 실패한 학생은 선택이 남는다(고쳐서 다시 누를 수 있게).
    expect(screen.getByLabelText("둘째학생 선택")).toBeChecked();
    expect(screen.queryByLabelText("(반 미지정) 미확정 학생 전체 선택")).toBeNull();
    expect(screen.getByLabelText("고아학생 선택")).toBeDisabled();
    expect(screen.getAllByRole("button", { name: /^선택 일괄 확정/ })).toHaveLength(1);
  });

  it("확정 시수가 예정과 다르면 주황 숫자 + 카드, 같으면 그대로 · 월 정액은 칠하지 않는다", () => {
    const g = group("수학");
    Object.assign(g.students[0], { plannedSessions: 4.5, confirmedSessions: 6, unitPrice: 24000, amount: 144000, quantityBasis: "attendance_units" });
    const { container, rerender } = render(<SessionTermGroups groups={[g]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    const mark = container.querySelector("span.text-amber[data-tip]");
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toContain("6");
    expect(mark!.getAttribute("data-tip")).toContain("예정 4.5시수 · 확정 6시수");
    const same = group("수학");
    Object.assign(same.students[0], { plannedSessions: 4.5, confirmedSessions: 4.5, unitPrice: 24000, amount: 108000, quantityBasis: "attendance_units" });
    rerender(<SessionTermGroups groups={[same]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    expect(container.querySelector("span.text-amber[data-tip]")).toBeNull();
    // 휴원·반 비활성으로 예정이 불확실한 행은 달라도 칠하지 않는다.
    const uncertain = group("수학");
    Object.assign(uncertain.students[0], { plannedSessions: 0, planUncertain: true, confirmedSessions: 8, unitPrice: 24000, amount: 192000, quantityBasis: "attendance_units" });
    rerender(<SessionTermGroups groups={[uncertain]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    expect(container.querySelector("span.text-amber[data-tip]")).toBeNull();
    const eie = group("EiE", 290000);
    Object.assign(eie.students[0], { plannedSessions: 20, confirmedSessions: 39, unitPrice: 270000, amount: 270000, pricingMode: "monthly", confirmedAt: "2026-09-16" });
    rerender(<SessionTermGroups groups={[eie]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    expect(container.querySelector("span.text-amber[data-tip]")).toBeNull();
  });

  it("반 이름 옆에 수업 요일, 학생 이름 옆에는 반 요일과 다를 때만 개별 등원 요일", () => {
    const g = two();
    Object.assign(g.students[0], { classDays: [1, 4], attendDays: [4] });
    Object.assign(g.students[1], { classDays: [1, 4], attendDays: null });
    const { container } = render(<SessionTermGroups groups={[g]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    const band = screen.getByRole("link", { name: "수학반" }).parentElement!;
    expect(band).toHaveTextContent("수학반월·목");
    const first = screen.getByRole("link", { name: "수학학생" }).parentElement!;
    expect(first).toHaveTextContent("수학학생목");
    expect(first.querySelector("[data-tip]")!.getAttribute("data-tip")).toContain("수업 요일 월·목");
    expect(screen.getByRole("link", { name: "둘째학생" }).parentElement!).toHaveTextContent(/^둘째학생$/);
    expect(screen.getByTitle("수학학생")).toHaveTextContent("수학학생");
    expect(container.querySelectorAll("span.text-amber[data-tip]")).toHaveLength(1);
  });

  it("학생 이름·반 이름은 원생·반 상세로 가는 링크다", () => {
    render(<SessionTermGroups groups={[group("수학")]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    expect(screen.getByRole("link", { name: "수학학생" })).toHaveAttribute("href", "/students/수학");
    expect(screen.getByRole("link", { name: "수학반" })).toHaveAttribute("href", "/classes/수학");
  });
});

describe("반 전원 확정 → '전체 확정 해제' (원장 2026-09-17)", () => {
  const allConfirmed = () => {
    const g = group("수학");
    Object.assign(g.students[0], { confirmedSessions: 7, unitPrice: 21250, amount: 148750, confirmedAt: "2026-09-17" });
    g.students.push({ ...g.students[0], id: "수학2", studentId: "수학2", studentName: "둘째학생" });
    return g;
  };
  const released = (id: string) => ({ id, confirmedSessions: null, unitPrice: null, amount: null, pricingMode: "per_session" as const, confirmedAt: null });

  it("보이는 학생이 전부 확정이면 입력칸·단가 일괄 입력·선택 일괄 확정 대신 버튼 하나 — 누르면 묻고 보이는 학생 id로 해제한 뒤 입력칸이 돌아온다", async () => {
    const ask = vi.fn(() => true);
    vi.stubGlobal("confirm", ask);
    vi.mocked(unconfirmClassTerms).mockResolvedValueOnce({ unconfirmed: 2, skipped: 0, failedIds: [], terms: [released("수학"), released("수학2")] });
    render(<SessionTermGroups groups={[allConfirmed()]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    expect(screen.queryByRole("button", { name: "단가 일괄 입력" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^선택 일괄 확정/ })).toBeNull();
    expect(screen.queryByLabelText("수학반 회당 단가")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "전체 확정 해제" }));
    expect(ask).toHaveBeenCalledWith(expect.stringContaining("수학반 2명의 확정을 모두 해제할까요?"));
    await waitFor(() => expect(unconfirmClassTerms).toHaveBeenCalledWith("2026-09", "수학", ["수학", "수학2"]));
    expect(await screen.findByRole("button", { name: "단가 일괄 입력" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "전체 확정 해제" })).toBeNull();
    expect(screen.getByTestId("confirmed-count")).toHaveTextContent("0");
    // 개별 해제와 같게 입력칸은 해제 전 시수·단가로 되채운다(예상금액이 바로 보인다).
    expect(screen.getByLabelText("수학학생 예상금액")).toHaveTextContent("148,750원");
    expect(screen.getByLabelText("둘째학생 예상금액")).toHaveTextContent("148,750원");
    vi.unstubAllGlobals();
  });

  it("묻는 창에서 취소하면 아무것도 보내지 않는다", () => {
    const ask = vi.fn(() => false);
    vi.stubGlobal("confirm", ask);
    render(<SessionTermGroups groups={[allConfirmed()]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    fireEvent.click(screen.getByRole("button", { name: "전체 확정 해제" }));
    expect(unconfirmClassTerms).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("한 명만 개별 해제해도 곧바로 입력칸과 일괄 버튼으로 돌아간다 · 한 명이라도 미확정이면 처음부터 입력칸", async () => {
    const mixed = allConfirmed();
    Object.assign(mixed.students[1], { confirmedSessions: null, unitPrice: null, amount: null, confirmedAt: null });
    const { unmount } = render(<SessionTermGroups groups={[mixed]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    expect(screen.getByRole("button", { name: "단가 일괄 입력" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "전체 확정 해제" })).toBeNull();
    unmount();
    vi.mocked(unconfirmSessionTerm).mockResolvedValueOnce({ ok: true, terms: [released("수학2")] });
    render(<SessionTermGroups groups={[allConfirmed()]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    fireEvent.click(screen.getAllByRole("button", { name: "해제" })[1]!);
    expect(await screen.findByRole("button", { name: "단가 일괄 입력" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^선택 일괄 확정/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "전체 확정 해제" })).toBeNull();
  });

  it("확정 전에 걸어 둔 체크는 해제와 함께 되살아나지 않는다 · EiE 반은 월 금액 표시를 남긴다", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    const g = allConfirmed();
    Object.assign(g.students[1], { confirmedSessions: null, unitPrice: null, amount: null, confirmedAt: null });
    vi.mocked(unconfirmClassTerms).mockResolvedValueOnce({ unconfirmed: 2, skipped: 0, failedIds: [], terms: [released("수학"), released("수학2")] });
    const { rerender } = render(<SessionTermGroups groups={[g]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    fireEvent.click(screen.getByLabelText("둘째학생 선택"));
    // 다른 창에서 둘째가 확정된 뒤 새 데이터로 다시 그려진다(선택은 화면 메모리에 남아 있다).
    rerender(<SessionTermGroups groups={[allConfirmed()]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    fireEvent.click(await screen.findByRole("button", { name: "전체 확정 해제" }));
    expect(await screen.findByRole("button", { name: "단가 일괄 입력" })).toBeInTheDocument();
    expect(screen.getByLabelText("둘째학생 선택")).not.toBeChecked();
    expect(screen.getByRole("button", { name: /^선택 일괄 확정/ })).toHaveTextContent(/^선택 일괄 확정$/);
    vi.unstubAllGlobals();
    const eie = group("EiE", 290000);
    Object.assign(eie.students[0], { confirmedSessions: 12, unitPrice: 270000, amount: 270000, pricingMode: "monthly", confirmedAt: "2026-09-16" });
    rerender(<SessionTermGroups groups={[eie]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    expect(screen.getByRole("button", { name: "전체 확정 해제" })).toBeInTheDocument();
    expect(screen.getByText("EiE 월 290,000원")).toBeInTheDocument();
  });

  it("개별 확정·반 일괄 확정으로 확정된 행의 체크도 버린다 — 다른 창에서 해제돼 새 데이터가 와도 되살아나지 않는다", async () => {
    const g = group("수학");
    g.students.push({ ...g.students[0], id: "수학2", studentId: "수학2", studentName: "둘째학생" });
    vi.mocked(confirmSessionTerm).mockResolvedValueOnce({ ok: true, terms: [{ id: "수학", confirmedSessions: 9, unitPrice: 24000, amount: 216000, pricingMode: "per_session", confirmedAt: "2026-09-17" }] });
    vi.mocked(confirmClassTerms).mockResolvedValueOnce({ confirmed: 1, terms: [{ id: "수학2", confirmedSessions: 9, unitPrice: 24000, amount: 216000, pricingMode: "per_session", confirmedAt: "2026-09-17" }] });
    const { rerender } = render(<SessionTermGroups groups={[g]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    fireEvent.click(screen.getByLabelText("수학학생 선택"));
    fireEvent.click(screen.getByLabelText("둘째학생 선택"));
    fireEvent.change(screen.getByLabelText("수학학생 회당 단가"), { target: { value: "24000" } });
    fireEvent.click(screen.getAllByRole("button", { name: "확정" })[0]!);
    await screen.findByRole("button", { name: "해제" });
    fireEvent.change(screen.getByLabelText("수학반 반 회차"), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("수학반 회당 단가"), { target: { value: "24000" } });
    fireEvent.click(screen.getByRole("button", { name: "이 반 일괄 확정" }));
    await screen.findByRole("button", { name: "전체 확정 해제" });
    // 다른 창에서 둘 다 해제 → 새 데이터(미확정)로 다시 그려진다.
    const fresh = group("수학");
    fresh.students.push({ ...fresh.students[0], id: "수학2", studentId: "수학2", studentName: "둘째학생" });
    rerender(<SessionTermGroups groups={[fresh]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    expect(screen.getByLabelText("수학학생 선택")).not.toBeChecked();
    expect(screen.getByLabelText("둘째학생 선택")).not.toBeChecked();
  });

  it("해제가 일부만 되면 버튼이 사라지므로 실패한 학생 이름을 창으로 알린다", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    vi.mocked(unconfirmClassTerms).mockResolvedValueOnce({ unconfirmed: 1, skipped: 0, failedIds: ["수학2"], error: "1명은 해제하지 못했습니다 — 해제하지 못했습니다. 다시 시도해 주세요", terms: [released("수학")] });
    render(<SessionTermGroups groups={[allConfirmed()]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    fireEvent.click(screen.getByRole("button", { name: "전체 확정 해제" }));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining("(둘째학생)")));
    vi.unstubAllGlobals();
  });
});

describe("지난 달 확정 기준 미리 채우기 (원장 2026-09-17 '입력칸만 미리 채움')", () => {
  const suggested = () => {
    const g = group("수학");
    Object.assign(g.students[0], { plannedSessions: 13.5, lastMonth: { price: 21250, sessions: 9, last: { sessions: 6, price: 21250, planned: 9 } } });
    return g;
  };

  it("미확정 행의 시수·단가 칸을 지난 달 기준으로 채우고 칠한다 — 카드가 근거를 말하고, 저장은 하지 않는다", () => {
    render(<SessionTermGroups groups={[suggested()]} catalog={DEFAULT_SESSION_PRICES} period="2026-10" />);
    const sessions = screen.getByLabelText("수학학생 확정 회차") as HTMLInputElement;
    const price = screen.getByLabelText("수학학생 회당 단가") as HTMLInputElement;
    expect(sessions.value).toBe("9");
    expect(price.value).toBe("21250");
    // 단가 = 지난 달 값을 옮겼다(파랑) · 시수 = 예정과 다르게 채웠다(주황 — 확정 행의 '확정 ≠ 예정'과 같은 뜻).
    expect(price.className).toContain("bg-blue-soft");
    expect(price.className).not.toContain("bg-background");
    expect(sessions.className).toContain("bg-amber-soft");
    expect(price.getAttribute("data-tip")).toContain("지난 달 6시수 × 21,250원");
    expect(sessions.getAttribute("data-tip")).toContain("이번 달 예정 13.5시수 → 9시수");
    expect(sessions.getAttribute("data-tip")).toContain("휴원·결석으로 줄였거나 이번 달 등원 요일을 늘린 학생이면 예정 시수로 고치세요");
    expect(screen.getByLabelText("수학학생 예상금액")).toHaveTextContent("191,250원");
    expect(confirmSessionTerm).not.toHaveBeenCalled();
    expect(confirmSelectedTerms).not.toHaveBeenCalled();
  });

  it("🔴 비율로 줄인 시수가 섞인 선택 일괄 확정은 한 번 묻는다 — 취소하면 안 보내고, 확인하면 채워진 값 그대로 · 고치면 칠이 사라진다", async () => {
    const ask = vi.fn(() => false);
    vi.stubGlobal("confirm", ask);
    vi.mocked(confirmSelectedTerms).mockResolvedValueOnce({ confirmed: 1, skipped: 0, terms: [] });
    render(<SessionTermGroups groups={[suggested()]} catalog={DEFAULT_SESSION_PRICES} period="2026-10" />);
    fireEvent.click(screen.getByLabelText("수학학생 선택"));
    fireEvent.click(screen.getByRole("button", { name: "선택 일괄 확정 (1)" }));
    expect(ask).toHaveBeenCalledWith(expect.stringContaining("· 수학학생: 예정 13.5 → 9시수"));
    expect(confirmSelectedTerms).not.toHaveBeenCalled();
    ask.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "선택 일괄 확정 (1)" }));
    await waitFor(() => expect(confirmSelectedTerms).toHaveBeenCalledWith("2026-10", "수학", [{ id: "수학", sessions: 9, unitPrice: 21250, monthly: false }]));
    fireEvent.change(screen.getByLabelText("수학학생 회당 단가"), { target: { value: "24000" } });
    expect(screen.getByLabelText("수학학생 회당 단가").className).not.toContain("bg-blue-soft");
    expect(screen.getByLabelText("수학학생 확정 회차").className).toContain("bg-amber-soft");
    fireEvent.change(screen.getByLabelText("수학학생 확정 회차"), { target: { value: "13.5" } });
    expect(screen.getByLabelText("수학학생 확정 회차").className).not.toContain("bg-amber-soft");
    vi.unstubAllGlobals();
  });

  it("🔴 개별 확정(행의 확정 버튼)도 같은 확인을 거친다 — 취소하면 안 보낸다", async () => {
    const ask = vi.fn(() => false);
    vi.stubGlobal("confirm", ask);
    render(<SessionTermGroups groups={[suggested()]} catalog={DEFAULT_SESSION_PRICES} period="2026-10" />);
    const row = screen.getByLabelText("수학학생 확정 회차").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "확정" }));
    expect(ask).toHaveBeenCalledWith(expect.stringContaining("· 수학학생: 예정 13.5 → 9시수"));
    expect(confirmSessionTerm).not.toHaveBeenCalled();
    ask.mockReturnValue(true);
    fireEvent.click(within(row).getByRole("button", { name: "확정" }));
    await waitFor(() => expect(confirmSessionTerm).toHaveBeenCalled());
    vi.unstubAllGlobals();
  });

  it("단가만 옮긴 행(시수 = 예정)은 묻지 않고 확정한다", async () => {
    const ask = vi.fn(() => true);
    vi.stubGlobal("confirm", ask);
    vi.mocked(confirmSelectedTerms).mockResolvedValueOnce({ confirmed: 1, skipped: 0, terms: [] });
    const g = group("수학");
    Object.assign(g.students[0], { lastMonth: { price: 21250, sessions: null, last: { sessions: 9, price: 21250, planned: 9 } } });
    render(<SessionTermGroups groups={[g]} catalog={DEFAULT_SESSION_PRICES} period="2026-10" />);
    expect(screen.getByLabelText("수학학생 확정 회차").className).not.toContain("bg-amber-soft");
    fireEvent.click(screen.getByLabelText("수학학생 선택"));
    fireEvent.click(screen.getByRole("button", { name: "선택 일괄 확정 (1)" }));
    await waitFor(() => expect(confirmSelectedTerms).toHaveBeenCalledWith("2026-10", "수학", [{ id: "수학", sessions: 9, unitPrice: 21250, monthly: false }]));
    expect(ask).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("단가 일괄 입력은 단가만 바꾸고 미리 채운 시수(비율)는 그대로 둔다", () => {
    render(<SessionTermGroups groups={[suggested()]} catalog={DEFAULT_SESSION_PRICES} period="2026-10" />);
    fireEvent.change(screen.getByLabelText("수학반 회당 단가"), { target: { value: "24000" } });
    fireEvent.click(screen.getByRole("button", { name: "단가 일괄 입력" }));
    expect((screen.getByLabelText("수학학생 확정 회차") as HTMLInputElement).value).toBe("9");
    expect((screen.getByLabelText("수학학생 회당 단가") as HTMLInputElement).value).toBe("24000");
  });

  it("지난 달 기준이 없으면 종전대로 예정 시수 · 빈 단가 · 칠하지 않음", () => {
    render(<SessionTermGroups groups={[group("수학")]} catalog={DEFAULT_SESSION_PRICES} period="2026-10" />);
    expect((screen.getByLabelText("수학학생 확정 회차") as HTMLInputElement).value).toBe("9");
    expect((screen.getByLabelText("수학학생 회당 단가") as HTMLInputElement).value).toBe("");
    expect(screen.getByLabelText("수학학생 회당 단가").className).not.toContain("bg-blue-soft");
    expect(screen.getByLabelText("수학학생 확정 회차").className).toContain("bg-background");
  });
});

describe("회차 행이 없는 줄(출석부 줄에 맞춤, 원장 2026-09-18)", () => {
  const VID = "v:11111111-1111-4111-8111-111111111111:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const withRows = (): ClassGroup => {
    const g = group("수학");
    const base = g.students[0];
    g.students = [
      base,
      { ...base, id: VID, studentId: "s-visit", studentName: "보강생", termState: "missing", plannedSessions: null, recordedUnits: 1.5, rosterSources: ["recorded"] },
      { ...base, id: "v:nobill:수학", studentId: "s-nobill", studentName: "무청구", invoiceId: null, termState: "no_invoice" },
      { ...base, id: "v:void:수학", studentId: "s-void", studentName: "취소생", invoiceId: null, termState: "void_invoice" },
    ];
    return g;
  };

  it("회차 없음 줄은 확정할 수 있고 '실 N'·'회차 없음'이 한글로 선다 — 청구서 없음·취소 줄은 체크·확정·배분이 잠긴다", () => {
    render(<SessionTermGroups groups={[withRows()]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    expect(screen.getByText("실 1.5")).toBeInTheDocument();
    expect(screen.getByText("회차 없음")).toBeInTheDocument();
    expect(screen.getByLabelText("보강생 선택")).toBeEnabled();
    expect(screen.getByText("청구서 없음")).toBeInTheDocument();
    expect(screen.getByText("청구서 취소")).toBeInTheDocument();
    expect(screen.getByLabelText("무청구 선택")).toBeDisabled();
    expect(screen.getByLabelText("취소생 선택")).toBeDisabled();
    expect(screen.queryByLabelText("무청구 확정 회차")).not.toBeInTheDocument();
    // 확정 버튼 = 원래 줄 + 회차 없음 줄 둘뿐. raw 코드는 DOM에 없다.
    expect(screen.getAllByRole("button", { name: "확정" })).toHaveLength(2);
    expect(document.body.textContent).not.toMatch(/no_invoice|void_invoice|missing/);
  });

  it("밴드 '확정 n/N'의 분모는 확정할 수 있는 줄이고 잠긴 줄은 '청구서 없음 k'로 따로 적는다", () => {
    render(<SessionTermGroups groups={[withRows()]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    expect(screen.getByText("0/2")).toBeInTheDocument();
    expect(screen.getByText(/청구서 없음 2/)).toBeInTheDocument();
  });

  it("가상 줄 확정은 청구월을 함께 보내고 성공하면 새로고침해 실 행으로 갈아끼운다", async () => {
    vi.mocked(confirmSessionTerm).mockResolvedValueOnce({ ok: true, created: 1, terms: [{ id: "real", confirmedSessions: 1.5, unitPrice: 24000, amount: 36000, pricingMode: "per_session", confirmedAt: "2026-09-18" }] });
    render(<SessionTermGroups groups={[withRows()]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    fireEvent.change(screen.getByLabelText("보강생 확정 회차"), { target: { value: "1.5" } });
    fireEvent.change(screen.getByLabelText("보강생 회당 단가"), { target: { value: "24000" } });
    const buttons = screen.getAllByRole("button", { name: "확정" });
    await act(async () => fireEvent.click(buttons[1]));
    await waitFor(() => expect(confirmSessionTerm).toHaveBeenCalled());
    const sent = vi.mocked(confirmSessionTerm).mock.calls[0][1] as FormData;
    expect(sent.get("id")).toBe(VID);
    expect(sent.get("period")).toBe("2026-09");
    await waitFor(() => expect(h.refresh).toHaveBeenCalled());
    // 새 데이터가 올 때까지 그 줄은 잠긴다(다시 누르지 않게).
    const row = screen.getByText("보강생").closest("tr")!;
    expect(within(row).getByRole("button", { name: "확정 중…" })).toBeDisabled();
    expect(screen.getByLabelText("보강생 회당 단가")).toBeDisabled();
  });
});

describe("반 일괄 대상·가상 줄 전환·실납 표식 (적대적 리뷰 2026-09-18)", () => {
  const VID = "v:11111111-1111-4111-8111-111111111111:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const VID_PLANNED = "v:22222222-2222-4222-8222-222222222222:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const VID_RESERVED = "v:33333333-3333-4333-8333-333333333333:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  type Student = ClassGroup["students"][number];
  const released = (id: string) => ({ id, confirmedSessions: null, unitPrice: null, amount: null, pricingMode: "per_session" as const, confirmedAt: null });
  /** 반 하나 = 원래 줄(수학학생) + 보강 방문(예정 없음, 가상) + 청구서 없음 줄. */
  const withVisitor = (): ClassGroup => {
    const g = group("수학");
    const base = g.students[0];
    g.students = [
      base,
      { ...base, id: VID, studentId: "s-visit", studentName: "보강생", termState: "missing", plannedSessions: null, recordedUnits: 1.5, rosterSources: ["recorded"] },
      { ...base, id: "v:nobill:수학", studentId: "s-nobill", studentName: "무청구", invoiceId: null, termState: "no_invoice" },
    ];
    return g;
  };
  const replaceStudent = (g: ClassGroup, name: string, patch: Partial<Student>) => {
    g.students = g.students.map((s) => (s.studentName === name ? { ...s, ...patch } : s));
    return g;
  };
  const rowOf = (name: string) => screen.getByText(name).closest("tr")!;

  it("F: 반 일괄 대상(예정 있는 줄)이 전부 확정이면 예정 없는 줄이 미확정이어도 '전체 확정 해제' — 반 일괄 폼은 없고 해제는 확정된 실 행만", async () => {
    const ask = vi.fn(() => true);
    vi.stubGlobal("confirm", ask);
    vi.mocked(unconfirmClassTerms).mockResolvedValueOnce({ unconfirmed: 2, skipped: 0, failedIds: [], terms: [released("수학"), released("plan0")] });
    const g = withVisitor();
    Object.assign(g.students[0], { confirmedSessions: 9, unitPrice: 24000, amount: 216000, confirmedAt: "2026-09-17" });
    // 월초에 끝난 수강(예정 0) — 개별로 확정해 둔 실 행.
    g.students.push({ ...g.students[0], id: "plan0", studentId: "s-plan0", studentName: "월초종료", plannedSessions: 0, confirmedSessions: 1, amount: 24000 });
    render(<SessionTermGroups groups={[g]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    expect(screen.getByRole("button", { name: "전체 확정 해제" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "단가 일괄 입력" })).toBeNull();
    expect(screen.queryByRole("button", { name: "이 반 일괄 확정" })).toBeNull();
    expect(screen.queryByLabelText("수학반 회당 단가")).toBeNull();
    // 밴드 '확정 n/N' — 분모는 확정할 수 있는 줄 전부(예정 없는 줄 포함), 다 끝나지 않았으니 앰버.
    expect(screen.getByText("2/3").className).toContain("text-amber");
    // 예정 없는 줄은 행의 '확정'으로 개별 확정한다.
    expect(within(rowOf("보강생")).getByRole("button", { name: "확정" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "전체 확정 해제" }));
    expect(ask).toHaveBeenCalledWith(expect.stringContaining("수학반 2명의 확정을 모두 해제할까요?"));
    await waitFor(() => expect(unconfirmClassTerms).toHaveBeenCalledWith("2026-09", "수학", ["수학", "plan0"]));
    vi.unstubAllGlobals();
  });

  it("F: 반 일괄 대상이 하나라도 미확정이면 종전대로 입력칸·일괄 버튼", () => {
    render(<SessionTermGroups groups={[withVisitor()]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    expect(screen.getByRole("button", { name: "단가 일괄 입력" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "전체 확정 해제" })).toBeNull();
  });

  it("G: 확정할 줄이 없는 반(청구서 없음·취소뿐)엔 일괄 입력·확정 자체가 없고 '0/0'은 무채색", () => {
    const g = group("수학");
    const base = g.students[0];
    g.students = [
      { ...base, id: "v:nobill:수학", studentId: "s-nobill", studentName: "무청구", invoiceId: null, termState: "no_invoice" },
      { ...base, id: "v:void:수학", studentId: "s-void", studentName: "취소생", invoiceId: null, termState: "void_invoice" },
    ];
    render(<SessionTermGroups groups={[g]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    expect(screen.queryByRole("button", { name: "단가 일괄 입력" })).toBeNull();
    expect(screen.queryByLabelText("수학반 회당 단가")).toBeNull();
    expect(screen.queryByRole("button", { name: /^선택 일괄 확정/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "전체 확정 해제" })).toBeNull();
    const count = screen.getByText("0/0");
    expect(count.className).toContain("text-text-dim");
    expect(count.className).not.toContain("text-amber");
  });

  it("H: 예정 칸은 한 줄 짧은 표기(실 N · 예약, text-xs) — '출석부에 없음'은 예정 숫자를 가리지 않고 실납 칸 꼬리표로", () => {
    const g = group("수학");
    const base = g.students[0];
    g.students = [
      { ...base, id: "nolesson", studentId: "s-nl", studentName: "종강생", noLesson: true },
      { ...base, id: VID, studentId: "s-visit", studentName: "보강생", termState: "missing", plannedSessions: null, recordedUnits: 1.5, rosterSources: ["recorded"] },
      { ...base, id: VID_RESERVED, studentId: "s-rsv", studentName: "예약생", termState: "missing", plannedSessions: null, recordedUnits: null, rosterSources: ["reserved"] },
    ];
    render(<SessionTermGroups groups={[g]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    // 종강생: 예정 칸은 계획 숫자 그대로, 표식은 실납 칸.
    expect(rowOf("종강생").children[4]!.textContent).toBe("9");
    const nl = within(rowOf("종강생")).getByText(NO_LESSON_LABEL.label);
    expect(nl.getAttribute("data-tip")).toContain(NO_LESSON_LABEL.tip);
    const cases: [string, string, string][] = [
      ["보강생", "실 1.5", "출석부에 찍힌 시수 1.5시수"],
      ["예약생", "예약", "보강 예약만 있고"],
    ];
    for (const [name, text, tip] of cases) {
      // 다섯째 칸(선택·이름·학교학년·담임 다음) = 예정 시수.
      const mark = rowOf(name).children[4]!.querySelector("span")!;
      expect(mark.textContent).toBe(text);
      expect(mark.className).toContain("text-xs");
      expect(mark.getAttribute("data-tip")).toContain(tip);
    }
    expect(document.body.textContent).not.toContain("실제 1.5시수");
  });

  it("반 일괄 안내('예정이 없는 N명 빠짐')는 반이 '전체 확정 해제'로 바뀌어도 남는다", async () => {
    vi.mocked(confirmClassTerms).mockResolvedValueOnce({ confirmed: 1, skippedUnplanned: 1, terms: [{ id: "수학", confirmedSessions: 9, unitPrice: 24000, amount: 216000, pricingMode: "per_session", confirmedAt: "2026-09-18" }] });
    render(<SessionTermGroups groups={[withVisitor()]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    fireEvent.change(screen.getByLabelText("수학반 반 회차"), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("수학반 회당 단가"), { target: { value: "24000" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "이 반 일괄 확정" })));
    await waitFor(() => expect(screen.getByRole("button", { name: "전체 확정 해제" })).toBeInTheDocument());
    expect(screen.getByText(/예정이 없는 1명\(보강 방문 등\)은 반 일괄에서 빠졌습니다/)).toBeInTheDocument();
  });

  it("'회차 없음' 알약 카드는 옆 금액이 이름 매칭 참고값이라는 사실을 함께 말한다", () => {
    const g = withVisitor();
    g.students = g.students.map((s) => (s.studentName === "보강생" ? { ...s, classAmount: 148750 } : s));
    render(<SessionTermGroups groups={[g]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    const pill = within(rowOf("보강생")).getByText("회차 없음");
    expect(pill.getAttribute("data-tip")).toContain("이름 매칭 참고값");
  });

  it("I: 가상 줄이 실 행으로 바뀌어도(새로고침) 입력칸 초안·체크가 같은 학생·반의 새 줄로 옮겨 간다", () => {
    const { rerender } = render(<SessionTermGroups groups={[withVisitor()]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    fireEvent.change(screen.getByLabelText("보강생 확정 회차"), { target: { value: "1.5" } });
    fireEvent.change(screen.getByLabelText("보강생 회당 단가"), { target: { value: "24000" } });
    fireEvent.click(screen.getByLabelText("보강생 선택"));
    // 배분 저장 → 새로고침: 같은 학생·반이 회차 행(실 id, 미확정)으로 돌아온다.
    rerender(<SessionTermGroups groups={[replaceStudent(withVisitor(), "보강생", { id: "real-visit", termState: "term" })]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    expect(screen.getByLabelText("보강생 회당 단가")).toHaveValue("24000");
    expect(screen.getByLabelText("보강생 확정 회차")).toHaveValue(1.5);
    expect(screen.getByLabelText("보강생 선택")).toBeChecked();
    expect(screen.getByLabelText("보강생 예상금액")).toHaveTextContent("36,000원");
  });

  it("I: 같은 학생·반의 새 줄이 둘(청구서 중복)이면 어느 쪽인지 몰라 옮기지 않는다", () => {
    const { rerender } = render(<SessionTermGroups groups={[withVisitor()]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    fireEvent.change(screen.getByLabelText("보강생 회당 단가"), { target: { value: "24000" } });
    const next = replaceStudent(withVisitor(), "보강생", { id: "real-a", termState: "term", duplicateInvoice: true });
    next.students.push({ ...next.students.find((s) => s.id === "real-a")!, id: "real-b", invoiceId: "invoice-2" });
    rerender(<SessionTermGroups groups={[next]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    for (const input of screen.getAllByLabelText("보강생 회당 단가")) expect(input).toHaveValue("");
  });

  it("J: 선택 일괄 확정이 가상 줄을 실 행으로 바꾸면 새 데이터가 올 때까지 그 줄만 잠근다 — 새 데이터가 오면 풀린다", async () => {
    vi.mocked(confirmSelectedTerms).mockResolvedValueOnce({ confirmed: 1, skipped: 0, created: 1, materialized: 1, terms: [{ id: "real-visit", confirmedSessions: 1.5, unitPrice: 24000, amount: 36000, pricingMode: "per_session", confirmedAt: "2026-09-18", quantityBasis: "attendance_units" }] });
    const { rerender } = render(<SessionTermGroups groups={[withVisitor()]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    fireEvent.change(screen.getByLabelText("보강생 확정 회차"), { target: { value: "1.5" } });
    fireEvent.change(screen.getByLabelText("보강생 회당 단가"), { target: { value: "24000" } });
    fireEvent.click(screen.getByLabelText("보강생 선택"));
    fireEvent.click(screen.getByRole("button", { name: "선택 일괄 확정 (1)" }));
    await waitFor(() => expect(confirmSelectedTerms).toHaveBeenCalledWith("2026-09", "수학", [{ id: VID, sessions: 1.5, unitPrice: 24000, monthly: false }]));
    await waitFor(() => expect(h.refresh).toHaveBeenCalledOnce());
    expect(await within(rowOf("보강생")).findByRole("button", { name: "확정 중…" })).toBeDisabled();
    expect(screen.getByLabelText("보강생 회당 단가")).toBeDisabled();
    expect(screen.getByLabelText("보강생 확정 회차")).toBeDisabled();
    expect(screen.getByLabelText("보강생 선택")).toBeDisabled();
    // 다른 줄은 잠기지 않는다.
    expect(within(rowOf("수학학생")).getByRole("button", { name: "확정" })).toBeEnabled();
    const fresh = replaceStudent(withVisitor(), "보강생", { id: "real-visit", termState: "term", confirmedSessions: 1.5, unitPrice: 24000, amount: 36000, confirmedAt: "2026-09-18" });
    rerender(<SessionTermGroups groups={[fresh]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    expect(within(rowOf("보강생")).getByRole("button", { name: "해제" })).toBeEnabled();
  });

  it("J: 선택 일괄 확정이 통째로 거절되면(실 행이 된 줄 없음) 잠그지도 새로 읽지도 않고 체크를 남긴다", async () => {
    vi.mocked(confirmSelectedTerms).mockResolvedValueOnce({ error: "수납 관리 권한이 없습니다" });
    render(<SessionTermGroups groups={[withVisitor()]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    fireEvent.change(screen.getByLabelText("보강생 확정 회차"), { target: { value: "1.5" } });
    fireEvent.change(screen.getByLabelText("보강생 회당 단가"), { target: { value: "24000" } });
    fireEvent.click(screen.getByLabelText("보강생 선택"));
    fireEvent.click(screen.getByRole("button", { name: "선택 일괄 확정 (1)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("수납 관리 권한이 없습니다");
    expect(h.refresh).not.toHaveBeenCalled();
    expect(screen.getByLabelText("보강생 선택")).toBeChecked();
    expect(within(rowOf("보강생")).getByRole("button", { name: "확정" })).toBeEnabled();
  });

  it("J: 반 일괄이 가상 줄을 실 행으로 바꾸면 반 일괄 대상 가상 줄만 잠그고 새로 읽는다 · 예정 없는 줄이 빠진 사실을 알린다", async () => {
    vi.mocked(confirmClassTerms).mockResolvedValueOnce({ confirmed: 2, created: 1, materialized: 1, skippedUnplanned: 1, terms: [{ id: "수학", confirmedSessions: 9, unitPrice: 24000, amount: 216000, pricingMode: "per_session", confirmedAt: "2026-09-18" }] });
    const g = withVisitor();
    // 수강 중인데 회차 행이 없던 학생 — 예정이 있어 반 일괄 대상이다.
    g.students.push({ ...g.students[0], id: VID_PLANNED, studentId: "s-new", studentName: "신입생", termState: "missing" });
    render(<SessionTermGroups groups={[g]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    fireEvent.change(screen.getByLabelText("수학반 반 회차"), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("수학반 회당 단가"), { target: { value: "24000" } });
    fireEvent.click(screen.getByRole("button", { name: "이 반 일괄 확정" }));
    expect(await screen.findByText("예정이 없는 1명(보강 방문 등)은 반 일괄에서 빠졌습니다 — 실제 시수를 보고 개별로 확정하세요")).toBeInTheDocument();
    expect(h.refresh).toHaveBeenCalledOnce();
    expect(within(rowOf("신입생")).getByRole("button", { name: "확정 중…" })).toBeDisabled();
    // 예정 없는 보강 방문 줄은 반 일괄 대상이 아니라 잠그지 않는다(개별로 확정한다).
    expect(within(rowOf("보강생")).getByRole("button", { name: "확정" })).toBeEnabled();
  });

  it("J: 반 일괄이 실 행을 만들지 않았으면(가상 줄이 섞여 있어도) 새로 읽지 않는다", async () => {
    vi.mocked(confirmClassTerms).mockResolvedValueOnce({ confirmed: 1, skippedUnplanned: 1, terms: [{ id: "수학", confirmedSessions: 9, unitPrice: 24000, amount: 216000, pricingMode: "per_session", confirmedAt: "2026-09-18" }] });
    render(<SessionTermGroups groups={[withVisitor()]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    fireEvent.change(screen.getByLabelText("수학반 반 회차"), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("수학반 회당 단가"), { target: { value: "24000" } });
    fireEvent.click(screen.getByRole("button", { name: "이 반 일괄 확정" }));
    expect(await within(rowOf("수학학생")).findByRole("button", { name: "해제" })).toBeEnabled();
    expect(h.refresh).not.toHaveBeenCalled();
    expect(within(rowOf("보강생")).getByRole("button", { name: "확정" })).toBeEnabled();
  });

  it("K: 회차 없음 줄도 배분 표식(배분 완료·재확인 필요)을 보이고 '회차 없음' 설명은 그 카드로 — 표식이 없을 때만 알약", () => {
    const cell = () => within(rowOf("보강생")).getByRole("button", { name: "배분" }).closest("td")!;
    const { rerender } = render(<SessionTermGroups groups={[replaceStudent(withVisitor(), "보강생", { allocatedAmount: 36000 })]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    const done = within(cell()).getByText("배분 완료");
    expect(done.getAttribute("data-tip")).toContain(TERM_STATE_LABEL.missing.tip);
    expect(within(cell()).queryByText(TERM_STATE_LABEL.missing.label)).toBeNull();
    rerender(<SessionTermGroups groups={[replaceStudent(withVisitor(), "보강생", { allocationStale: true, classAmount: 36000 })]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    const stale = within(cell()).getByText("배분 재확인 필요");
    expect(stale.getAttribute("data-tip")).toContain(TERM_STATE_LABEL.missing.tip);
    expect(stale.getAttribute("data-tip")).toContain("이름 매칭 참고값");
    expect(within(cell()).queryByText(TERM_STATE_LABEL.missing.label)).toBeNull();
    rerender(<SessionTermGroups groups={[withVisitor()]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    expect(within(cell()).getByText(TERM_STATE_LABEL.missing.label).getAttribute("data-tip")).toContain(TERM_STATE_LABEL.missing.tip);
  });

  it("K: 청구서 중복 줄은 다른 표식이 없을 때 주의 알약 + 카드('이름 매칭 참고' 자리) — 배분 표식이 있으면 그 카드로", () => {
    const g = group("수학");
    Object.assign(g.students[0], { duplicateInvoice: true, classAmount: 148750 });
    const { rerender } = render(<SessionTermGroups groups={[g]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    const pill = screen.getByText("청구서 중복");
    expect(pill.className).toContain("bg-amber-soft");
    expect(pill.getAttribute("data-tip")).toContain("청구서 2장 이상");
    expect(pill.getAttribute("data-tip")).toContain("이름 매칭 참고값");
    expect(screen.queryByText("이름 매칭 참고")).toBeNull();
    const allocated = group("수학");
    Object.assign(allocated.students[0], { duplicateInvoice: true, allocatedAmount: 148750 });
    rerender(<SessionTermGroups groups={[allocated]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    expect(screen.queryByText("청구서 중복")).toBeNull();
    expect(screen.getByText("배분 완료").getAttribute("data-tip")).toContain("청구서 2장 이상");
  });
});
