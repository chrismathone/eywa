import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ReportList } from "./report-list";
import type { StaffOption, StudentOption } from "@/features/withdrawal-reports/model";
const mocks = vi.hoisted(() => ({ request: vi.fn(), inFrame: true }));
vi.mock("@/features/withdrawal-reports/server/actions", () => ({ requestWithdrawalReport: mocks.request }));
vi.mock("@/components/workspace/use-in-frame", () => ({ useInFrame: () => mocks.inFrame }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
const staff: StaffOption[] = [{ id: "teacher", name: "담당 강사", role: "teacher", subjects: ["math"] }, { id: "manager", name: "관리자", role: "admin", subjects: ["math"] }, { id: "director", name: "원장", role: "master", subjects: [] }];
const students: StudentOption[] = [{ id: "student", name: "학생", school: "학교", grade: "중1", courses: [{ id: "course", classId: "class", className: "수학반", subject: "math", teacherId: "teacher", teacherName: "담당 강사", startDate: "2026-01-01", endDate: null, onHold: false }] }];
const props = { reports: [], completedLimited: false, staff, students, labels: { math: "수학" }, userId: "manager", canRequest: true, scope: null };
let assign: ReturnType<typeof vi.spyOn>;
async function fill() {
  fireEvent.click(screen.getByRole("button", { name: "+ 보고서 작성 요청" }));
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByRole("button", { name: /^대상 학생:/ }));
  fireEvent.click(await screen.findByRole("button", { name: "학생 학교 중1" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "강사에게 작성 요청" })).toBeEnabled());
}
describe("compact request overlay and optional principal", () => {
  beforeEach(() => { cleanup(); mocks.request.mockReset(); mocks.inFrame = true; assign = vi.spyOn(window.location, "assign").mockImplementation(() => {}); });
  afterEach(() => { cleanup(); assign.mockRestore(); });
  it("requests without a principal, uses actual homeroom teachers and preserves embedded navigation", async () => {
    mocks.request.mockResolvedValue({ ok: true, id: "new-report" });
    render(<ReportList {...props} />); await fill();
    expect(screen.queryByLabelText("처리 구분")).not.toBeInTheDocument();
    expect(screen.getByText(/전체 퇴원 · 강사별 1건/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "강사에게 작성 요청" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ studentId: "student", teacherIds: ["teacher"], managerIds: ["manager"], directorIds: [], subjects: ["math"] })));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/withdrawal-reports?embed=1"));
  });
  it("keeps normal navigation outside a window", async () => {
    mocks.inFrame = false; mocks.request.mockResolvedValue({ ok: true, id: "new-report" });
    render(<ReportList {...props} />); await fill();
    fireEvent.click(screen.getByRole("button", { name: "강사에게 작성 요청" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/withdrawal-reports"));
  });
  it("keeps entered data when the server refuses a duplicate", async () => {
    mocks.request.mockResolvedValue({ error: "진행 중인 보고서가 있습니다." });
    render(<ReportList {...props} />); await fill();
    fireEvent.click(screen.getByRole("button", { name: "강사에게 작성 요청" }));
    expect((await screen.findByRole("alert")).textContent).toContain("진행 중");
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "대상 학생: 학생" })).toBeInTheDocument();
  });
});
