import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const m = vi.hoisted(() => ({ options: vi.fn(), save: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));
vi.mock("../server/video-assignment", () => ({ getVideoAssignmentOptions: m.options, assignHomeworkVideo: m.save }));
vi.mock("@/features/students/components/homework-video-player", () => ({ HomeworkVideoPlayer: () => <div>영상 재생</div> }));
import { VideoAssignmentDialog } from "./video-assignment-dialog";
const row = { classId: "math", className: "수학반", studentId: "student", studentName: "가상학생", subject: "수학", school: null, grade: null, tracked: true, editable: true, assignedDates: ["2026-10-01"] };
beforeEach(() => {
  vi.clearAllMocks(); m.save.mockResolvedValue({ ok: true });
  m.options.mockResolvedValue({ ok: true, dates: ["2026-10-01"], videos: [{ id: "v", postedAt: "2026-10-02T10:00:00Z", className: "영어반", homeworkDate: "2026-10-02", source: "ClassNote", postId: 123, revision: 4, excluded: false, playback: { preview: "preview", thumbnail: "thumb", uploadedAt: null } }] });
});
afterEach(cleanup);
async function pickVideo() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("combobox", { name: "영상 선택" }));
  await user.click(await screen.findByRole("option", { name: /2026-10-02.*영어반/ }));
}
it("다른 반 영상의 원래 게시물과 숙제를 확인한 뒤 사유를 적어 배정한다", async () => {
  const close = vi.fn(); render(<VideoAssignmentDialog row={row} fromDate="2026-10-01" toDate="2026-10-31" onClose={close} />);
  await pickVideo();
  expect(m.options).toHaveBeenCalledWith({ classId: "math", studentId: "student", fromDate: "2026-10-01", toDate: "2026-10-31" });
  expect(screen.getByText(/현재 연결: 영어반/)).toHaveTextContent("게시물 123");
  expect(screen.getByRole("button", { name: "영상 배정 저장" })).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: "변경 사유" }), { target: { value: "수학 영상을 영어반에 올림" } });
  fireEvent.click(screen.getByRole("button", { name: "영상 배정 저장" }));
  await waitFor(() => expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ classId: "math", videoId: "v", revision: 4, homeworkDate: "2026-10-01" })));
  await waitFor(() => expect(close).toHaveBeenCalled()); expect(m.refresh).toHaveBeenCalled();
});
it("저장 충돌은 창을 닫지 않고 이유를 보여 준다", async () => {
  m.save.mockResolvedValue({ ok: false, error: "다른 곳에서 변경됐습니다." }); const close = vi.fn();
  render(<VideoAssignmentDialog row={row} fromDate="2026-10-01" toDate="2026-10-31" onClose={close} />);
  await pickVideo();
  fireEvent.change(screen.getByRole("textbox", { name: "변경 사유" }), { target: { value: "정정" } });
  fireEvent.click(screen.getByRole("button", { name: "영상 배정 저장" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("다른 곳"); expect(close).not.toHaveBeenCalled();
});
it("영상 목록은 제목행 없이 배정 상태를 보여 주고, 숙제일~14일 범위를 벗어난 영상과 날짜 변경 전 선택을 제거한다", async () => {
  const original = await m.options();
  m.options.mockResolvedValue({ ...original, dates: ["2026-10-01", "2026-11-01"], videos: [
    ...original.videos, { ...original.videos[0], id: "march", postedAt: "2026-03-15T12:54:02+09:00", source: "ClassNote / Drive" },
    { ...original.videos[0], id: "before", postedAt: "2026-09-30T23:59:59+09:00" },
    { ...original.videos[0], id: "after15", postedAt: "2026-10-16T00:00:00+09:00" },
    { ...original.videos[0], id: "unassigned", className: null, homeworkDate: null },
    { ...original.videos[0], id: "automatic", homeworkDate: null },
    { ...original.videos[0], id: "excluded", excluded: true },
  ] });
  render(<VideoAssignmentDialog row={row} fromDate="2026-10-01" toDate="2026-11-01" onClose={vi.fn()} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("combobox", { name: "영상 선택" }));
  expect(screen.queryByText("게시일")).not.toBeInTheDocument();
  expect(screen.queryByText("반", { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByText("연결된 숙제")).not.toBeInTheDocument();
  expect(screen.queryByText(/ClassNote|Drive|2026-03-15|2026-09-30|2026-10-16/)).not.toBeInTheDocument();
  expect(screen.getByRole("option", { name: /2026-10-02 배정/ })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /미배정/ })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /숙제일 미지정/ })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /집계 제외/ })).toBeInTheDocument();
  await user.click(screen.getByRole("option", { name: /2026-10-02 배정/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "변경 사유" }), { target: { value: "정정" } });
  expect(screen.getByRole("button", { name: "영상 배정 저장" })).toBeEnabled();
  fireEvent.change(screen.getByRole("combobox", { name: "배정할 영상 숙제" }), { target: { value: "2026-11-01" } });
  expect(screen.getByRole("combobox", { name: "영상 선택" })).toBeDisabled();
  expect(screen.queryByText(/현재 연결:/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "영상 배정 저장" })).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("배정할 수 있는 업로드 완료 영상이 없습니다");
});
