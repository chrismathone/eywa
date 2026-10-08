import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoHomeworkManagement } from "./video-homework-management";
import type { VideoArrival, VideoHomeworkLedgerRow, VideoHomeworkMark } from "../types";

const mocks = vi.hoisted(() => ({ save: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("../server/actions", () => ({ setVideoHomeworkRound: mocks.save }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("@/components/embed-link", () => ({ EmbedHiddenInput: () => null }));

const today = "2026-09-30";
const row = (patch: Partial<VideoHomeworkLedgerRow>): VideoHomeworkLedgerRow => ({ classId: "a", className: "수학 A", subject: "수학",
  studentId: "one", studentName: "김민준", school: "한빛중", grade: "중1", assignedDates: [], tracked: true, editable: true, ...patch });
// 같은 1회라도 학생마다 숙제가 나간 날이 다르다(김민준 9/01·9/03, 이서연 9/02·9/09).
const rows: VideoHomeworkLedgerRow[] = [
  row({ assignedDates: ["2026-09-01", "2026-09-03"] }),
  row({ studentId: "two", studentName: "이서연", school: "새봄중", grade: "중2", assignedDates: ["2026-09-02", "2026-09-09"] }),
  row({ classId: "b", className: "영어 B", subject: "영어", editable: false, assignedDates: ["2026-09-04"] }),
];
const marks: VideoHomeworkMark[] = [{ classId: "a", studentId: "one", checkDate: "2026-09-03", homeworkDate: "2026-09-01", status: "missing" }];
function show(input: { rows?: VideoHomeworkLedgerRow[]; marks?: VideoHomeworkMark[]; videos?: VideoArrival[] } = {}) {
  return render(<VideoHomeworkManagement rows={input.rows ?? rows} initialMarks={input.marks ?? marks} videos={input.videos ?? []}
    fromDate="2026-09-01" toDate={today} today={today} />);
}
const cell = (name: string) => screen.getByRole("button", { name });
beforeEach(() => { vi.clearAllMocks(); mocks.save.mockResolvedValue({ ok: true }); });
afterEach(cleanup);

describe("영상 제출 현황 — 회차는 학생별 '숙제가 나간 날' 순서", () => {
  it("열 머리는 N회만, 칸 안에 그 학생의 숙제일 — 숙제가 없는 회차는 —", () => {
    show();
    const table = screen.getByRole("table", { name: /수학 A/ });
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["", "학생", "학교 · 학년", "완료", "1회", "2회"]);
    expect(cell("김민준 1회 2026-09-01 미수행")).toHaveTextContent("09.01");
    expect(cell("이서연 1회 2026-09-02 미확인")).toHaveTextContent("09.02");
    expect(screen.getByText("반이 확인된 영상만 자동으로 셉니다", { exact: false })).toBeInTheDocument();
  });
  it("🔴 미확인 칸은 한 번 누르면 오늘 날짜로 완료 — 그 학생의 그 숙제에 저장", async () => {
    show();
    fireEvent.click(cell("이서연 2회 2026-09-09 미확인"));
    await waitFor(() => expect(mocks.success).toHaveBeenCalled());
    expect(mocks.save).toHaveBeenCalledWith({ classId: "a", studentId: "two", roundKey: "h:2026-09-09", status: "submitted", submittedDate: today });
    expect(cell("이서연 2회 2026-09-09 완료")).toHaveTextContent("09.30");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("완료를 다시 누르면 날짜 수정 — 숙제일보다 빠른 날·미래는 막는다", async () => {
    show({ marks: [{ ...marks[0], status: "submitted", submittedDate: "2026-09-02" }] });
    fireEvent.click(cell("김민준 1회 2026-09-01 완료"));
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByLabelText("제출일");
    expect(input).toHaveValue("2026-09-02");
    fireEvent.change(input, { target: { value: "2026-08-31" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "기록 저장" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("숙제가 나간 날부터");
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "2026-09-05" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "기록 저장" }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalled());
    expect(mocks.save).toHaveBeenCalledWith({ classId: "a", studentId: "one", roundKey: "h:2026-09-01", status: "submitted", submittedDate: "2026-09-05" });
  });
  it("미수행 칸에서 미확인으로 되돌리면 기록을 지운다", async () => {
    show();
    fireEvent.click(cell("김민준 1회 2026-09-01 미수행"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "미확인" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "기록 저장" }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalled());
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ roundKey: "h:2026-09-01", status: null, submittedDate: null }));
    expect(cell("김민준 1회 2026-09-01 미확인")).toBeInTheDocument();
  });
  it("같은 숙제에 기록이 둘이면(옛 중복) 받은 순서와 상관없이 나중에 찍은 쪽을 보인다", () => {
    show({ marks: [
      { ...marks[0], status: "submitted", submittedDate: "2026-09-02", checkDate: "2026-09-02", updatedAt: "2026-09-05T01:00:00Z" },
      { ...marks[0], status: "missing", updatedAt: "2026-09-03T01:00:00Z" },
    ] });
    expect(cell("김민준 1회 2026-09-01 완료")).toHaveTextContent("09.02");
  });
  it("이 반으로 올라온 학부모 영상은 '영상'으로 완료 — 요약에도 같이 세고, 확정하면 직접 기록으로 남는다", async () => {
    show({ videos: [{ id: "vt", studentId: "two", classId: "a", postedAt: "2026-09-04T19:00:00+09:00" }, { id: "vo", studentId: "one", classId: null, postedAt: "2026-09-04T19:00:00+09:00" }] });
    const auto = cell("이서연 1회 2026-09-02 완료(영상)");
    expect(auto).toHaveTextContent("09.04");
    expect(auto).toHaveAttribute("title", expect.stringContaining("연결된 영상 게시일 2026-09-04"));
    expect(auto).toHaveAttribute("title", expect.stringContaining("영상으로 자동 완료"));
    // 반이 정해지지 않은 영상은 김민준 2회(9/03)를 채우지 않는다.
    expect(cell("김민준 2회 2026-09-03 미확인")).toBeInTheDocument();
    expect(screen.getByLabelText("수학 A 장부")).toHaveTextContent("완료 1");
    fireEvent.click(auto);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/2026-09-04에 이 반으로 올라와/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "미확인" })).toBeDisabled();
    expect(within(dialog).getByLabelText("제출일")).toHaveValue("2026-09-04");
    fireEvent.click(within(dialog).getByRole("button", { name: "기록 저장" }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalled());
    expect(mocks.save).toHaveBeenCalledWith({ classId: "a", studentId: "two", roundKey: "h:2026-09-02", status: "submitted", submittedDate: "2026-09-04" });
    expect(cell("이서연 1회 2026-09-02 완료")).toBeInTheDocument();
  });
  it("일괄 적용은 학생마다 N번째 숙제에 — 같은 2회라도 날짜가 다르다 · 그 회차가 없는 학생은 뺀다", async () => {
    show({ rows: [...rows.slice(0, 2), row({ studentId: "three", studentName: "박하준", assignedDates: ["2026-09-01"] })] });
    fireEvent.click(screen.getByRole("checkbox", { name: "수학 A 현재 페이지 학생 전체 선택" }));
    fireEvent.change(screen.getByRole("combobox", { name: "수학 A 일괄 회차" }), { target: { value: "2" } });
    expect(screen.getByText(/적용할 수 없는 1명 제외/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("수학 A 일괄 제출일"), { target: { value: "2026-09-10" } });
    fireEvent.click(screen.getByRole("button", { name: "선택 2명 적용" }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalled());
    expect(mocks.save.mock.calls.map(([input]) => [input.studentId, input.roundKey, input.submittedDate])).toEqual([
      ["one", "h:2026-09-03", "2026-09-10"], ["two", "h:2026-09-09", "2026-09-10"]]);
  });
  it("부분 실패하면 성공한 칸은 남기고 실패한 칸만 되돌린다", async () => {
    mocks.save.mockResolvedValueOnce({ ok: false, error: "저장 실패" }).mockResolvedValueOnce({ ok: true });
    show();
    fireEvent.click(screen.getByRole("checkbox", { name: "수학 A 현재 페이지 학생 전체 선택" }));
    fireEvent.change(screen.getByRole("combobox", { name: "수학 A 일괄 회차" }), { target: { value: "1" } });
    fireEvent.change(screen.getByRole("combobox", { name: "수학 A 일괄 수행 상태" }), { target: { value: "missing" } });
    fireEvent.click(screen.getByRole("button", { name: "선택 2명 적용" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("1건 저장, 1건 실패")));
    expect(cell("김민준 1회 2026-09-01 미수행")).toBeInTheDocument();
    expect(cell("이서연 1회 2026-09-02 미수행")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "수학 A 김민준 선택" })).toBeChecked();
  });
});

describe("반은 드롭다운 하나에서 여러 개를 함께 고른다(반 칩 줄 없음)", () => {
  it("두 반을 고르면 그 반들만 · 라벨은 '반 2개' · 전체 반으로 되돌린다", () => {
    show({ rows: [...rows, row({ classId: "c", className: "수학 C", studentId: "four", studentName: "최유나", assignedDates: ["2026-09-05"] })] });
    expect(screen.queryByLabelText("반 바로 선택")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^반: 전체 반/ }));
    // 목록 항목은 눌림 상태(aria-pressed)를 가진다 — 같은 이름의 반 접기 버튼과 가른다. 항목 옆 작은 글자 = 지금 걸리는 학생 수.
    fireEvent.click(screen.getByRole("button", { name: "수학 A 2명", pressed: false }));
    fireEvent.click(screen.getByRole("button", { name: "영어 B 1명", pressed: false }));
    expect(screen.getByRole("button", { name: "반: 수학 A, 영어 B" })).toHaveTextContent("반 2개");
    expect(screen.getByLabelText("수학 A 장부")).toBeInTheDocument();
    expect(screen.getByLabelText("영어 B 장부")).toBeInTheDocument();
    expect(screen.queryByLabelText("수학 C 장부")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "전체 반", pressed: false }));
    expect(screen.getByLabelText("수학 C 장부")).toBeInTheDocument();
  });
  it("다른 필터와 함께 걸리고 초기화·접기·펼치기가 동작한다", () => {
    show();
    fireEvent.change(screen.getByRole("combobox", { name: "과목" }), { target: { value: "수학" } });
    fireEvent.change(screen.getByRole("combobox", { name: "학교" }), { target: { value: "새봄중" } });
    expect(screen.queryByLabelText("영어 B 장부")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "수학 A 김민준 선택" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "필터 초기화" }));
    expect(screen.getByLabelText("영어 B 장부")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "모두 접기" }));
    expect(screen.queryAllByRole("table")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "모두 펼치기" }));
    expect(screen.getAllByRole("table")).toHaveLength(2);
  });
  it("읽기 전용 반은 일괄 입력도 한 번 누르기 완료도 없다", async () => {
    show({ rows: [rows[2]] });
    expect(screen.getByRole("checkbox", { name: "영어 B 김민준 선택" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /명 적용/ })).not.toBeInTheDocument();
    fireEvent.click(cell("김민준 1회 2026-09-04 미확인"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: "기록 저장" })).not.toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
