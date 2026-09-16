import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { RecordSavedMessage } from "@/lib/realtime/record-channel";
import { SessionTermGroups, type ClassGroup } from "./session-term-table";
import { DEFAULT_SESSION_PRICES } from "@/features/billing/session-pricing";

const h = vi.hoisted(() => ({ refresh: vi.fn(), saved: null as null | ((message: RecordSavedMessage) => void) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("@/lib/realtime/record-channel", () => ({
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

beforeEach(() => h.refresh.mockClear());

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
});
