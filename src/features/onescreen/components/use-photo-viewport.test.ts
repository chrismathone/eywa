import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePhotoViewportHeight } from "./use-photo-viewport";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("키보드로 줄어든 실제 표시 높이를 편집창에 반영한다", () => {
  const viewport = Object.assign(new EventTarget(), { height: 844 });
  vi.stubGlobal("visualViewport", viewport);
  const { result } = renderHook(usePhotoViewportHeight);
  expect(result.current).toBe(844);
  act(() => { viewport.height = 470; viewport.dispatchEvent(new Event("resize")); });
  expect(result.current).toBe(470);
});
