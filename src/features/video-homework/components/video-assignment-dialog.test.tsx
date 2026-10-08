import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
it("다른 반 영상의 원래 게시물과 숙제를 확인한 뒤 사유를 적어 배정한다", async () => {
  const close = vi.fn(); render(<VideoAssignmentDialog row={row} onClose={close} />);
  const select = await screen.findByRole("combobox", { name: /영상 선택/ });
  fireEvent.change(select, { target: { value: "v" } });
  expect(screen.getByText(/현재 연결: 영어반/)).toHaveTextContent("게시물 123");
  expect(screen.getByRole("button", { name: "영상 배정 저장" })).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: "변경 사유" }), { target: { value: "수학 영상을 영어반에 올림" } });
  fireEvent.click(screen.getByRole("button", { name: "영상 배정 저장" }));
  await waitFor(() => expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ classId: "math", videoId: "v", revision: 4, homeworkDate: "2026-10-01" })));
  await waitFor(() => expect(close).toHaveBeenCalled()); expect(m.refresh).toHaveBeenCalled();
});
it("저장 충돌은 창을 닫지 않고 이유를 보여 준다", async () => {
  m.save.mockResolvedValue({ ok: false, error: "다른 곳에서 변경됐습니다." }); const close = vi.fn();
  render(<VideoAssignmentDialog row={row} onClose={close} />);
  fireEvent.change(await screen.findByRole("combobox", { name: /영상 선택/ }), { target: { value: "v" } });
  fireEvent.change(screen.getByRole("textbox", { name: "변경 사유" }), { target: { value: "정정" } });
  fireEvent.click(screen.getByRole("button", { name: "영상 배정 저장" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("다른 곳"); expect(close).not.toHaveBeenCalled();
});
