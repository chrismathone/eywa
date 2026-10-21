import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoHomeworkManagement } from "./video-homework-management";
import type { VideoArrival, VideoHomeworkLedgerRow, VideoHomeworkMark } from "../types";

const mocks = vi.hoisted(() => ({ save: vi.fn(), success: vi.fn(), error: vi.fn(), reject: vi.fn(), refresh: vi.fn(), options: vi.fn(), cancel: vi.fn() }));
vi.mock("../server/actions", () => ({ setVideoHomeworkRound: mocks.save }));
vi.mock("../server/cancel-homework", () => ({ cancelVideoHomework: mocks.cancel }));
vi.mock("../server/reject-videos", () => ({ rejectHomeworkVideos: mocks.reject }));
vi.mock("../server/video-assignment", () => ({ getVideoAssignmentOptions: mocks.options, assignHomeworkVideo: vi.fn() }));
vi.mock("next/navigation", async (load) => ({ ...(await load<typeof import("next/navigation")>()), useRouter: () => ({ replace: mocks.refresh }) }));
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
  it("이미 모두 배정된 학생도 완료 칸에서 영상 배정을 변경할 수 있다", async () => {
    show({ rows: [row({ assignedDates: ["2026-09-01"], canAssignVideos: true, hasAssignableVideos: false })], marks: [],
      videos: [{ id: "v", classId: "a", studentId: "one", postedAt: "2026-09-02T12:00:00+09:00" }] });
    expect(screen.queryByRole("button", { name: "수학 A 김민준 영상 배정" })).toBeNull();
    fireEvent.click(cell("김민준 1회 2026-09-01 완료(영상)"));
    expect(await screen.findByRole("button", { name: "이 숙제에 영상 더 붙이기 · 배정 변경" })).toBeInTheDocument();
    expect(screen.getByText(/미확인은 수동 검사 기록만 지웁니다/)).toBeInTheDocument();
  });
  // 원장 2026-10-14 *"수동 영상들 다 학생들이 업로드해서 배정하고 싶은데 배정이 불가능함"* — 영상 없이 손으로 찍은 완료 칸도 영상을 받는 자리다.
  it("영상 없이 손으로 찍은 완료('수동') 칸에서도 그 숙제에 영상을 배정할 수 있다", async () => {
    show({ rows: [row({ assignedDates: ["2026-09-01"], canAssignVideos: true, hasAssignableVideos: false })],
      marks: [{ ...marks[0], status: "submitted", submittedDate: "2026-09-02" }] });
    fireEvent.click(cell("김민준 1회 2026-09-01 완료"));
    expect(await screen.findByRole("button", { name: "이 숙제에 영상 배정" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "이 숙제에 영상 더 붙이기 · 배정 변경" })).toBeNull();
  });
  it("검사 대상 밖 줄에는 '이 숙제에 영상 배정'이 없다 — 붙여도 영상을 세지 않는다", async () => {
    show({ rows: [row({ assignedDates: ["2026-09-01"], canAssignVideos: true, tracked: false, editable: false })],
      marks: [{ ...marks[0], status: "submitted", submittedDate: "2026-09-02" }] });
    fireEvent.click(cell("김민준 1회 2026-09-01 완료"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "이 숙제에 영상 배정" })).toBeNull();
  });
  // 원장 2026-10-14 *"있던 숙제가 사라지면 안되지 미확인으로 돌렸다고해서"* — 홍채민 10/2: 서버는 옮겨 남겼는데 화면이 칸을 지웠다.
  it("🔴 검사 기록만으로 선 칸을 미확인으로 — 서버가 남기면 칸이 그대로 서고 서버 값을 다시 읽는다", async () => {
    mocks.save.mockResolvedValue({ ok: true, kept: true });
    show({ rows: [row({ assignedDates: ["2026-09-03"] })],
      marks: [{ classId: "a", studentId: "one", checkDate: "2026-09-02", homeworkDate: "2026-09-01", status: "submitted", submittedDate: "2026-09-02" }] });
    fireEvent.click(cell("김민준 1회 2026-09-01 완료"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/미확인으로 바꿔도 이 칸은 남습니다/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "미확인" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "기록 저장" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledWith(expect.any(String), { scroll: false }));
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ roundKey: "h:2026-09-01", status: null }));
    expect(cell("김민준 1회 2026-09-01 미확인")).toBeInTheDocument();
    expect(cell("김민준 2회 2026-09-03 미확인")).toBeInTheDocument();
  });
  it("서버가 칸을 남기지 못했다고 하면(표 없음) 종전대로 칸이 빠지고 다시 읽지 않는다", async () => {
    show({ rows: [row({ assignedDates: ["2026-09-03"] })],
      marks: [{ classId: "a", studentId: "one", checkDate: "2026-09-02", homeworkDate: "2026-09-01", status: "submitted", submittedDate: "2026-09-02" }] });
    fireEvent.click(cell("김민준 1회 2026-09-01 완료"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "미확인" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "기록 저장" }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /2026-09-01/ })).toBeNull();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("배정 권한과 기간에 맞는 미배정 영상이 있을 때만 영상 배정을 표시한다", () => {
    show({ rows: [
      row({ assignedDates: ["2026-09-01"], canAssignVideos: true, hasAssignableVideos: true }),
      row({ studentId: "empty", studentName: "영상없음", assignedDates: ["2026-09-01"], canAssignVideos: true, hasAssignableVideos: false }),
      row({ studentId: "readonly", studentName: "조회학생", assignedDates: ["2026-09-01"], canAssignVideos: false, hasAssignableVideos: true }),
      row({ studentId: "assigned", studentName: "배정완료", assignedDates: ["2026-09-01"], canAssignVideos: true, hasAssignableVideos: false }),
    ], videos: [{ id: "assigned-video", classId: "a", studentId: "assigned", postedAt: "2026-09-02T10:00:00+09:00" }] });
    expect(screen.getByRole("button", { name: "수학 A 김민준 영상 배정" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "수학 A 영상없음 영상 배정" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "수학 A 조회학생 영상 배정" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "수학 A 배정완료 영상 배정" })).not.toBeInTheDocument();
    expect(cell("배정완료 1회 2026-09-01 완료(영상)")).toBeInTheDocument();
  });
  // 2026-10-15 — 장부는 기간 앞뒤를 넓혀 읽어 짝을 짓는다. 기간(9/1~) 안 칸만 보면 8/29 숙제에 자동으로 붙은 9/2 영상이 '연결 안 됨'으로 보였다.
  it("배정 창은 기간 밖 숙제에 자동으로 붙은 영상도 그 숙제로 말한다", async () => {
    mocks.options.mockResolvedValue({ ok: true, dates: ["2026-09-01"], videos: [{ id: "early", postedAt: "2026-09-02T10:00:00+09:00", className: "수학 A", classId: "a",
      homeworkDate: null, source: "ClassNote / Drive", note: null, postId: null, revision: 0, excluded: false, playback: null }] });
    show({ rows: [row({ assignedDates: ["2026-08-29", "2026-09-01"], canAssignVideos: true, hasAssignableVideos: true })], marks: [],
      videos: [{ id: "early", classId: "a", studentId: "one", postedAt: "2026-09-02T10:00:00+09:00" }] });
    expect(cell("김민준 1회 2026-09-01 미확인")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "수학 A 김민준 영상 배정" }));
    const user = userEvent.setup();
    await user.click(await screen.findByRole("combobox", { name: "영상 선택" }));
    expect(await screen.findByRole("option", { name: /08\.29 숙제에 자동 연결됨/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /연결 안 됨/ })).toBeNull();
  });
  it("열 머리는 N회만, 칸 안에 그 학생의 숙제일 — 숙제가 없는 회차는 —", () => {
    show();
    const table = screen.getByRole("table", { name: /수학 A/ });
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["", "학생", "학교 · 학년", "완료", "1회", "2회"]);
    expect(cell("김민준 1회 2026-09-01 미수행")).toHaveTextContent("09.01");
    expect(cell("이서연 1회 2026-09-02 미확인")).toHaveTextContent("09.02");
    expect(screen.getByText("초록 테두리 = 영상 자동 완료", { exact: false })).toBeInTheDocument();
  });
  it("🔴 미확인 칸은 한 번 누르면 오늘 날짜로 완료 — 그 학생의 그 숙제에 저장", async () => {
    show();
    fireEvent.click(cell("이서연 2회 2026-09-09 미확인"));
    await waitFor(() => expect(mocks.success).toHaveBeenCalled());
    expect(mocks.save).toHaveBeenCalledWith({ classId: "a", studentId: "two", roundKey: "h:2026-09-09", status: "submitted", submittedDate: today });
    expect(cell("이서연 2회 2026-09-09 완료")).toHaveTextContent("09.30");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  // 원장 2026-10-15 — 영상이 붙은 칸을 우클릭해 배정을 찾았다. 우클릭 = 편집 창만(누르기와 달리 저장하지 않는다).
  it("칸 우클릭은 저장 없이 편집 창을 연다 — 미확인 칸도 완료로 찍지 않는다", async () => {
    show();
    fireEvent.contextMenu(cell("이서연 2회 2026-09-09 미확인"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
    // 창이 열리면 뒤 화면은 접근성 트리에서 가려진다 — 칸은 그대로 미확인.
    expect(screen.getByRole("button", { name: "이서연 2회 2026-09-09 미확인", hidden: true })).toBeInTheDocument();
  });
  it("영상이 붙은 칸을 우클릭하면 그 창에서 영상 배정 변경", async () => {
    show({ rows: [row({ assignedDates: ["2026-09-01"], canAssignVideos: true, hasAssignableVideos: false })], marks: [],
      videos: [{ id: "v", classId: "a", studentId: "one", postedAt: "2026-09-02T12:00:00+09:00" }] });
    fireEvent.contextMenu(cell("김민준 1회 2026-09-01 완료(영상)"));
    expect(await screen.findByRole("button", { name: "이 숙제에 영상 더 붙이기 · 배정 변경" })).toBeInTheDocument();
  });
  it("▶ 재생 버튼을 우클릭해도 같은 편집 창 — 재생 창이 아니다", async () => {
    show({ rows: [row({ assignedDates: ["2026-09-01"], canAssignVideos: true, hasAssignableVideos: false })], marks: [],
      videos: [{ id: "v", classId: "a", studentId: "one", postedAt: "2026-09-02T12:00:00+09:00",
        playback: { preview: "https://drive.google.com/p", thumbnail: "https://drive.google.com/t", uploadedAt: null } }] });
    fireEvent.contextMenu(screen.getByRole("button", { name: "숙제 영상 보기" }));
    expect(await screen.findByRole("button", { name: "이 숙제에 영상 더 붙이기 · 배정 변경" })).toBeInTheDocument();
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
    // 영상이 붙은 칸의 미확인 = 그 숙제의 영상 반려(원장 2026-10-13) — 고르면 기록 저장 대신 반려 버튼이 선다.
    fireEvent.click(within(dialog).getByRole("button", { name: "미확인" }));
    expect(within(dialog).getByRole("button", { name: "영상 반려하고 미확인으로" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "기록 저장" })).not.toBeInTheDocument();
    expect(within(dialog).getByText(/Drive 휴지통으로 옮깁니다/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "완료" }));
    expect(within(dialog).getByLabelText("제출일")).toHaveValue("2026-09-04");
    fireEvent.click(within(dialog).getByRole("button", { name: "기록 저장" }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalled());
    expect(mocks.save).toHaveBeenCalledWith({ classId: "a", studentId: "two", roundKey: "h:2026-09-02", status: "submitted", submittedDate: "2026-09-04" });
    expect(cell("이서연 1회 2026-09-02 완료")).toBeInTheDocument();
  });
  it("영상이 붙은 칸을 미확인으로 → 그 숙제의 영상 반려 — 서버에 반·학생·숙제일을 보내고 결과를 알린다", async () => {
    mocks.reject.mockResolvedValue({ ok: true, rejected: 2, trashed: 2, trashFailed: 0, reopened: true });
    show({ videos: [{ id: "vt", studentId: "two", classId: "a", postedAt: "2026-09-04T19:00:00+09:00" }] });
    fireEvent.click(cell("이서연 1회 2026-09-02 완료(영상)"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "미확인" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "영상 반려하고 미확인으로" }));
    await waitFor(() => expect(mocks.reject).toHaveBeenCalledWith({ classId: "a", studentId: "two", homeworkDate: "2026-09-02" }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith(expect.stringContaining("영상 2개를 반려했습니다")));
    expect(mocks.refresh).toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled(); // 기록 저장이 아니라 반려다
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

// 원장 2026-10-19 *"강사, 반, 학교 는 필터가 아닌 검색에서"* — 반·학교 드롭다운을 걷고 검색창으로 찾는다.
describe("반·학교는 검색창에서 찾는다(드롭다운 없음)", () => {
  it("반·학교 드롭다운이 없고, 반 이름·학교 낱말로 검색된다", () => {
    show({ rows: [...rows, row({ classId: "c", className: "수학 C", studentId: "four", studentName: "최유나", assignedDates: ["2026-09-05"] })] });
    expect(screen.queryByRole("button", { name: /^반:/ })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "학교" })).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: /통합 검색/ }), { target: { value: "수학 C" } });
    expect(screen.getByLabelText("수학 C 장부")).toBeInTheDocument();
    expect(screen.queryByLabelText("영어 B 장부")).not.toBeInTheDocument();
  });
  it("다른 필터와 함께 걸리고 초기화·접기·펼치기가 동작한다", () => {
    show();
    fireEvent.change(screen.getByRole("combobox", { name: "과목" }), { target: { value: "수학" } });
    fireEvent.change(screen.getByRole("textbox", { name: /통합 검색/ }), { target: { value: "새봄중" } });
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

describe("관리자 화면 강사 검색 — 검색한 강사가 낸 칸만(원장 2026-10-14 · 2026-10-19 검색창으로)", () => {
  // 김민준 9/01은 이성우가, 9/03은 유형숙이 냈다. 이서연·영어 B는 유형숙만.
  const teacherRounds = { lee: ["a:one:2026-09-01"], yoo: ["a:one:2026-09-03", "a:two:2026-09-02", "a:two:2026-09-09", "b:one:2026-09-04"] };
  const teacherOptions = [{ value: "lee", label: "이성우" }, { value: "yoo", label: "유형숙" }];
  const search = (value: string) => fireEvent.change(screen.getByRole("textbox", { name: /통합 검색/ }), { target: { value } });
  it("강사 이름을 검색하면 그 강사가 낸 칸과 그 칸이 있는 반 × 학생만 — 회차 번호는 남은 칸끼리 · 다른 낱말과 함께", () => {
    render(<VideoHomeworkManagement rows={rows} initialMarks={[]} fromDate="2026-09-01" toDate={today} today={today}
      teacherRounds={teacherRounds} teacherOptions={teacherOptions} />);
    expect(screen.queryByRole("combobox", { name: "강사" })).toBeNull();
    search("이성우");
    expect(cell("김민준 1회 2026-09-01 미확인")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /김민준 2회/ })).toBeNull();
    expect(screen.queryByText("이서연")).toBeNull();
    expect(screen.queryByRole("table", { name: /영어 B/ })).toBeNull();
    search("유형숙 영어");
    expect(screen.getByRole("table", { name: /영어 B/ })).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: /수학 A/ })).toBeNull();
  });
  it("강사 이름이 아닌 낱말은 글자 검색 · 강사뷰(선택지 없음)엔 강사 해석이 없다", () => {
    show();
    search("이성우");
    expect(screen.getByText("조건에 맞는 학생이 없습니다.")).toBeInTheDocument();
  });
});

// 원장 2026-10-16 *"미확인이나 미제출인 숙제에 한해서 숙제 취소할 수 있게"* — 보고서를 보낸 숙제도 칸 편집 창에서 거둔다.
describe("영상 제출 현황 — 숙제 취소", () => {
  it("미수행 칸은 '숙제 취소'를 두 번 눌러 거둔다(처음엔 무엇이 바뀌는지 읽게) · 끝나면 장부를 다시 읽는다", async () => {
    mocks.cancel.mockResolvedValue({ ok: true });
    show();
    fireEvent.click(cell("김민준 1회 2026-09-01 미수행"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "숙제 취소" }));
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/ClassNote로 이미 나간 보고서 글은 바뀌지 않으니/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "숙제 취소 확정" }));
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith({ classId: "a", studentId: "one", homeworkDate: "2026-09-01" }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith(expect.stringContaining("영상 숙제를 취소했습니다")));
    expect(mocks.refresh).toHaveBeenCalledWith(expect.any(String), { scroll: false });
  });
  it("완료 칸 · 영상이 붙은 칸 · 읽기 전용 줄에는 '숙제 취소'가 없다", async () => {
    show({ marks: [{ ...marks[0], status: "submitted", submittedDate: "2026-09-02" }] });
    fireEvent.click(cell("김민준 1회 2026-09-01 완료"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "숙제 취소" })).toBeNull();
    cleanup();
    show({ rows: [row({ assignedDates: ["2026-09-01"] })], marks: [], videos: [{ id: "v", classId: "a", studentId: "one", postedAt: "2026-09-02T12:00:00+09:00" }] });
    fireEvent.click(cell("김민준 1회 2026-09-01 완료(영상)"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "숙제 취소" })).toBeNull();
  });
  it("서버가 거절하면 까닭을 띄우고 창은 그대로다", async () => {
    mocks.cancel.mockResolvedValue({ ok: false, error: "학생이 지금 이 숙제에 영상을 올리는 중입니다." });
    show();
    fireEvent.click(cell("김민준 1회 2026-09-01 미수행"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "숙제 취소" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "숙제 취소 확정" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("학생이 지금 이 숙제에 영상을 올리는 중입니다."));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("칸 아래 AI 참고 평점(원장 2026-10-21)", () => {
  it("분석이 끝난 영상이 붙은 칸 아래 '2.8/5' · 정수 부분 단계 색(저득점 파랑 → 고득점 빨강) · 평점 없는 칸·영상 없는 칸엔 없다", () => {
    show({ rows: [row({ assignedDates: ["2026-09-01", "2026-09-03"] })], marks: [], videos: [
      { id: "v1", classId: "a", studentId: "one", postedAt: "2026-09-02T12:00:00+09:00", reviewPoints: 2.8 },
      { id: "v2", classId: "a", studentId: "one", postedAt: "2026-09-04T12:00:00+09:00" },
    ] });
    const score = screen.getByTitle(/AI 참고 평점 2\.8점/);
    expect(score).toHaveTextContent("2.8/5");
    expect(score).toHaveAttribute("data-tier", "2");
    expect(screen.getAllByTitle(/AI 참고 평점/)).toHaveLength(1);
    expect(screen.getByText(/칸 아래 숫자 = AI 참고 평점/)).toBeInTheDocument();
  });
  it("평점이 하나도 없으면(스위치 꺼짐·분석 전) 안내 문구도 없다", () => {
    show({ rows: [row({ assignedDates: ["2026-09-01"] })], marks: [], videos: [{ id: "v1", classId: "a", studentId: "one", postedAt: "2026-09-02T12:00:00+09:00" }] });
    expect(screen.queryByTitle(/AI 참고 평점/)).toBeNull();
    expect(screen.queryByText(/칸 아래 숫자 = AI 참고 평점/)).toBeNull();
  });
});
