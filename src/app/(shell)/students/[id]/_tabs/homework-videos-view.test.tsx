import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { HomeworkVideosView } from "./homework-videos-view";
import { homeworkVideoLinks, type HomeworkVideo } from "@/features/students/homework-videos";

const row: HomeworkVideo = { id: "video", subject: "english", posted_at: "2026-09-30T04:36:00Z", created_at: "2026-09-30T04:36:00Z",
  comment_id: 12, status: "uploaded", drive_file_id: "drivefile12345", bytes: 7873117 };
const settings = (window as unknown as { happyDOM: { settings: { disableIframePageLoading: boolean } } }).happyDOM.settings;
const previous = settings.disableIframePageLoading;
const originalError = console.error;
let consoleSpy: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  settings.disableIframePageLoading = true;
  consoleSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    // 외부 iframe 통신을 의도적으로 끈 테스트 환경의 안내만 제외한다.
    if (String(args[0]).includes('Iframe page loading is disabled.')) return;
    originalError(...args);
  });
});
afterAll(() => { settings.disableIframePageLoading = previous; consoleSpy.mockRestore(); });
describe("학생 숙제 영상 뷰어", () => {
  it("과목·출처로 목록을 나누고 선택한 영상만 불러온다", () => {
    const { container } = render(<HomeworkVideosView rows={[row]} subjectLabels={{ english: "영어" }} />);
    expect(screen.getByRole("region", { name: "영어 숙제 영상" })).toBeInTheDocument();
    expect(container.querySelector("iframe")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /학부모 댓글/ }));
    expect(container.querySelector("iframe")?.src).toBe("https://drive.google.com/file/d/drivefile12345/preview");
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(container.querySelector("iframe")).toBeNull();
  });
  it("전송 대기 중인 영상은 재생 링크를 만들지 않는다", () => {
    render(<HomeworkVideosView rows={[{ ...row, status: "queued", drive_file_id: null }]} subjectLabels={{ english: "영어" }} />);
    expect(screen.getByRole("button", { name: /업로드 대기/ })).toBeDisabled();
    expect(screen.queryByText("Drive 열기")).toBeNull();
    expect(homeworkVideoLinks("//evil.example/video")).toBeNull();
  });
});
