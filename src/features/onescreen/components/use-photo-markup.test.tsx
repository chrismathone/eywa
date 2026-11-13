import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { PointerEvent } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePhotoMarkup } from "./use-photo-markup";

const file = new File(["photo"], "photo.jpg", { type: "image/jpeg" });
const observed = vi.fn();
function Harness({ mounted = false }: { mounted?: boolean }) {
  const { image, stageRef, canvasRef, display } = usePhotoMarkup(file, vi.fn());
  return <><span>{image ? "ready" : "loading"}</span>{mounted ? <div ref={stageRef}><canvas ref={canvasRef} data-testid="canvas" style={display} /></div> : null}</>;
}
beforeEach(() => {
  observed.mockClear();
  vi.stubGlobal("URL", class extends URL { static createObjectURL = vi.fn(() => "blob:test"); static revokeObjectURL = vi.fn(); });
  vi.stubGlobal("Image", function () {
    const img = document.createElement("img");
    Object.defineProperties(img, { naturalWidth: { value: 900 }, naturalHeight: { value: 1200 },
      src: { set: (value: string) => { if (value) queueMicrotask(() => img.dispatchEvent(new Event("load"))); } } });
    return img;
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(390);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  vi.stubGlobal("ResizeObserver", class {
    callback: () => void;
    constructor(callback: () => void) { this.callback = callback; }
    observe(node: Element) { observed(node); queueMicrotask(this.callback); }
    disconnect() {}
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ save() {}, restore() {}, fillRect() {}, drawImage() {}, fillText() {}, strokeText() {}, strokeRect() {}, setLineDash() {}, measureText: (text: string) => ({ width: text.length * 8 }) } as unknown as CanvasRenderingContext2D);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("편집창 포털이 늦게 생겨도 사진 크기를 측정해 1px로 남지 않는다", async () => {
  const { rerender } = render(<Harness />);
  await screen.findByText("ready");
  expect(observed).not.toHaveBeenCalled();
  rerender(<Harness mounted />);
  await waitFor(() => expect(screen.getByTestId("canvas").style.width).toBe("390px"));
  expect(screen.getByTestId("canvas").style.height).toBe("520px");
  expect(observed).toHaveBeenCalledTimes(1);
});
it("닫을 때 원본 미리보기 URL을 해제한다", async () => {
  const { unmount } = render(<Harness mounted />);
  await screen.findByText("ready");
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
});
it("두 번째 손가락이 첫 드래그를 빼앗지 않고 키보드 이동도 같은 좌표를 쓴다", async () => {
  const { result } = renderHook(() => usePhotoMarkup(file, vi.fn()));
  await waitFor(() => expect(result.current.image).not.toBeNull());
  const canvas = document.createElement("canvas");
  canvas.setPointerCapture = vi.fn();
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 390, height: 520 }) as DOMRect;
  act(() => { result.current.canvasRef(canvas); result.current.stageRef(document.createElement("div")); result.current.add("text", "note"); });
  const event = (pointerId: number, clientX: number) => ({ currentTarget: canvas, pointerId, button: 0, clientX, clientY: 260 }) as unknown as PointerEvent<HTMLCanvasElement>;
  act(() => result.current.pointerDown(event(1, 195)));
  act(() => result.current.pointerDown(event(2, 1)));
  act(() => result.current.pointerEnd(event(2, 1)));
  act(() => result.current.pointerMove(event(1, 234)));
  expect(result.current.marks[0].x).toBeCloseTo(0.6);
  act(() => result.current.pointerEnd(event(1, 234)));
  act(() => result.current.pointerMove(event(1, 273)));
  expect(result.current.marks[0].x).toBeCloseTo(0.6);
  act(() => result.current.nudge(result.current.marks[0].id, 0.01, 0));
  expect(result.current.marks[0].x).toBeCloseTo(0.61);
});
