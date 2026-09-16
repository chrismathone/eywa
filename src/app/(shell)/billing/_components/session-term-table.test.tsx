import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { RecordSavedMessage } from "@/lib/realtime/record-channel";
import { SessionTermGroups as Table, type ClassGroup } from "./session-term-table";
import { SessionTermsState, SessionTermsConfirmedCount } from "./session-terms-state";
import { confirmSessionTerm, unconfirmSessionTerm, confirmClassTerms } from "@/features/billing/session-terms/server/actions";
import type { SessionTermActionState } from "@/features/billing/session-terms/server/actions";
import { DEFAULT_SESSION_PRICES } from "@/features/billing/session-pricing";

const h = vi.hoisted(() => ({ refresh: vi.fn(), saved: null as null | ((message: RecordSavedMessage) => void) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("@/lib/realtime/record-channel", () => ({
  publishRecordSaved: vi.fn(),
  subscribeRecordSaved: (callback: (message: RecordSavedMessage) => void) => { h.saved = callback; return () => { h.saved = null; }; },
}));
vi.mock("@/features/billing/session-terms/server/actions", () => ({
  confirmSessionTerm: vi.fn(), unconfirmSessionTerm: vi.fn(), confirmClassTerms: vi.fn(), refreshPlannedTerms: vi.fn(),
}));
vi.mock("@/components/ui/drag-scroll-area", () => ({ DragScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

const group = (subjectLabel: string, monthlyPrice: number | null = null): ClassGroup => ({
  classId: subjectLabel, className: `${subjectLabel}반`, subjectLabel,
  students: [{
    id: subjectLabel, invoiceId: "invoice", studentId: subjectLabel, studentName: `${subjectLabel}학생`, studentGrade: "중1",
    subject: subjectLabel === "수학" ? "math" : "english", subjectLabel,
    classId: subjectLabel, className: `${subjectLabel}반`, monthlyPrice, pricingMode: "per_session",
    plannedSessions: 9, confirmedSessions: null, unitPrice: null, amount: null, confirmedAt: null, note: null, classAmount: null,
  }],
});

function SessionTermGroups(props: React.ComponentProps<typeof Table>) {
  return <SessionTermsState rows={props.groups.flatMap((g) => g.students)}><div data-testid="confirmed-count"><SessionTermsConfirmedCount /></div><Table {...props} /></SessionTermsState>;
}

beforeEach(() => vi.clearAllMocks());

describe("회차 단가 선택", () => {
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

  it("회차 없이 반 단가만 입력하면 미확정 입력칸과 예상금액만 바뀐다", () => {
    render(<SessionTermGroups groups={[group("수학")]} catalog={DEFAULT_SESSION_PRICES} period="2026-09" />);
    fireEvent.change(screen.getByLabelText("수학학생 확정 회차"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("수학반 회당 단가"), { target: { value: "21,250" } });
    fireEvent.click(screen.getByRole("button", { name: "단가 일괄 입력" }));
    expect(screen.getByLabelText("수학학생 회당 단가")).toHaveValue("21250");
    expect(screen.getByLabelText("수학학생 확정 회차")).toHaveValue(7);
    expect(screen.getByLabelText("수학학생 예상금액")).toHaveTextContent("148,750원");
    expect(screen.getByLabelText("수학학생 예상금액")).toHaveTextContent("7회 × 21,250원");
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
    expect(await screen.findByRole("button", { name: "해제" })).toBeEnabled();
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
