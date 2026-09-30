import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoHomeworkManagement } from "./video-homework-management";
import type { VideoHomeworkLedgerRow, VideoHomeworkMark } from "../types";

const mocks = vi.hoisted(() => ({ save: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("../server/actions", () => ({ setVideoHomeworkMark: mocks.save }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("@/components/embed-link", () => ({ EmbedHiddenInput: () => null }));
const date = "2026-09-03";
const rows: VideoHomeworkLedgerRow[] = [
  { classId: "a", className: "수학 A", subject: "수학", studentId: "one", studentName: "김민준", school: "한빛중", grade: "중1", editable: true, lessonDates: ["2026-09-01", date] },
  { classId: "a", className: "수학 A", subject: "수학", studentId: "two", studentName: "이서연", school: "새봄중", grade: "중2", editable: true, lessonDates: [date] },
  { classId: "b", className: "영어 B", subject: "영어", studentId: "one", studentName: "김민준", school: "한빛중", grade: "중1", editable: false, lessonDates: [date] },
];
const marks: VideoHomeworkMark[] = [{ classId: "a", studentId: "one", checkDate: date, status: "missing", homeworkDate: "2026-09-01" }];
function show(inputRows = rows, inputMarks = marks) {
  return render(<VideoHomeworkManagement rows={inputRows} initialMarks={inputMarks} fromDate="2026-09-01" toDate="2026-09-30" today="2026-09-30" />);
}
beforeEach(() => { vi.clearAllMocks(); mocks.save.mockResolvedValue({ ok: true }); });
afterEach(cleanup);

describe("영상숙제 필터·검색·저장 연결", () => {
  it("지난 수업 과제 없음은 명시된 반에만 표시하고 기존 회차·기록은 유지한다", () => {
    show(rows.map((row, index) => ({ ...row, lastAssignment: index < 2 ? { beforeDate: "2026-09-30", assigned: index === 1 } : undefined })));
    expect(screen.getAllByText("지난 수업 영상 과제 없음")).toHaveLength(1);
    expect(screen.getByText("지난 수업 영상 과제 없음")).toHaveAttribute("title", expect.stringContaining("2026-09-30 이전 마지막 수업 보고서"));
    expect(screen.getByRole("button", { name: `김민준 2회 ${date} 미수행` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `김민준 1회 ${date} 미확인` })).toBeInTheDocument();
  });
  it("필터를 함께 적용하고 초기화하며 반 접기·펼치기가 동작한다", async () => {
    show();
    fireEvent.change(screen.getByRole("combobox", { name: "과목" }), { target: { value: "수학" } });
    fireEvent.change(screen.getByRole("combobox", { name: "학교" }), { target: { value: "새봄중" } });
    expect(screen.queryByRole("region", { name: "영어 B 장부" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "수학 A 김민준 선택" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "수학 A 이서연 선택" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "필터 초기화" }));
    expect(screen.getByRole("region", { name: "영어 B 장부" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "모두 접기" }));
    expect(screen.queryAllByRole("table")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "모두 펼치기" }));
    expect(screen.getAllByRole("table")).toHaveLength(2);
  });
  it("검색 뒤 일괄 체크는 보이는 학생만 대상으로 하며 숨은 선택을 유지하지 않는다", async () => {
    show();
    fireEvent.click(screen.getByRole("checkbox", { name: "수학 A 김민준 선택" }));
    fireEvent.change(screen.getByRole("textbox", { name: "학생·반·학교 통합 검색" }), { target: { value: "이서연" } });
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: "수학 A 김민준 선택" })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: "수학 A 현재 페이지 학생 전체 선택" }));
    fireEvent.click(screen.getByRole("button", { name: "선택 1명 적용" }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalled());
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledWith({ classId: "a", studentId: "two", checkDate: date, status: "submitted", homeworkDate: null, submittedDate: "2026-09-30" });
    expect(screen.getByRole("button", { name: `이서연 2회 ${date} 완료` })).toBeInTheDocument();
  });
  it("일괄 입력에서 해당 날짜 수업이 없는 학생은 제외한다", async () => {
    show();
    fireEvent.click(screen.getByRole("checkbox", { name: "수학 A 현재 페이지 학생 전체 선택" }));
    fireEvent.change(screen.getByRole("combobox", { name: "수학 A 일괄 검사 날짜" }), { target: { value: "2026-09-01" } });
    expect(screen.getByText("해당 수업 대상 아닌 1명 제외")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "선택 1명 적용" }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalled());
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0][0].studentId).toBe("one");
  });
  it("부분 실패하면 성공한 칸은 남기고 실패한 기존 기록만 복구한다", async () => {
    mocks.save.mockResolvedValueOnce({ ok: false, error: "저장 실패" }).mockResolvedValueOnce({ ok: true });
    show();
    fireEvent.click(screen.getByRole("checkbox", { name: "수학 A 현재 페이지 학생 전체 선택" }));
    fireEvent.click(screen.getByRole("button", { name: "선택 2명 적용" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("1건 저장, 1건 실패")));
    expect(screen.getByRole("button", { name: `김민준 2회 ${date} 미수행` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `이서연 2회 ${date} 완료` })).toBeInTheDocument();
    expect(mocks.save.mock.calls[0][0].homeworkDate).toBe("2026-09-01");
    expect(screen.getByRole("checkbox", { name: "수학 A 김민준 선택" })).toBeChecked();
  });
  it("개별 기록 변경은 선택한 수업일에 저장하며 지난 숙제일을 보존한다", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: `김민준 2회 ${date} 미수행` }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "완료" }));
    fireEvent.change(within(dialog).getByLabelText("제출일"), { target: { value: "2026-09-05" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "기록 저장" }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalled());
    expect(mocks.save).toHaveBeenCalledWith({ classId: "a", studentId: "one", checkDate: date, homeworkDate: "2026-09-01", status: "submitted", submittedDate: "2026-09-05" });
    expect(screen.getByRole("button", { name: `김민준 2회 ${date} 완료` })).toHaveTextContent("09.05");
    fireEvent.click(screen.getByRole("button", { name: `김민준 2회 ${date} 완료` }));
    expect(within(await screen.findByRole("dialog")).getByLabelText("제출일")).toHaveValue("2026-09-05");
  });
  it("일괄 제출일을 선택하면 모든 대상에게 저장하고 빈 날짜·미래 날짜는 적용하지 않는다", async () => {
    show();
    fireEvent.click(screen.getByRole("checkbox", { name: "수학 A 현재 페이지 학생 전체 선택" }));
    const input = screen.getByLabelText("수학 A 일괄 제출일");
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByRole("button", { name: "선택 2명 적용" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "2026-10-01" } });
    expect(screen.getByRole("button", { name: "선택 2명 적용" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "2026-09-04" } });
    fireEvent.click(screen.getByRole("button", { name: "선택 2명 적용" }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalled());
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save.mock.calls.map(([input]) => input.submittedDate)).toEqual(["2026-09-04", "2026-09-04"]);
  });
  it("저장된 제출일을 다시 읽고 실패한 날짜 수정은 원래 날짜로 복구한다", async () => {
    show(rows, [{ ...marks[0], status: "submitted", submittedDate: "2026-09-02" }]);
    const cell = screen.getByRole("button", { name: `김민준 2회 ${date} 완료` });
    expect(cell).toHaveTextContent("09.02");
    fireEvent.click(cell);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("제출일")).toHaveValue("2026-09-02");
    mocks.save.mockResolvedValueOnce({ ok: false, error: "저장 실패" });
    fireEvent.change(within(dialog).getByLabelText("제출일"), { target: { value: "2026-09-05" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "기록 저장" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(cell).toHaveTextContent("09.02");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("옛 완료 기록에는 수업일을 제출일로 지어 넣지 않으며 미수행 전환은 날짜를 지운다", async () => {
    show(rows, [{ ...marks[0], status: "submitted" }]);
    const cell = screen.getByRole("button", { name: `김민준 2회 ${date} 완료` });
    expect(cell).toHaveTextContent("완료");
    expect(cell).not.toHaveTextContent("09.03");
    fireEvent.click(cell);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("제출일")).toHaveValue("");
    fireEvent.click(within(dialog).getByRole("button", { name: "미수행" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "기록 저장" }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalled());
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ status: "missing", submittedDate: null }));
  });
  it("읽기 전용 반에는 일괄 입력과 저장을 제공하지 않는다", async () => {
    show([rows[2]]);
    expect(screen.getByRole("checkbox", { name: "영어 B 김민준 선택" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /명 적용/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `김민준 1회 ${date} 미확인` }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: "기록 저장" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "미확인" })).toHaveAttribute("aria-pressed", "true");
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
