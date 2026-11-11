import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const history = vi.fn();
vi.mock("../server/actions", () => ({ loadMakeupHistory: (...a: unknown[]) => history(...a) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), message: vi.fn(), success: vi.fn() } }));

import { useMakeupPrev } from "./use-makeup-prev";

describe("useMakeupPrev", () => {
  it("🔴 일괄 불러오기는 옛 렌더의 함수로 다시 눌러도 ref가 막는다(한 번만 돈다)", async () => {
    let release!: () => void;
    history.mockImplementation(() => new Promise((r) => (release = () => r({ ok: true, bySubject: {} }))));
    const { result } = renderHook(() =>
      useMakeupPrev({ date: "", setStudents: vi.fn(), i18n: { t: ((k: string) => k) as never, tf: ((k: string) => k) as never } }),
    );
    const staleLoadAll = result.current.loadMakeupPrevAll; // 토스트 버튼이 들고 있는 옛 함수
    let p!: Promise<void>;
    act(() => {
      p = result.current.loadMakeupPrevAll(["s1"]);
    });
    expect(result.current.makeupPrevBusy).toBe(true);
    await act(async () => staleLoadAll(["s1"]));
    expect(history).toHaveBeenCalledTimes(1);
    await act(async () => {
      release();
      await p;
    });
    expect(result.current.makeupPrevBusy).toBe(false);
    expect(result.current.prevLoaded.has("s1")).toBe(true);
  });
});
