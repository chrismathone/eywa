import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { HomeworkVideosView } from "./homework-videos-view";
import { dedupeHomeworkVideos, homeworkVideoLinks, type HomeworkVideo } from "@/features/students/homework-videos";

const row: HomeworkVideo = { id: "11111111-1111-4111-8111-111111111111", subject: "english", posted_at: "2026-09-30T04:36:00Z", created_at: "2026-09-30T04:36:00Z",
  comment_id: 12, status: "uploaded", drive_file_id: "drivefile12345", bytes: 7873117, uploaded_at: "2026-09-30T05:00:00Z" };
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
  it("과목·출처로 목록을 나누고, 선택한 영상은 인증된 원본 재생기로 불러온다", () => {
    const { container } = render(<HomeworkVideosView rows={[row]} subjectLabels={{ english: "영어" }} />);
    expect(screen.getByRole("region", { name: "영어 숙제 영상" })).toBeInTheDocument();
    expect(container.querySelector("video")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /학부모 댓글/ }));
    expect(container.querySelector("video")?.getAttribute("src")).toBe(`/api/homework-videos/${row.id}/stream`);
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    // 구글 로그인 안내 문구는 걷었다(원장 2026-10-01)
    expect(screen.queryByText(/Google 계정으로 로그인/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(container.querySelector("video")).toBeNull();
  });
  it("담임 폴더에 직접 올린 영상은 '직접 제출'·날짜만, 제출 링크는 '제출 링크'로 보인다(원시값 노출 없음)", () => {
    render(<HomeworkVideosView rows={[
      { ...row, id: "drive", source: "drive", comment_id: null, posted_at: "2026-09-30T03:00:00Z", drive_file_id: "drivefile99999" },
      { ...row, id: "link", source: "link", comment_id: null },
    ]} subjectLabels={{ english: "영어" }} />);
    const drive = screen.getByRole("button", { name: /직접 제출/ });
    expect(drive).toHaveTextContent("2026. 09. 30.");
    expect(drive).not.toHaveTextContent(/오후|오전/);
    expect(screen.getByRole("button", { name: /제출 링크/ })).toBeInTheDocument();
    expect(screen.queryByText(/drive ·|link ·/)).toBeNull();
  });
  it("같은 영상(MD5·크기) 두 줄은 과목이 정해진 쪽 하나만 — 지문은 화면으로 내보내지 않는다", () => {
    const classnote = { ...row, id: "cn", subject: null, md5: "a".repeat(32) };
    const manual = { ...row, id: "dr", source: "drive" as const, md5: "a".repeat(32) };
    const other = { ...row, id: "x", md5: "b".repeat(32) };
    const result = dedupeHomeworkVideos([classnote, manual, other, { ...row, id: "nomd5" }]);
    expect(result.map((r) => r.id)).toEqual(["dr", "x", "nomd5"]);
    expect(result.every((r) => !("md5" in r))).toBe(true);
  });
  it("재생 실패는 권한 오류로 단정하지 않고 다시 불러오기와 호환 재생을 제공한다", () => {
    const { container } = render(<HomeworkVideosView rows={[row]} subjectLabels={{ english: "영어" }} />);
    fireEvent.click(screen.getByRole("button", { name: /학부모 댓글/ }));
    fireEvent.error(container.querySelector("video")!);
    expect(screen.getByRole("alert")).toHaveTextContent("영상을 불러오지 못했습니다.");
    expect(screen.getByRole("button", { name: "다시 불러오기" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "호환 재생" })).toBeEnabled();
    expect(container.querySelector("iframe")).toBeNull();
  });
  it("막 올라간 영상도 오래된 영상과 같은 재생 경로이며 썸네일로 막지 않는다", () => {
    const fresh = { ...row, uploaded_at: new Date(Date.now() - 10 * 60_000).toISOString() };
    const { container } = render(<HomeworkVideosView rows={[fresh]} subjectLabels={{ english: "영어" }} />);
    fireEvent.click(screen.getByRole("button", { name: /학부모 댓글/ }));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("video")?.getAttribute("src")).toBe(`/api/homework-videos/${row.id}/stream`);
  });
  it("🔴 Drive로 나가는 링크는 어디에도 없다 — 재생 주소(미리보기·썸네일)만 만든다", () => {
    const { container } = render(<HomeworkVideosView rows={[row]} subjectLabels={{ english: "영어" }} />);
    expect(screen.queryByText("Drive 열기")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /학부모 댓글/ }));
    expect(container.querySelector("a")).toBeNull();
    expect(container.innerHTML).not.toContain("/view");
    expect(Object.keys(homeworkVideoLinks("drivefile12345")!).sort()).toEqual(["preview", "thumbnail"]);
  });
  it("영상 제출 현황의 ▶ — `video`로 넘어온 id의 영상이 미리 골라진 채 열린다(이 학생 영상이 아닌 id는 무시)", () => {
    const other: HomeworkVideo = { ...row, id: "22222222-2222-4222-8222-222222222222", posted_at: "2026-09-29T04:36:00Z", drive_file_id: "otherfile12345" };
    const { container, unmount } = render(<HomeworkVideosView rows={[row, other]} subjectLabels={{ english: "영어" }} initialVideoId={other.id} />);
    expect(screen.getByRole("region", { name: "숙제 영상 뷰어" })).toBeInTheDocument();
    expect(container.querySelector("video")?.getAttribute("src")).toContain(other.id);
    unmount();
    render(<HomeworkVideosView rows={[row]} subjectLabels={{ english: "영어" }} initialVideoId="남의-영상-id" />);
    expect(screen.queryByRole("region", { name: "숙제 영상 뷰어" })).toBeNull();
    expect(screen.getByText("목록에서 재생할 영상을 선택하세요.")).toBeInTheDocument();
  });
  it("전송 대기 중인 영상은 재생 링크를 만들지 않는다", () => {
    render(<HomeworkVideosView rows={[{ ...row, status: "queued", drive_file_id: null }]} subjectLabels={{ english: "영어" }} />);
    expect(screen.getByRole("button", { name: /업로드 대기/ })).toBeDisabled();
    expect(screen.queryByText("Drive 열기")).toBeNull();
    expect(homeworkVideoLinks("//evil.example/video")).toBeNull();
  });
});
