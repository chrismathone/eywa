import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRowFileDrop } from "./grid-attach";

type FakeEvent = {
  dataTransfer: { types: string[]; files?: File[]; dropEffect?: string };
  preventDefault: () => void;
  currentTarget: { contains: (n: unknown) => boolean };
  relatedTarget?: unknown;
};

/** React.DragEvent 중 훅이 실제로 쓰는 부분만 흉내 낸다. */
function dragEvent(types: string[], files: File[] = [], contains = false): FakeEvent {
  return {
    dataTransfer: { types, files },
    preventDefault: vi.fn(),
    currentTarget: { contains: () => contains },
  };
}

const file = () => new File(["x"], "시험지.jpg", { type: "image/jpeg" });

describe("useRowFileDrop", () => {
  afterEach(cleanup);

  it("파일을 끌면 행이 드롭 대상이 되고, 놓으면 그 파일로 첨부한다", () => {
    const onFiles = vi.fn();
    const { result } = renderHook(() => useRowFileDrop(onFiles));

    const over = dragEvent(["Files"]);
    act(() => result.current.handlers.onDragOver(over as never));
    expect(result.current.over).toBe(true);
    expect(over.preventDefault).toHaveBeenCalled(); // 없으면 브라우저가 파일을 그냥 열어버린다

    const f = file();
    act(() => result.current.handlers.onDrop(dragEvent(["Files"], [f]) as never));
    expect(onFiles).toHaveBeenCalledWith([f]);
    expect(result.current.over).toBe(false);
  });

  it("텍스트 드래그(문구 편집 중 선택)에는 반응하지 않는다", () => {
    const onFiles = vi.fn();
    const { result } = renderHook(() => useRowFileDrop(onFiles));

    const over = dragEvent(["text/plain"]);
    act(() => result.current.handlers.onDragOver(over as never));
    expect(result.current.over).toBe(false);
    expect(over.preventDefault).not.toHaveBeenCalled();

    act(() => result.current.handlers.onDrop(dragEvent(["text/plain"]) as never));
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("행 안 자식으로 옮겨가는 dragleave는 무시한다(강조 깜빡임 방지)", () => {
    const { result } = renderHook(() => useRowFileDrop(vi.fn()));
    act(() => result.current.handlers.onDragOver(dragEvent(["Files"]) as never));

    act(() => result.current.handlers.onDragLeave(dragEvent(["Files"], [], true) as never)); // 자식으로 이동
    expect(result.current.over).toBe(true);

    act(() => result.current.handlers.onDragLeave(dragEvent(["Files"], [], false) as never)); // 행 밖으로
    expect(result.current.over).toBe(false);
  });

  it("비활성(disabled)이면 강조도 첨부도 없다", () => {
    const onFiles = vi.fn();
    const { result } = renderHook(() => useRowFileDrop(onFiles, true));

    act(() => result.current.handlers.onDragOver(dragEvent(["Files"]) as never));
    expect(result.current.over).toBe(false);
    act(() => result.current.handlers.onDrop(dragEvent(["Files"], [file()]) as never));
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("파일 없는 드롭은 핸들러를 부르지 않는다", () => {
    const onFiles = vi.fn();
    const { result } = renderHook(() => useRowFileDrop(onFiles));
    act(() => result.current.handlers.onDrop(dragEvent(["Files"], []) as never));
    expect(onFiles).not.toHaveBeenCalled();
  });
});
