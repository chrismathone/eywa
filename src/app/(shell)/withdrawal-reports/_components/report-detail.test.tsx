import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ReportDetail } from "./report-detail";
import { EMPTY_BODY, type WithdrawalReport } from "@/features/withdrawal-reports/model";
const mocks = vi.hoisted(() => ({ change: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/features/withdrawal-reports/server/actions", () => ({ changeWithdrawalReport: mocks.change }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
const teacher = "10000000-0000-4000-8000-000000000002";
const manager = "10000000-0000-4000-8000-000000000003";
const director = "10000000-0000-4000-8000-000000000004";
const r: WithdrawalReport = { id: "10000000-0000-4000-8000-000000000001", tenant_id: "tenant", student_id: "student", requested_by: manager, teacher_id: teacher, manager_id: manager, director_id: director,
  exit_kind: "withdrawal", subjects: ["math"], effective_date: "2026-10-13", request_note: "", snapshot: { name: "테스트 학생", school: "테스트중", grade: "중1", enrolledAt: "2026-01-01", status: "enrolled", withdrawnAt: null, courses: [] },
  body: EMPTY_BODY, status: "requested", revision: 3, manager_approved_at: null, director_approved_at: null, applied_at: null, last_comment: null, created_at: "2026-10-13T01:00:00Z", updated_at: "2026-10-13T01:00:00Z" };
const props = { report: r, staff: [], labels: { math: "수학" }, userId: teacher, writable: true, events: [] };
describe("report submission and review", () => {
  beforeEach(() => { cleanup(); vi.clearAllMocks(); mocks.change.mockResolvedValue({ ok: true, id: r.id }); });
  it("submits the entered report only after explicit confirmation", async () => {
    render(<ReportDetail {...props} />);
    fireEvent.change(screen.getByLabelText("퇴원 상세사유"), { target: { value: "상담 결과 ".repeat(40) } });
    fireEvent.change(screen.getByLabelText("학생상담"), { target: { value: "학생 상담 완료" } });
    fireEvent.change(screen.getByLabelText("학부모상담"), { target: { value: "학부모 상담 완료" } });
    fireEvent.change(screen.getByLabelText("담임 의견"), { target: { value: "종료 요청 확인" } });
    fireEvent.click(screen.getByRole("button", { name: "관리자에게 제출" }));
    expect(mocks.change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "보고서 제출 확인" }));
    await waitFor(() => expect(mocks.change).toHaveBeenCalledWith(r.id, "submit", r.revision, expect.objectContaining({ studentConsultation: "학생 상담 완료", detail: "상담 결과 ".repeat(40) })));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });
  it("displays server rejection and preserves the written text", async () => {
    mocks.change.mockResolvedValue({ error: "퇴원 상세사유를 200자 이상 작성해 주세요." });
    render(<ReportDetail {...props} />);
    fireEvent.change(screen.getByLabelText("퇴원 상세사유"), { target: { value: "짧은 사유" } });
    fireEvent.click(screen.getByRole("button", { name: "관리자에게 제출" }));
    fireEvent.click(screen.getByRole("button", { name: "보고서 제출 확인" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("퇴원 상세사유")).toHaveValue("짧은 사유");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("requires a rejection reason and routes the decision to the current revision", async () => {
    render(<ReportDetail {...props} report={{ ...r, status: "manager_pending" }} userId={manager} />);
    expect(screen.queryByRole("button", { name: "관리자에게 제출" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "반려" }));
    expect(screen.getByRole("button", { name: "반려 확인" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("반려 사유"), { target: { value: "학부모 상담 내용을 보충해 주세요." } });
    fireEvent.click(screen.getByRole("button", { name: "반려 확인" }));
    await waitFor(() => expect(mocks.change).toHaveBeenCalledWith(r.id, "reject", 3, "학부모 상담 내용을 보충해 주세요."));
  });
  it("shows final withdrawal consequences before director approval", async () => {
    render(<ReportDetail {...props} report={{ ...r, status: "director_pending", manager_approved_at: r.created_at }} userId={director} />);
    fireEvent.click(screen.getByRole("button", { name: "승인" }));
    expect(screen.getByText(/전체 퇴원을 승인합니다/)).toBeInTheDocument();
    expect(mocks.change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "승인 확인" }));
    await waitFor(() => expect(mocks.change).toHaveBeenCalledWith(r.id, "approve", 3, undefined));
  });
  it("readonly views cannot submit, approve or cancel", () => {
    render(<ReportDetail {...props} writable={false} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "퇴원 상세사유" })).not.toBeInTheDocument();
  });
});
