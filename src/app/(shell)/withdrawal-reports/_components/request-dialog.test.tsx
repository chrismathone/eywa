import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { RequestDialog } from "./request-dialog";
import type { StaffOption, StudentOption } from "@/features/withdrawal-reports/model";
const mocks = vi.hoisted(() => ({ request: vi.fn(), direct: vi.fn(), lastLesson: vi.fn(), inFrame: true }));
vi.mock("@/features/withdrawal-reports/server/actions", () => ({ requestWithdrawalReport: mocks.request, processWithdrawalDirectly: mocks.direct }));
vi.mock("@/features/withdrawal-reports/server/last-lesson-actions", () => ({ loadLastLessonDate: mocks.lastLesson }));
vi.mock("@/components/workspace/use-in-frame", () => ({ useInFrame: () => mocks.inFrame }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
const staff: StaffOption[] = [{ id: "teacher", name: "담당 강사", role: "teacher", subjects: ["math"] }, { id: "manager", name: "관리자", role: "admin", subjects: ["math"] }, { id: "director", name: "원장", role: "master", subjects: [] }];
const students: StudentOption[] = [{ id: "student", name: "학생", school: "학교", grade: "중1", courses: [{ id: "course", classId: "class", className: "수학반", subject: "math", teacherId: "teacher", teacherName: "담당 강사", startDate: "2026-01-01", endDate: null, onHold: false }] }];
const props = { staff, students, labels: { math: "수학" }, scope: null };
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
  beforeEach(() => { cleanup(); mocks.request.mockReset(); mocks.lastLesson.mockReset(); mocks.lastLesson.mockResolvedValue({ date: null }); mocks.inFrame = true; assign = vi.spyOn(window.location, "assign").mockImplementation(() => {}); });
  afterEach(() => { cleanup(); assign.mockRestore(); });
  it("requests without a principal, uses actual homeroom teachers and preserves embedded navigation", async () => {
    mocks.request.mockResolvedValue({ ok: true, id: "new-report" });
    render(<RequestDialog {...props} />); await fill();
    expect(screen.queryByLabelText("처리 구분")).not.toBeInTheDocument();
    expect(screen.getByText(/퇴원 · 1개 반 · 보고서 1건/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "강사에게 작성 요청" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ studentId: "student", teacherIds: ["teacher"], managerIds: ["manager"], subjects: ["math"] })));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/withdrawal-reports?embed=1"));
  });
  it("keeps normal navigation outside a window", async () => {
    mocks.inFrame = false; mocks.request.mockResolvedValue({ ok: true, id: "new-report" });
    render(<RequestDialog {...props} />); await fill();
    fireEvent.click(screen.getByRole("button", { name: "강사에게 작성 요청" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/withdrawal-reports"));
  });
  it.each(["teacher", "second-teacher"])("selects one of two math classes without closing the other (%s)", async secondTeacher => {
    mocks.request.mockResolvedValue({ ok: true, id: "new-report" });
    const extra = { ...students[0].courses[0], id: "second-course", classId: "second-class", className: "수학 보충반", teacherId: secondTeacher };
    render(<RequestDialog {...props} staff={[...staff, { ...staff[0], id: "second-teacher", name: "다른 강사" }]} students={[{ ...students[0], courses: [...students[0].courses, extra] }]} />);
    await fill();
    expect(screen.getByText("퇴원 · 2개 반 · 보고서 1건")).toBeInTheDocument();
    expect(screen.getAllByRole("note")[0]).toHaveTextContent(/수학 수업 2개를 모두 종료합니다 — .*수학 보충반/);
    fireEvent.click(screen.getByRole("checkbox", { name: "수학 보충반 · 수학 · 담당 강사" }));
    expect(screen.getByText("종료할 반을 선택해 주세요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "강사에게 작성 요청" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "수학반 · 수학 · 담당 강사" }));
    // 반을 바꾸면 마지막 수업일을 출결에서 다시 찾는 동안 요청 버튼이 잠긴다(오늘 날짜로 먼저 나가지 않게).
    await waitFor(() => expect(screen.getByRole("button", { name: "강사에게 작성 요청" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "강사에게 작성 요청" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ enrollmentIds: expect.arrayContaining(["course", "second-course"]), subjects: ["math"], teacherIds: ["teacher"] })));
  });
  it("작성 강사가 그 과목 관리자면 관리자 승인을 생략한다 — 승인 관리자 0명 · 원장 칸 없음(원장 2026-11-03)", async () => {
    mocks.request.mockResolvedValue({ ok: true, id: "new-report" });
    const own = [{ ...students[0], courses: [{ ...students[0].courses[0], teacherId: "manager", teacherName: "관리자" }] }];
    render(<RequestDialog {...props} students={own} />); await fill();
    expect(screen.getByText(/관리자 승인 생략 — 작성 강사가 이 과목 관리자입니다\./)).toBeInTheDocument();
    expect(screen.getByLabelText("관리자 승인")).toHaveTextContent("생략 — 작성 강사가 과목 관리자");
    expect(screen.queryByText(/원장 승인/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "강사에게 작성 요청" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ teacherIds: ["manager"], managerIds: [], reportManagerIds: { manager: [] } })));
    expect(mocks.request.mock.calls[0][0]).not.toHaveProperty("directorIds");
  });
  it("과목이 섞이면 보고서마다 — 영어(작성 강사 = 영어 관리자)는 생략, 수학(평강사)은 수학 관리자만 승인(원장 2026-11-03)", async () => {
    mocks.request.mockResolvedValue({ ok: true, id: "new-report" });
    const mixed = [{ ...multiStudents[0], courses: [multiStudents[0].courses[0], { ...multiStudents[0].courses[1], teacherId: "english-manager", teacherName: "영어 관리자" }] }];
    render(<RequestDialog {...multiProps} students={mixed} />); await fill();
    const lines = screen.getByRole("note", { name: "보고서별 승인" });
    expect(lines).toHaveTextContent("담당 강사 · 수학 보고서 — 수학 관리자, 수학 관리자2 승인");
    expect(lines).toHaveTextContent("영어 관리자 · 영어 보고서 — 관리자 승인 생략(작성 강사가 과목 관리자)");
    fireEvent.click(screen.getByRole("button", { name: "강사에게 작성 요청" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({
      teacherIds: ["teacher", "english-manager"], reportManagerIds: { teacher: ["manager", "math-manager-2"], "english-manager": [] } })));
  });
  it("보고서 하나라도 승인할 관리자를 안 고르면 요청할 수 없다", async () => {
    render(<RequestDialog {...multiProps} />); await fill();
    fireEvent.click(screen.getByRole("button", { name: /^관리자 승인:/ }));
    fireEvent.click(await screen.findByRole("button", { name: "영어 관리자 영어" }));
    fireEvent.click(screen.getByRole("button", { name: "영어 범위 관리자 영어" }));
    await closeOptions();
    expect(screen.getByRole("note", { name: "보고서별 승인" })).toHaveTextContent("영어 강사 · 영어 보고서 — 승인할 관리자를 골라 주세요");
    expect(screen.getByRole("button", { name: "강사에게 작성 요청" })).toBeDisabled();
  });
  it("마지막 수업일 — 학생·반을 고르면 출결에서 채우고 출처를 적는다 · 직접 고친 값은 반을 바꿔도 덮지 않는다", async () => {
    mocks.lastLesson.mockResolvedValue({ date: "2026-10-28" });
    const extra = { ...students[0].courses[0], id: "english-course", classId: "english-class", className: "영어반", subject: "english" };
    render(<RequestDialog {...props} staff={[...staff, { id: "em", name: "영어 관리자", role: "admin", subjects: ["english"] }]} students={[{ ...students[0], courses: [...students[0].courses, extra] }]} labels={{ math: "수학", english: "영어" }} />);
    await fill();
    await waitFor(() => expect(screen.getByLabelText("마지막 수업일")).toHaveValue("2026-10-28"));
    expect(mocks.lastLesson).toHaveBeenCalledWith({ studentId: "student", enrollmentIds: ["course", "english-course"] });
    expect(screen.getByText("출결 기준 — 고른 반의 마지막 출석일")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("마지막 수업일"), { target: { value: "2026-10-30" } });
    expect(screen.getByText("직접 입력한 날짜")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "영어반 · 영어 · 담당 강사" }));
    expect(mocks.lastLesson).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("마지막 수업일")).toHaveValue("2026-10-30");
    fireEvent.click(screen.getByRole("button", { name: "강사에게 작성 요청" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ effectiveDate: "2026-10-30", enrollmentIds: ["course"] })));
  });
  it("출결 기록이 없으면 오늘 · 그렇게 적는다", async () => {
    render(<RequestDialog {...props} />); await fill();
    expect(await screen.findByText("출결 기록 없음 → 오늘")).toBeInTheDocument();
  });
  it("keeps entered data when the server refuses a duplicate", async () => {
    mocks.request.mockResolvedValue({ error: "진행 중인 보고서가 있습니다." });
    render(<RequestDialog {...props} />); await fill();
    fireEvent.click(screen.getByRole("button", { name: "강사에게 작성 요청" }));
    expect((await screen.findByRole("alert")).textContent).toContain("진행 중");
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "대상 학생: 학생" })).toBeInTheDocument();
  });
  it("fixes the author to each subject's homeroom teacher — there is no author picker", async () => {
    mocks.request.mockResolvedValue({ ok: true, id: "new-report" });
    render(<RequestDialog {...multiProps} />); await fill();
    expect(screen.queryByRole("button", { name: /^작성 강사:/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("작성 강사")).toHaveTextContent("담당 강사, 영어 강사");
    expect(screen.getByText("퇴원 · 2개 반 · 보고서 2건")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "강사에게 작성 요청" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ teacherIds: ["teacher", "english-teacher"], enrollmentIds: ["course", "english-course"], subjects: ["math", "english"] })));
  });
  it("shows managers only for selected authors' target subjects and respects personal approval scopes", async () => {
    render(<RequestDialog {...multiProps} />);
    fireEvent.click(screen.getByRole("button", { name: "+ 보고서 작성 요청" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "관리자 승인: 반을 먼저 선택" }));
    expect(await screen.findByText("결과 없음")).toBeInTheDocument();
    await closeOptions();
    fireEvent.click(screen.getByRole("button", { name: /^대상 학생:/ }));
    fireEvent.click(await screen.findByRole("button", { name: "학생 학교 중1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "영어반 · 영어 · 영어 강사" }));
    fireEvent.click(screen.getByRole("button", { name: /^관리자 승인:/ }));
    expect(await screen.findByRole("button", { name: "수학 관리자 수학" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "수학 관리자2 수학" })).toBeInTheDocument();
    for (const name of [/^영어 관리자 /, /^영어 범위 관리자 /, /^과목 미지정 관리자/, /^원장$/, /^담당 강사 /])
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  });
  it("blocks requesting when no manager is assigned to the selected subject", async () => {
    render(<RequestDialog {...props} staff={staff.filter(u => u.id !== "manager")} />);
    fireEvent.click(screen.getByRole("button", { name: "+ 보고서 작성 요청" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: /^대상 학생:/ }));
    fireEvent.click(await screen.findByRole("button", { name: "학생 학교 중1" }));
    expect(await screen.findByText("선택할 수 있는 해당 과목 관리자가 없습니다. 담당 과목과 승인자 선택을 확인해 주세요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "강사에게 작성 요청" })).toBeDisabled();
  });
  it("does not send hidden stale managers if staff approval subjects change while the dialog is open", async () => {
    mocks.request.mockResolvedValue({ ok: true, id: "new-report" });
    const view = render(<RequestDialog {...props} staff={multiStaff} />); await fill();
    view.rerender(<RequestDialog {...props} staff={multiStaff.map(u => u.id === "manager" ? { ...u, approvalSubjects: ["english"] } : u)} />);
    expect(screen.getByRole("button", { name: "관리자 승인: 수학 관리자2" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "강사에게 작성 요청" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ managerIds: ["math-manager-2"] })));
  });
});

/** 관리자 바로 처리(강사 작성 없이) — 원장 2026-10-23. 원생 화면의 '퇴원보고서'가 `?request=`로 그 학생을 고른 채 연다. */
describe("direct processing without teacher writing", () => {
  const noCourse: StudentOption = { id: "alone", name: "수강없음", school: "학교", grade: "중2", courses: [] };
  beforeEach(() => { cleanup(); mocks.direct.mockReset(); mocks.request.mockReset(); mocks.lastLesson.mockReset(); mocks.lastLesson.mockResolvedValue({ date: null }); mocks.inFrame = false; assign = vi.spyOn(window.location, "assign").mockImplementation(() => {}); });
  afterEach(() => { cleanup(); assign.mockRestore(); });
  it("hides the option until the database is ready", async () => {
    render(<RequestDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "+ 보고서 작성 요청" }));
    await screen.findByRole("dialog");
    expect(screen.queryByRole("radio", { name: "강사 작성 없이 바로 처리" })).not.toBeInTheDocument();
  });
  it("opens for the chosen student and processes the selected classes with the picked reason", async () => {
    mocks.direct.mockResolvedValue({ ok: true, id: "direct-report" });
    render(<RequestDialog {...props} directReady initialStudentId="student" />);
    await screen.findByRole("dialog");
    expect(screen.getByRole("button", { name: "대상 학생: 학생" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "강사 작성 없이 바로 처리" }));
    expect(screen.queryByRole("button", { name: /^작성 강사:/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("퇴원·종료 사유"), { target: { value: "relocation" } });
    fireEvent.click(screen.getByRole("button", { name: "바로 퇴원 처리" }));
    await waitFor(() => expect(mocks.direct).toHaveBeenCalledWith(expect.objectContaining({ studentId: "student", enrollmentIds: ["course"], reason: "relocation" })));
    expect(mocks.request).not.toHaveBeenCalled();
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/withdrawal-reports/direct-report"));
  });
  it("a student without classes opens straight into direct withdrawal and is not offered for teacher requests", async () => {
    mocks.direct.mockResolvedValue({ ok: true, id: "r2" });
    render(<RequestDialog {...props} students={[...students, noCourse]} directReady initialStudentId="alone" />);
    await screen.findByRole("dialog");
    expect(screen.getByRole("radio", { name: "강사 작성 없이 바로 처리" })).toBeChecked();
    expect(screen.getByText("지금 다니는 반이 없는 원생이라 퇴원으로 처리합니다.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("퇴원·종료 사유"), { target: { value: "other" } });
    // '기타'는 메모가 필요하다 — 비어 있으면 보내지 않는다(서버도 같은 규칙).
    fireEvent.click(screen.getByRole("button", { name: "바로 퇴원 처리" }));
    expect(mocks.direct).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: /메모/ }), { target: { value: "가족 사정" } });
    fireEvent.click(screen.getByRole("button", { name: "바로 퇴원 처리" }));
    await waitFor(() => expect(mocks.direct).toHaveBeenCalledWith(expect.objectContaining({ studentId: "alone", enrollmentIds: [], reason: "other", memo: "가족 사정" })));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/withdrawal-reports/r2"));
    // 작성 요청 모드로 바꾸면 반 없는 원생은 고를 수 없다(담임이 없다).
    await waitFor(() => expect(screen.getByRole("button", { name: "바로 퇴원 처리" })).toBeEnabled());
    fireEvent.click(screen.getByRole("radio", { name: "강사에게 작성 요청" }));
    expect(screen.getByRole("button", { name: "대상 학생: 학생 검색·선택" })).toBeInTheDocument();
  });
  it("keeps the dialog and shows the reason when the server refuses", async () => {
    mocks.direct.mockResolvedValue({ error: "이 학생의 진행 중인 보고서가 있습니다." });
    render(<RequestDialog {...props} directReady initialStudentId="student" />);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("radio", { name: "강사 작성 없이 바로 처리" }));
    fireEvent.change(screen.getByLabelText("퇴원·종료 사유"), { target: { value: "graduated" } });
    fireEvent.click(screen.getByRole("button", { name: "바로 퇴원 처리" }));
    expect((await screen.findByRole("alert")).textContent).toContain("진행 중");
    expect(assign).not.toHaveBeenCalled();
  });
});
