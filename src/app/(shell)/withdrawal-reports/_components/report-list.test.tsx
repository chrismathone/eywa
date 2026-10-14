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
async function closeOptions() {
  fireEvent.keyDown(screen.getByPlaceholderText("검색..."), { key: "Escape" });
  await waitFor(() => expect(screen.queryByPlaceholderText("검색...")).not.toBeInTheDocument());
}
const multiStaff: StaffOption[] = [
  { ...staff[0], subjects: ["math", "english"] },
  { id: "english-teacher", name: "영어 강사", role: "teacher", subjects: ["english"] },
  { ...staff[1], name: "수학 관리자" },
  { id: "math-manager-2", name: "수학 관리자2", role: "manager", subjects: ["math"] },
  { id: "english-manager", name: "영어 관리자", role: "admin", subjects: ["english"] },
  { id: "restricted-manager", name: "영어 범위 관리자", role: "admin", subjects: ["math", "english"], approvalSubjects: ["english"] },
  { id: "unassigned-manager", name: "과목 미지정 관리자", role: "admin", subjects: [] },
  staff[2],
];
const multiStudents: StudentOption[] = [{ ...students[0], courses: [students[0].courses[0], { ...students[0].courses[0], id: "english-course", classId: "english-class", className: "영어반", subject: "english", teacherId: "english-teacher", teacherName: "영어 강사" }] }];
const multiProps = { ...props, staff: multiStaff, students: multiStudents, labels: { math: "수학", english: "영어" } };
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
  it("shows managers only for selected authors' target subjects and respects personal approval scopes", async () => {
    render(<ReportList {...multiProps} />);
    fireEvent.click(screen.getByRole("button", { name: "+ 보고서 작성 요청" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "관리자 승인: 담당 강사를 먼저 선택" }));
    expect(await screen.findByText("결과 없음")).toBeInTheDocument();
    await closeOptions();
    fireEvent.click(screen.getByRole("button", { name: /^대상 학생:/ }));
    fireEvent.click(await screen.findByRole("button", { name: "학생 학교 중1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "영어" }));
    fireEvent.click(screen.getByRole("button", { name: /^관리자 승인:/ }));
    expect(await screen.findByRole("button", { name: "수학 관리자 수학" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "수학 관리자2 수학" })).toBeInTheDocument();
    for (const name of [/^영어 관리자 /, /^영어 범위 관리자 /, /^과목 미지정 관리자/, /^원장$/, /^담당 강사 /])
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  });
  it("reconciles manager selections after changing authors while preserving valid manual choices", async () => {
    mocks.request.mockResolvedValue({ ok: true, id: "new-report" });
    render(<ReportList {...multiProps} />); await fill();
    fireEvent.click(screen.getByRole("button", { name: /^관리자 승인:/ }));
    fireEvent.click(await screen.findByRole("button", { name: "수학 관리자2 수학" }));
    await closeOptions();
    fireEvent.click(screen.getByRole("button", { name: /^작성 강사:/ }));
    fireEvent.click(await screen.findByRole("button", { name: "영어 강사 영어" }));
    await closeOptions();
    expect(screen.getByRole("button", { name: "강사에게 작성 요청" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "관리자 승인: 수학 관리자" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^관리자 승인:/ }));
    expect(await screen.findByRole("button", { name: "수학 관리자2 수학" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "영어 관리자 영어" })).not.toBeInTheDocument();
    await closeOptions();
    fireEvent.click(screen.getByRole("button", { name: /^작성 강사:/ }));
    fireEvent.click(await screen.findByRole("button", { name: "영어 강사 영어" }));
    await closeOptions();
    fireEvent.click(screen.getByRole("button", { name: "강사에게 작성 요청" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ teacherIds: ["teacher", "english-teacher"], managerIds: ["manager", "english-manager", "restricted-manager"], subjects: ["math", "english"] })));
  });
  it("blocks requesting when no manager is assigned to the selected subject", async () => {
    render(<ReportList {...props} staff={staff.filter(u => u.id !== "manager")} />);
    fireEvent.click(screen.getByRole("button", { name: "+ 보고서 작성 요청" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: /^대상 학생:/ }));
    fireEvent.click(await screen.findByRole("button", { name: "학생 학교 중1" }));
    expect(await screen.findByText("선택할 수 있는 해당 과목 관리자가 없습니다. 담당 과목과 승인자 선택을 확인해 주세요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "강사에게 작성 요청" })).toBeDisabled();
  });
  it("does not send hidden stale managers if staff approval subjects change while the dialog is open", async () => {
    mocks.request.mockResolvedValue({ ok: true, id: "new-report" });
    const view = render(<ReportList {...props} staff={multiStaff} />); await fill();
    view.rerender(<ReportList {...props} staff={multiStaff.map(u => u.id === "manager" ? { ...u, approvalSubjects: ["english"] } : u)} />);
    expect(screen.getByRole("button", { name: "관리자 승인: 수학 관리자2" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "강사에게 작성 요청" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ managerIds: ["math-manager-2"] })));
  });
});
