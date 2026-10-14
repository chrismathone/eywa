import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { HomeworkVideoPlayer } from "./homework-video-player";
const props = { videoId: "11111111-1111-4111-8111-111111111111", preview: "https://drive.google.com/file/d/file123456789/preview", thumbnail: "thumb", title: "학생 영상", uploadedAt: null };

it("real video ids use authenticated native playback without Google's thumbnail/iframe precheck", () => {
  const { container } = render(<HomeworkVideoPlayer {...props} />);
  expect(container.querySelector("video")?.getAttribute("src")).toBe(`/api/homework-videos/${props.videoId}/stream`);
  expect(container.querySelector("video")?.getAttribute("preload")).toBe("metadata");
  expect(container.querySelector("img,iframe")).toBeNull(); expect(screen.queryByRole("alert")).toBeNull();
});
it("playback error provides retry; retry remounts the media and clears the failure", () => {
  const { container } = render(<HomeworkVideoPlayer {...props} />); const before = container.querySelector("video")!;
  fireEvent.error(before); expect(screen.getByRole("alert")).toHaveTextContent("호환 재생");
  fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" })); expect(container.querySelector("video")).not.toBe(before); expect(screen.queryByRole("alert")).toBeNull();
});
it("unmatched thread video includes exact message context and resets when selected video changes", () => {
  const { container, rerender } = render(<HomeworkVideoPlayer {...props} messageId="message-context" />);
  expect(container.querySelector("video")?.getAttribute("src")).toContain("?messageId=message-context");
  fireEvent.error(container.querySelector("video")!); rerender(<HomeworkVideoPlayer {...props} videoId="22222222-2222-4222-8222-222222222222" />);
  expect(screen.queryByRole("alert")).toBeNull(); expect(container.querySelector("video")?.getAttribute("src")).toContain("22222222");
});

it("compatibility playback replaces the native video; retry removes the frame and restores native playback", () => {
  const { container } = render(<HomeworkVideoPlayer {...props} preview="about:blank" />);
  fireEvent.click(screen.getByRole("button", { name: "호환 재생" }));
  expect(container.querySelector("video")).toBeNull(); expect(container.querySelector("iframe")?.getAttribute("src")).toBe("about:blank");
  fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
  expect(container.querySelector("iframe")).toBeNull(); expect(container.querySelector("video")).not.toBeNull();
});
