import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { capturePhoto, usePhotoCamera } from "./use-photo-camera";

const request = vi.fn();
function Harness({ active = true, student = "a" }: { active?: boolean; student?: string }) {
  const { videoRef, state, start } = usePhotoCamera(active);
  return <><video ref={videoRef} data-testid="video" data-state={state} /><button onClick={() => void start()}>{student}</button></>;
}
function fakeStream() {
  const track = Object.assign(new EventTarget(), { stop: vi.fn() });
  const stream = Object.assign(new MediaStream(), { getTracks: () => [track as unknown as MediaStreamTrack], getVideoTracks: () => [track as unknown as MediaStreamTrack] });
  return { track, stream };
}
beforeEach(() => {
  request.mockReset();
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: request } });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("학생을 바꿔도 같은 후면 카메라를 유지하고 닫을 때 트랙을 해제한다", async () => {
  const { stream, track } = fakeStream();
  request.mockResolvedValue(stream);
  const { rerender, unmount } = render(<Harness />);
  await waitFor(() => expect(screen.getByTestId("video").getAttribute("data-state")).toBe("ready"));
  expect(request).toHaveBeenCalledWith(expect.objectContaining({ audio: false, video: expect.objectContaining({ facingMode: { ideal: "environment" } }) }));
  rerender(<Harness student="b" />);
  expect(request).toHaveBeenCalledTimes(1);
  expect(track.stop).not.toHaveBeenCalled();
  unmount();
  expect(track.stop).toHaveBeenCalledTimes(1);
});
it("권한 대기 중 닫은 뒤 도착한 스트림도 즉시 해제한다", async () => {
  let resolve!: (stream: MediaStream) => void;
  request.mockReturnValue(new Promise<MediaStream>(r => { resolve = r; }));
  const { unmount } = render(<Harness />);
  unmount();
  const { stream, track } = fakeStream();
  await act(async () => { resolve(stream); });
  expect(track.stop).toHaveBeenCalledTimes(1);
});
it("백그라운드에서는 카메라를 끄고 자동 재시작하지 않는다", async () => {
  const { stream, track } = fakeStream();
  request.mockResolvedValue(stream);
  render(<Harness />);
  await waitFor(() => expect(screen.getByTestId("video").getAttribute("data-state")).toBe("ready"));
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(track.stop).toHaveBeenCalledTimes(1);
  visibility.mockReturnValue("visible");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(request).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("video").getAttribute("data-state")).toBe("paused");
});
it("권한 거절은 안내 상태로 바꾸고 준비 안 된 프레임은 촬영하지 않는다", async () => {
  request.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
  render(<Harness />);
  await waitFor(() => expect(screen.getByTestId("video").getAttribute("data-state")).toBe("denied"));
  await expect(capturePhoto(document.createElement("video"), "x.jpg")).rejects.toThrow("camera-not-ready");
});
it("고해상도 프레임을 1600 이내 JPEG로 담고 캔버스를 비운다", async () => {
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  const canvases: HTMLCanvasElement[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, cb) {
    canvases.push(this);
    expect(this.width).toBe(1200);
    expect(this.height).toBe(1600);
    cb(new Blob(["photo"], { type: "image/jpeg" }));
  });
  const file = await capturePhoto({ videoWidth: 3024, videoHeight: 4032, readyState: 2 } as HTMLVideoElement, "student.jpg");
  expect(file.name).toBe("student.jpg");
  expect(file.type).toBe("image/jpeg");
  expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1200, 1600);
  expect(canvases[0].width).toBe(0);
  expect(canvases[0].height).toBe(0);
});
it("JPEG 인코딩 실패를 성공 사진으로 취급하지 않는다", async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(cb => cb(null));
  await expect(capturePhoto({ videoWidth: 100, videoHeight: 100, readyState: 2 } as HTMLVideoElement, "x.jpg")).rejects.toThrow("camera-encode-failed");
});
