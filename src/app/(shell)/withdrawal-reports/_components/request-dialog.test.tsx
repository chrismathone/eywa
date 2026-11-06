import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { RequestDialog } from "./request-dialog";
import type { StaffOption, StudentOption } from "@/features/withdrawal-reports/model";
import { kstToday } from "@/lib/date-kst";
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
  it("출결 기록이 없으면 오늘 · 눈에 띄는 알림으로 적는다(원장 2026-11-05 — 조회되지 않음 알림)", async () => {
    render(<RequestDialog {...props} />); await fill();
    const notice = await screen.findByText("고른 반에서 출석 기록을 찾지 못했습니다 — 마지막 수업일을 직접 확인해 입력해 주세요(지금은 오늘 날짜).");
    expect(notice).toHaveAttribute("role", "status");
    expect(notice).toHaveClass("text-att-late-ink");
    // 기록 없음은 오류가 아니다 — 다시 불러오기 단추는 손으로 고쳤거나 오류일 때만.
    expect(screen.queryByRole("button", { name: "출결에서 다시 불러오기" })).not.toBeInTheDocument();
  });
  it("권한 없음·오류는 까닭에 맞는 알림 · 오류면 다시 불러오기 단추(원장 2026-11-05)", async () => {
    mocks.lastLesson.mockResolvedValueOnce({ date: null, denied: true });
    const view = render(<RequestDialog {...props} />); await fill();
    expect(await screen.findByText(/출결을 볼 권한이 없어 마지막 수업일을 찾지 못했습니다/)).toHaveClass("text-att-late-ink");
    expect(screen.queryByRole("button", { name: "출결에서 다시 불러오기" })).not.toBeInTheDocument();
    view.unmount();
    mocks.lastLesson.mockResolvedValueOnce({ error: "수강 정보를 확인하지 못했습니다." });
    render(<RequestDialog {...props} />); await fill();
    expect(await screen.findByText(/출결을 불러오지 못했습니다 — ‘출결에서 다시 불러오기’를 누르거나/)).toHaveAttribute("role", "status");
    mocks.lastLesson.mockResolvedValueOnce({ date: "2026-10-21" });
    fireEvent.click(screen.getByRole("button", { name: "출결에서 다시 불러오기" }));
    await waitFor(() => expect(screen.getByLabelText("마지막 수업일")).toHaveValue("2026-10-21"));
    expect(screen.getByRole("status")).toHaveTextContent("출결 기준 — 고른 반의 마지막 출석일");
    expect(screen.queryByRole("button", { name: "출결에서 다시 불러오기" })).not.toBeInTheDocument();
  });
  it("잘못 고친 날짜를 출결에서 다시 불러온다 — 조회 중엔 단추를 끄고, 그 값으로 요청한다(원장 2026-11-05)", async () => {
    mocks.lastLesson.mockResolvedValueOnce({ date: "2026-10-28" });
    mocks.request.mockResolvedValue({ ok: true, id: "new-report" });
    render(<RequestDialog {...props} />); await fill();
    await waitFor(() => expect(screen.getByLabelText("마지막 수업일")).toHaveValue("2026-10-28"));
    expect(screen.queryByRole("button", { name: "출결에서 다시 불러오기" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("마지막 수업일"), { target: { value: "2026-11-30" } });
    expect(screen.getByText("직접 입력한 날짜")).toBeInTheDocument();
    let answer!: (v: { date: string }) => void;
    mocks.lastLesson.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "출결에서 다시 불러오기" }));
    expect(mocks.lastLesson).toHaveBeenLastCalledWith({ studentId: "student", enrollmentIds: ["course"] });
    expect(screen.getByRole("button", { name: "출결에서 다시 불러오기" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "강사에게 작성 요청" })).toBeDisabled();
    answer({ date: "2026-10-28" });
    await waitFor(() => expect(screen.getByLabelText("마지막 수업일")).toHaveValue("2026-10-28"));
    expect(screen.getByRole("status")).toHaveTextContent("출결 기준 — 고른 반의 마지막 출석일");
    fireEvent.click(screen.getByRole("button", { name: "강사에게 작성 요청" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ effectiveDate: "2026-10-28" })));
  });
  it("다시 불러오는 사이 반을 바꾸면 늦게 온 옛 응답이 새 선택을 덮지 않는다", async () => {
    const extra = { ...students[0].courses[0], id: "english-course", classId: "english-class", className: "영어반", subject: "english" };
    mocks.lastLesson.mockResolvedValueOnce({ date: "2026-10-28" });
    render(<RequestDialog {...props} staff={[...staff, { id: "em", name: "영어 관리자", role: "admin", subjects: ["english"] }]} students={[{ ...students[0], courses: [...students[0].courses, extra] }]} labels={{ math: "수학", english: "영어" }} />);
    await fill();
    await waitFor(() => expect(screen.getByLabelText("마지막 수업일")).toHaveValue("2026-10-28"));
    fireEvent.change(screen.getByLabelText("마지막 수업일"), { target: { value: "2026-11-30" } });
    let stale!: (v: { date: string }) => void;
    let fresh!: (v: { date: string }) => void;
    mocks.lastLesson.mockImplementationOnce(() => new Promise(resolve => { stale = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "출결에서 다시 불러오기" }));
    mocks.lastLesson.mockImplementationOnce(() => new Promise(resolve => { fresh = resolve; }));
    fireEvent.click(screen.getByRole("checkbox", { name: "영어반 · 영어 · 담당 강사" }));
    expect(mocks.lastLesson).toHaveBeenLastCalledWith({ studentId: "student", enrollmentIds: ["course"] });
    fresh({ date: "2026-10-25" });
    await waitFor(() => expect(screen.getByLabelText("마지막 수업일")).toHaveValue("2026-10-25"));
    stale({ date: "2026-10-28" });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(screen.getByLabelText("마지막 수업일")).toHaveValue("2026-10-25");
  });
  it("다시 불러오는 중에 반을 모두 끄면 늦은 응답이 덮지 않고 '반을 고르는 중' 흐린 안내 · 반을 다시 고르면 출결을 찾는다(리뷰 2026-11-06)", async () => {
    mocks.lastLesson.mockResolvedValueOnce({ date: "2026-10-28" });
    render(<RequestDialog {...props} />); await fill();
    await waitFor(() => expect(screen.getByLabelText("마지막 수업일")).toHaveValue("2026-10-28"));
    fireEvent.change(screen.getByLabelText("마지막 수업일"), { target: { value: "2026-11-30" } });
    let late!: (v: { date: string }) => void;
    mocks.lastLesson.mockImplementationOnce(() => new Promise(resolve => { late = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "출결에서 다시 불러오기" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "수학반 · 수학 · 담당 강사" }));
    const hint = screen.getByText("종료할 반을 고르면 출결에서 찾습니다");
    expect(hint).toHaveAttribute("role", "status");
    expect(hint).not.toHaveClass("text-att-late-ink");
    late({ date: "2026-10-28" });
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(screen.getByRole("status")).toHaveTextContent("종료할 반을 고르면 출결에서 찾습니다");
    // 다시 불러오는 중이라 지키기로 한 날짜(손으로 고친 11-30)는 그대로(리뷰 2026-11-06 2차).
    expect(screen.getByLabelText("마지막 수업일")).toHaveValue("2026-11-30");
    mocks.lastLesson.mockResolvedValueOnce({ date: "2026-10-27" });
    fireEvent.click(screen.getByRole("checkbox", { name: "수학반 · 수학 · 담당 강사" }));
    await waitFor(() => expect(screen.getByLabelText("마지막 수업일")).toHaveValue("2026-10-27"));
    expect(mocks.lastLesson).toHaveBeenLastCalledWith({ studentId: "student", enrollmentIds: ["course"] });
  });
  it("반을 모두 끄면(다시 불러오는 중이 아님) 흐린 안내 · 빈칸(원장 2026-11-06 — 고르기 전 오늘 날짜 없음) · 다시 고르면 출결을 찾는다", async () => {
    mocks.lastLesson.mockResolvedValueOnce({ date: "2026-10-28" });
    render(<RequestDialog {...props} />); await fill();
    await waitFor(() => expect(screen.getByLabelText("마지막 수업일")).toHaveValue("2026-10-28"));
    fireEvent.click(screen.getByRole("checkbox", { name: "수학반 · 수학 · 담당 강사" }));
    expect(screen.getByRole("status")).toHaveTextContent("종료할 반을 고르면 출결에서 찾습니다");
    expect(screen.getByRole("status")).not.toHaveClass("text-att-late-ink");
    expect(screen.getByLabelText("마지막 수업일")).toHaveValue("");
    expect(screen.getByRole("button", { name: "강사에게 작성 요청" })).toBeDisabled();
    mocks.lastLesson.mockResolvedValueOnce({ date: "2026-10-21" });
    fireEvent.click(screen.getByRole("checkbox", { name: "수학반 · 수학 · 담당 강사" }));
    await waitFor(() => expect(screen.getByLabelText("마지막 수업일")).toHaveValue("2026-10-21"));
  });
  it("출결 권한이 없다는 답을 받으면 손으로 고쳐도 다시 불러오기 단추를 숨긴다(리뷰 2026-11-06)", async () => {
    mocks.lastLesson.mockResolvedValue({ date: null, denied: true });
    render(<RequestDialog {...props} />); await fill();
    expect(await screen.findByText(/출결을 볼 권한이 없어/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("마지막 수업일"), { target: { value: "2026-10-15" } });
    expect(screen.getByText("직접 입력한 날짜")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "출결에서 다시 불러오기" })).not.toBeInTheDocument();
    expect(mocks.lastLesson).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["오류", { error: "출결을 불러오지 못했습니다." }, "출결을 불러오지 못해 마지막 수업일 칸의 날짜를 그대로 두었습니다"],
    ["기록 없음", { date: null }, "고른 반에서 출석 기록을 찾지 못해 마지막 수업일 칸의 날짜를 그대로 두었습니다"],
    ["권한 없음", { date: null, denied: true }, "출결을 볼 권한이 없어 마지막 수업일 칸의 날짜를 그대로 두었습니다"],
  ])("다시 불러오기가 실패하면(%s) 손으로 넣은 날짜를 지우지 않고 그 날짜로 요청한다 — 이 날짜가 곧 수강 종료일(리뷰 2026-11-06)", async (_label, answer, notice) => {
    mocks.lastLesson.mockResolvedValueOnce({ date: "2026-10-28" });
    mocks.request.mockResolvedValue({ ok: true, id: "new-report" });
    render(<RequestDialog {...props} />); await fill();
    await waitFor(() => expect(screen.getByLabelText("마지막 수업일")).toHaveValue("2026-10-28"));
    fireEvent.change(screen.getByLabelText("마지막 수업일"), { target: { value: "2026-10-20" } });
    mocks.lastLesson.mockResolvedValueOnce(answer);
    fireEvent.click(screen.getByRole("button", { name: "출결에서 다시 불러오기" }));
    expect(await screen.findByText(new RegExp(notice))).toHaveClass("text-att-late-ink");
    expect(screen.getByLabelText("마지막 수업일")).toHaveValue("2026-10-20");
    fireEvent.click(screen.getByRole("button", { name: "강사에게 작성 요청" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ effectiveDate: "2026-10-20" })));
  });
  it("지정 명단이 무효(지정자 퇴사 등)면 승인자 없음 — 학원 설정 안내 · 요청 불가 · 지정 밖 관리자는 후보가 아니다(리뷰 2026-11-06)", async () => {
    const invalid: StaffOption[] = [{ ...staff[0], withdrawalApprover: false }, { ...staff[1], withdrawalApprover: false }, { ...staff[2], withdrawalApprover: false }];
    render(<RequestDialog {...props} staff={invalid} />);
    fireEvent.click(screen.getByRole("button", { name: "+ 보고서 작성 요청" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: /^대상 학생:/ }));
    fireEvent.click(await screen.findByRole("button", { name: "학생 학교 중1" }));
    expect(await screen.findByText("지정된 퇴원보고서 승인자가 없습니다 — 학원 설정에서 지정해 주세요")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/출석 기록을 찾지 못했습니다/));
    expect(screen.getByRole("button", { name: "강사에게 작성 요청" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /^관리자 승인:/ }));
    expect(await screen.findByText("결과 없음")).toBeInTheDocument();
  });
  it("보고서별 승인 안내 — 승인자는 직급으로, 작성 강사는 이름만(원장 2026-11-05 · 리뷰 2026-11-06)", async () => {
    const titled: StaffOption[] = [
      { id: "teacher", name: "담당 강사", role: "teacher", subjects: ["math"], jobTitle: "전임강사", withdrawalApprover: false },
      { id: "heo", name: "허은진", role: "admin", subjects: ["math"], jobTitle: "부원장", withdrawalApprover: true },
      { id: "jung", name: "정유진", role: "admin", subjects: ["english"], jobTitle: "부원장", withdrawalApprover: true },
    ];
    const both = [{ ...students[0], courses: [students[0].courses[0], { ...students[0].courses[0], id: "english-course", classId: "english-class", className: "영어반", subject: "english", teacherId: "jung", teacherName: "정유진" }] }];
    render(<RequestDialog {...props} staff={titled} students={both} labels={{ math: "수학", english: "영어" }} />); await fill();
    const lines = screen.getByRole("note", { name: "보고서별 승인" });
    expect(lines).toHaveTextContent("담당 강사 · 수학 보고서 — 허은진 부원장 승인");
    expect(lines).toHaveTextContent("정유진 · 영어 보고서 — 관리자 승인 생략");
    expect(lines).not.toHaveTextContent("전임강사");
    expect(lines).not.toHaveTextContent("정유진 부원장 · 영어");
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
  it("지정 승인자만 · 직급으로 적고 원장은 고를 수 없다(원장 2026-11-05 — 김그린이 쓴 영어 보고서는 정유진 부원장)", async () => {
    mocks.request.mockResolvedValue({ ok: true, id: "new-report" });
    const chimsan: StaffOption[] = [
      { id: "wonil", name: "원일", role: "master", subjects: ["english"], jobTitle: "대표" },
      { id: "jung", name: "정유진", role: "admin", subjects: ["english"], approvalSubjects: [], jobTitle: "부원장", withdrawalApprover: true },
      { id: "heo", name: "허은진", role: "admin", subjects: ["math"], jobTitle: "부원장", withdrawalApprover: true },
      { id: "green", name: "김그린", role: "admin", subjects: ["english"], approvalSubjects: [], jobTitle: null },
    ];
    const english = [{ ...students[0], courses: [{ ...students[0].courses[0], subject: "english", teacherId: "green", teacherName: "김그린" }] }];
    render(<RequestDialog {...props} staff={chimsan} students={english} labels={{ english: "영어", math: "수학" }} />); await fill();
    fireEvent.click(screen.getByRole("button", { name: /^관리자 승인:/ }));
    expect(await screen.findByRole("button", { name: /^정유진 부원장/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^허은진 부원장/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^원일/ })).not.toBeInTheDocument();
    await closeOptions();
    fireEvent.click(screen.getByRole("button", { name: "강사에게 작성 요청" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ teacherIds: ["green"], reportManagerIds: { green: ["jung", "heo"] } })));
  });
  it("작성 강사가 지정 승인자 본인이면 생략 — 원장으로 대신하지 않는다(김다예 · 원장 2026-11-05)", async () => {
    mocks.request.mockResolvedValue({ ok: true, id: "new-report" });
    const chimsan: StaffOption[] = [
      { id: "wonil", name: "원일", role: "master", subjects: [], jobTitle: "대표" },
      { id: "jung", name: "정유진", role: "admin", subjects: ["english"], jobTitle: "부원장", withdrawalApprover: true },
      { id: "heo", name: "허은진", role: "admin", subjects: ["math"], jobTitle: "부원장", withdrawalApprover: true },
    ];
    const english = [{ ...students[0], courses: [{ ...students[0].courses[0], subject: "english", teacherId: "jung", teacherName: "정유진" }] }];
    render(<RequestDialog {...props} staff={chimsan} students={english} labels={{ english: "영어", math: "수학" }} />); await fill();
    expect(screen.getByLabelText("관리자 승인")).toHaveTextContent("생략");
    fireEvent.click(screen.getByRole("button", { name: "강사에게 작성 요청" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ teacherIds: ["jung"], managerIds: [], reportManagerIds: { jung: [] } })));
  });
  it("does not send hidden stale managers if staff approval subjects change while the dialog is open", async () => {
    mocks.request.mockResolvedValue({ ok: true, id: "new-report" });
    const view = render(<RequestDialog {...props} staff={multiStaff} />); await fill();
    view.rerender(<RequestDialog {...props} staff={multiStaff.map(u => u.id === "manager" ? { ...u, approvalSubjects: ["english"] } : u)} />);
    expect(screen.getByRole("button", { name: "관리자 승인: 수학 관리자2" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "강사에게 작성 요청" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ managerIds: ["math-manager-2"] })));
  });
  it("학생을 고르기 전 마지막 수업일은 빈칸 · 안내는 날짜 칸 바로 아래(오른쪽 칸 · 원장 2026-11-06)", async () => {
    render(<RequestDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "+ 보고서 작성 요청" }));
    await screen.findByRole("dialog");
    expect(screen.getByLabelText("마지막 수업일")).toHaveValue("");
    const hint = screen.getByRole("status");
    expect(hint).toHaveTextContent("학생과 반을 고르면 출결에서 채웁니다");
    expect(hint).toHaveClass("sm:col-start-2");
    expect(hint).not.toHaveClass("sm:col-span-2");
    // 고르기 전에 손으로 넣은 날짜는 그 학생을 고르면 출결로 바뀐다(새 학생 = 출결에서 다시) · ‘직접 입력한 날짜’도 날짜 칸 아래.
    fireEvent.change(screen.getByLabelText("마지막 수업일"), { target: { value: "2026-10-02" } });
    expect(screen.getByRole("status")).toHaveTextContent("직접 입력한 날짜");
    expect(screen.getByRole("status")).toHaveClass("sm:col-start-2");
    mocks.lastLesson.mockResolvedValueOnce({ date: "2026-10-28" });
    fireEvent.click(screen.getByRole("button", { name: /^대상 학생:/ }));
    fireEvent.click(await screen.findByRole("button", { name: "학생 학교 중1" }));
    await waitFor(() => expect(screen.getByLabelText("마지막 수업일")).toHaveValue("2026-10-28"));
  });
  it("날짜 칸을 손으로 비우면 요청 단추를 막고 칸 아래에 알린다(서버 형식 오류가 영문으로 뜨지 않게)", async () => {
    mocks.lastLesson.mockResolvedValueOnce({ date: "2026-10-28" });
    render(<RequestDialog {...props} />); await fill();
    await waitFor(() => expect(screen.getByLabelText("마지막 수업일")).toHaveValue("2026-10-28"));
    fireEvent.change(screen.getByLabelText("마지막 수업일"), { target: { value: "" } });
    const hint = screen.getByRole("status");
    expect(hint).toHaveTextContent("마지막 수업일을 입력해 주세요.");
    expect(hint).toHaveClass("text-att-late-ink");
    expect(hint).toHaveClass("sm:col-start-2"); // 날짜 칸 아래 짧은 글씨(두 칸 상자가 아니다)
    expect(hint).not.toHaveClass("sm:col-span-2");
    expect(screen.getByRole("button", { name: "강사에게 작성 요청" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("마지막 수업일"), { target: { value: "2026-10-27" } });
    expect(screen.getByRole("button", { name: "강사에게 작성 요청" })).toBeEnabled();
  });
  it("다른 학생을 고르면 앞 학생의 날짜를 남기지 않는다 — 찾는 동안 빈칸 · 단추 잠김", async () => {
    const other: StudentOption = { ...students[0], id: "student2", name: "학생2", grade: "중2", courses: [{ ...students[0].courses[0], id: "course2" }] };
    mocks.lastLesson.mockResolvedValueOnce({ date: "2026-10-28" });
    render(<RequestDialog {...props} students={[...students, other]} />); await fill();
    await waitFor(() => expect(screen.getByLabelText("마지막 수업일")).toHaveValue("2026-10-28"));
    let answer!: (v: { date: string }) => void;
    mocks.lastLesson.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: /^대상 학생:/ }));
    fireEvent.click(await screen.findByRole("button", { name: "학생2 학교 중2" }));
    expect(screen.getByLabelText("마지막 수업일")).toHaveValue("");
    expect(screen.getByRole("button", { name: "강사에게 작성 요청" })).toBeDisabled();
    answer({ date: "2026-10-24" });
    await waitFor(() => expect(screen.getByLabelText("마지막 수업일")).toHaveValue("2026-10-24"));
  });
});

/** 2차 재리뷰(2026-11-06) — 다시 불러오기 실패 때 날짜 유지의 경쟁 조건 · 되살린 뒤 반을 바꿀 때 · '승인자 없음' 까닭 구분. */
describe("마지막 수업일 날짜 유지 · 승인자 없음 안내(재리뷰)", () => {
  const twoStaff: StaffOption[] = [{ id: "teacher", name: "담당 강사", role: "teacher", subjects: ["math", "english"] }, { id: "manager", name: "관리자", role: "admin", subjects: ["math", "english"] }];
  const mathCourse = students[0].courses[0];
  const engCourse = { ...mathCourse, id: "eng", classId: "eng-class", className: "영어반", subject: "english" };
  const two = { ...props, staff: twoStaff, students: [{ ...students[0], courses: [mathCourse, engCourse] }], labels: { math: "수학", english: "영어" } };
  async function pick() {
    fireEvent.click(screen.getByRole("button", { name: "+ 보고서 작성 요청" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: /^대상 학생:/ }));
    fireEvent.click(await screen.findByRole("button", { name: "학생 학교 중1" }));
  }
  const dateBox = () => screen.getByLabelText("마지막 수업일");
  const reloadBtn = () => screen.queryByRole("button", { name: "출결에서 다시 불러오기" });
  beforeEach(() => { cleanup(); mocks.lastLesson.mockReset(); mocks.request.mockReset(); mocks.direct.mockReset(); mocks.lastLesson.mockResolvedValue({ date: null }); mocks.inFrame = false; assign = vi.spyOn(window.location, "assign").mockImplementation(() => {}); });
  afterEach(() => { cleanup(); assign.mockRestore(); });
  it("기준 — 손으로 고친 뒤 다시 불러오기가 '기록 없음'이면 고친 날짜를 그대로 둔다", async () => {
    mocks.lastLesson.mockResolvedValueOnce({ date: "2026-10-28" });
    render(<RequestDialog {...two} />); await pick();
    await waitFor(() => expect(dateBox()).toHaveValue("2026-10-28"));
    fireEvent.change(dateBox(), { target: { value: "2026-10-15" } });
    mocks.lastLesson.mockResolvedValueOnce({ date: null });
    fireEvent.click(reloadBtn()!);
    expect(await screen.findByText(/그대로 두었습니다/)).toBeInTheDocument();
    expect(dateBox()).toHaveValue("2026-10-15");
  });
  it("다시 불러오는 중에 반 하나를 끄면 — 새 조회가 '기록 없음'이어도 손으로 고친 날짜를 지킨다 · 늦은 옛 응답은 버린다", async () => {
    mocks.lastLesson.mockResolvedValueOnce({ date: "2026-10-28" });
    render(<RequestDialog {...two} />); await pick();
    await waitFor(() => expect(dateBox()).toHaveValue("2026-10-28"));
    fireEvent.change(dateBox(), { target: { value: "2026-10-15" } });
    let late!: (v: { date: string | null }) => void;
    mocks.lastLesson.mockImplementationOnce(() => new Promise(r => { late = r; }));
    fireEvent.click(reloadBtn()!);
    mocks.lastLesson.mockResolvedValueOnce({ date: null });
    fireEvent.click(screen.getByRole("checkbox", { name: /영어반/ }));
    expect(await screen.findByText(/출석 기록을 찾지 못해 마지막 수업일 칸의 날짜를 그대로 두었습니다/)).toBeInTheDocument();
    expect(dateBox()).toHaveValue("2026-10-15");
    late({ date: "2026-10-28" });
    await new Promise(r => setTimeout(r, 30));
    expect(dateBox()).toHaveValue("2026-10-15");
  });
  it("되살린 뒤 반을 바꾸면 — 다시 찾지 않고(손 표시 복원) 날짜는 지키되, 바꾸기 전 반 기준의 안내는 지운다", async () => {
    mocks.lastLesson.mockResolvedValueOnce({ date: "2026-10-28" });
    render(<RequestDialog {...two} />); await pick();
    await waitFor(() => expect(dateBox()).toHaveValue("2026-10-28"));
    fireEvent.change(dateBox(), { target: { value: "2026-10-15" } });
    mocks.lastLesson.mockResolvedValueOnce({ date: null });
    fireEvent.click(reloadBtn()!);
    expect(await screen.findByText(/그대로 두었습니다/)).toBeInTheDocument();
    expect(reloadBtn()).toBeNull(); // '기록 없음' 실패 뒤엔 단추가 사라진다(정한 동작)
    const calls = mocks.lastLesson.mock.calls.length;
    fireEvent.click(screen.getByRole("checkbox", { name: /영어반/ }));
    await new Promise(r => setTimeout(r, 30));
    expect(mocks.lastLesson.mock.calls.length).toBe(calls);
    expect(dateBox()).toHaveValue("2026-10-15");
    expect(screen.queryByText(/그대로 두었습니다/)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("직접 입력한 날짜");
  });
  it("다시 불러오는 중에 학생을 바꾸면 날짜 유지 약속은 버린다 — 새 학생의 '기록 없음'은 오늘 날짜", async () => {
    const other = { id: "student2", name: "학생2", school: "학교", grade: "중2", courses: [{ ...mathCourse, id: "course2", classId: "class2", className: "수학반2" }] };
    mocks.lastLesson.mockResolvedValueOnce({ date: "2026-10-28" });
    render(<RequestDialog {...two} students={[...two.students, other]} />); await pick();
    await waitFor(() => expect(dateBox()).toHaveValue("2026-10-28"));
    fireEvent.change(dateBox(), { target: { value: "2026-10-15" } });
    let late!: (v: { date: string | null }) => void;
    mocks.lastLesson.mockImplementationOnce(() => new Promise(r => { late = r; }));
    fireEvent.click(reloadBtn()!);
    mocks.lastLesson.mockResolvedValueOnce({ date: null });
    fireEvent.click(screen.getByRole("button", { name: /^대상 학생:/ }));
    fireEvent.click(await screen.findByRole("button", { name: "학생2 학교 중2" }));
    expect(await screen.findByText(/출석 기록을 찾지 못했습니다 — 마지막 수업일을 직접 확인해 입력해 주세요\(지금은 오늘 날짜\)/)).toBeInTheDocument();
    expect(dateBox()).toHaveValue(kstToday());
    late({ date: "2026-10-28" });
    await new Promise(r => setTimeout(r, 30));
    expect(dateBox()).toHaveValue(kstToday());
  });
  it("다시 불러오기가 날짜를 얻은 뒤엔 약속이 끝난다 — 그 뒤 반을 바꿔 '기록 없음'이면 예전 손 날짜로 돌아가지 않는다", async () => {
    mocks.lastLesson.mockResolvedValueOnce({ date: "2026-10-28" });
    render(<RequestDialog {...two} />); await pick();
    await waitFor(() => expect(dateBox()).toHaveValue("2026-10-28"));
    fireEvent.change(dateBox(), { target: { value: "2026-10-15" } });
    mocks.lastLesson.mockResolvedValueOnce({ date: "2026-10-20" });
    fireEvent.click(reloadBtn()!);
    await waitFor(() => expect(dateBox()).toHaveValue("2026-10-20"));
    mocks.lastLesson.mockResolvedValueOnce({ date: null });
    fireEvent.click(screen.getByRole("checkbox", { name: /영어반/ }));
    expect(await screen.findByText(/출석 기록을 찾지 못했습니다 — 마지막 수업일을 직접 확인해 입력해 주세요\(지금은 오늘 날짜\)/)).toBeInTheDocument();
    expect(dateBox()).toHaveValue(kstToday());
  });
  it("학원 설정을 못 읽었으면 — '다시 시도해 주세요' 안내 · 작성 요청 단추를 막는다 · '학원 설정에서 지정해 주세요'는 띄우지 않는다(3차 재리뷰)", async () => {
    // 목록 페이지가 접힌 설정으로 받은 직원 목록 = 명단 있음 + 아무도 지정 아님.
    const folded: StaffOption[] = [{ ...twoStaff[0], withdrawalApprover: false }, { ...twoStaff[1], withdrawalApprover: false }, { id: "t2", name: "영어 강사", role: "teacher", subjects: ["english"], withdrawalApprover: false }];
    render(<RequestDialog {...two} staff={folded} students={[{ ...students[0], courses: [mathCourse, { ...engCourse, teacherId: "t2", teacherName: "영어 강사" }] }]} settingsUnavailable />);
    fireEvent.click(screen.getByRole("button", { name: "+ 보고서 작성 요청" }));
    await screen.findByRole("dialog");
    const text = "학원 설정을 확인하지 못했습니다 — 잠시 후 다시 시도해 주세요";
    expect(screen.getByText(text)).toBeInTheDocument(); // 학생을 고르기 전에도
    fireEvent.click(screen.getByRole("button", { name: /^대상 학생:/ }));
    fireEvent.click(await screen.findByRole("button", { name: "학생 학교 중1" }));
    const note = await screen.findByRole("note", { name: "보고서별 승인" });
    expect(within(note).getAllByText(text)).toHaveLength(2);
    expect(screen.queryByText(/학원 설정에서 지정해 주세요/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "강사에게 작성 요청" })).toBeDisabled();
  });
  it("접힘 표시를 받은 창은 후보가 보여도(직원 목록과 설정이 엇갈려도) 작성 요청을 막는다", async () => {
    render(<RequestDialog {...props} settingsUnavailable />);
    fireEvent.click(screen.getByRole("button", { name: "+ 보고서 작성 요청" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: /^대상 학생:/ }));
    fireEvent.click(await screen.findByRole("button", { name: "학생 학교 중1" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/출석 기록을 찾지 못했습니다/));
    expect(screen.getByRole("button", { name: "관리자 승인: 관리자" })).toBeInTheDocument();
    expect(screen.getByText("학원 설정을 확인하지 못했습니다 — 잠시 후 다시 시도해 주세요")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "강사에게 작성 요청" })).toBeDisabled();
  });
  it("학원 설정을 못 읽어도 바로 처리(승인자 없음)는 그대로 된다", async () => {
    mocks.direct.mockResolvedValue({ ok: true, id: "direct-report" });
    render(<RequestDialog {...props} directReady initialStudentId="student" settingsUnavailable />);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("radio", { name: "강사 작성 없이 바로 처리" }));
    fireEvent.change(screen.getByLabelText("퇴원·종료 사유"), { target: { value: "relocation" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "바로 퇴원 처리" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "바로 퇴원 처리" }));
    await waitFor(() => expect(mocks.direct).toHaveBeenCalledWith(expect.objectContaining({ studentId: "student", reason: "relocation" })));
  });
  it("권한 없음을 한 번 받으면 손으로 고쳐도 단추가 숨는다", async () => {
    mocks.lastLesson.mockResolvedValue({ date: null, denied: true });
    render(<RequestDialog {...two} />); await pick();
    expect(await screen.findByText(/출결을 볼 권한이 없어/)).toBeInTheDocument();
    fireEvent.change(dateBox(), { target: { value: "2026-10-15" } });
    expect(reloadBtn()).toBeNull();
  });
  it("바로 처리에서도 출결을 찾는 동안은 처리 단추가 꺼져 있다(오늘 날짜로 먼저 처리되지 않게)", async () => {
    let answer!: (v: { date: string }) => void;
    mocks.lastLesson.mockImplementationOnce(() => new Promise(r => { answer = r; }));
    mocks.direct.mockResolvedValue({ ok: true, id: "direct-report" });
    render(<RequestDialog {...props} directReady initialStudentId="student" />);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("radio", { name: "강사 작성 없이 바로 처리" }));
    fireEvent.change(screen.getByLabelText("퇴원·종료 사유"), { target: { value: "relocation" } });
    expect(screen.getByRole("button", { name: "바로 퇴원 처리" })).toBeDisabled();
    answer({ date: "2026-10-22" });
    await waitFor(() => expect(screen.getByRole("button", { name: "바로 퇴원 처리" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "바로 퇴원 처리" }));
    await waitFor(() => expect(mocks.direct).toHaveBeenCalledWith(expect.objectContaining({ effectiveDate: "2026-10-22" })));
  });
  it("보고서별 안내 — 유효한 지정자가 없으면 '지정된 퇴원보고서 승인자가 없습니다'", async () => {
    const invalid: StaffOption[] = [{ id: "teacher", name: "담당 강사", role: "teacher", subjects: ["math"], withdrawalApprover: false }, { id: "t2", name: "영어 강사", role: "teacher", subjects: ["english"], withdrawalApprover: false }, { id: "manager", name: "관리자", role: "admin", subjects: ["math", "english"], withdrawalApprover: false }];
    render(<RequestDialog {...two} staff={invalid} students={[{ ...students[0], courses: [mathCourse, { ...engCourse, teacherId: "t2", teacherName: "영어 강사" }] }]} />); await pick();
    const note = await screen.findByRole("note", { name: "보고서별 승인" });
    expect(within(note).getAllByText("지정된 퇴원보고서 승인자가 없습니다 — 학원 설정에서 지정해 주세요")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "강사에게 작성 요청" })).toBeDisabled();
  });
  it("지정 승인자가 작성 강사 본인뿐인 과목은 까닭을 구분해 알린다(보고서별 안내 · 경고 줄 같은 글)", async () => {
    const sole: StaffOption[] = [{ id: "teacher", name: "담당 강사", role: "teacher", subjects: ["english"], withdrawalApprover: false }, { id: "jung", name: "정유진", role: "admin", subjects: ["english"], jobTitle: "부원장", withdrawalApprover: true }];
    render(<RequestDialog {...two} staff={sole} students={[{ ...students[0], courses: [{ ...mathCourse, teacherId: "jung", teacherName: "정유진" }, engCourse] }]} />); await pick();
    const note = await screen.findByRole("note", { name: "보고서별 승인" });
    const text = "이 과목의 지정 승인자가 작성 강사 본인뿐이라 승인할 사람이 없습니다 — 학원 설정에서 승인자를 더 지정해 주세요";
    expect(note).toHaveTextContent(`정유진 · 수학 보고서 — ${text}`);
    expect(note).toHaveTextContent("담당 강사 · 영어 보고서 — 정유진 부원장 승인");
    expect(screen.getAllByText(text)).toHaveLength(2);
    expect(screen.queryByText(/지정된 퇴원보고서 승인자가 없습니다/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "강사에게 작성 요청" })).toBeDisabled();
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
  it("바로 처리에서도 — 오류 알림 · '출결에서 다시 불러오기' · 다시 찾은 날짜로 처리(원장 2026-11-05)", async () => {
    mocks.lastLesson.mockResolvedValueOnce({ error: "수강 정보를 확인하지 못했습니다." });
    mocks.direct.mockResolvedValue({ ok: true, id: "direct-report" });
    render(<RequestDialog {...props} directReady initialStudentId="student" />);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("radio", { name: "강사 작성 없이 바로 처리" }));
    expect(await screen.findByText(/출결을 불러오지 못했습니다/)).toHaveClass("text-att-late-ink");
    mocks.lastLesson.mockResolvedValueOnce({ date: "2026-10-20" });
    fireEvent.click(screen.getByRole("button", { name: "출결에서 다시 불러오기" }));
    await waitFor(() => expect(screen.getByLabelText("마지막 수업일")).toHaveValue("2026-10-20"));
    expect(mocks.lastLesson).toHaveBeenLastCalledWith({ studentId: "student", enrollmentIds: ["course"] });
    fireEvent.change(screen.getByLabelText("퇴원·종료 사유"), { target: { value: "relocation" } });
    fireEvent.click(screen.getByRole("button", { name: "바로 퇴원 처리" }));
    await waitFor(() => expect(mocks.direct).toHaveBeenCalledWith(expect.objectContaining({ effectiveDate: "2026-10-20", enrollmentIds: ["course"] })));
  });
  it("다니는 반이 없는 원생 — 출결에서 찾지 않았다는 알림(기록 없음과 구분) · 다시 불러오기 단추 없음", async () => {
    render(<RequestDialog {...props} students={[...students, noCourse]} directReady initialStudentId="alone" />);
    await screen.findByRole("dialog");
    expect(screen.getByText("다니는 반이 없어 출결에서 찾을 수 없습니다 — 마지막 수업일을 직접 확인해 입력해 주세요(지금은 오늘 날짜).")).toHaveClass("text-att-late-ink");
    expect(screen.getByText(/다니는 반이 없어 출결에서 찾을 수 없습니다/)).toHaveAttribute("role", "status");
    fireEvent.change(screen.getByLabelText("마지막 수업일"), { target: { value: "2026-10-01" } });
    expect(screen.queryByRole("button", { name: "출결에서 다시 불러오기" })).not.toBeInTheDocument();
    expect(mocks.lastLesson).not.toHaveBeenCalled();
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
