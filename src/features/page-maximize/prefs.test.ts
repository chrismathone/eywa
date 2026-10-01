import { describe, expect, it, vi } from "vitest";

const patch = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock("@/lib/ui-prefs/patch", () => ({ patchMyUiPrefs: patch }));

import { PAGE_MAXIMIZE_KEY, PAGE_MAXIMIZE_NS, readPageMaximized } from "./prefs";
import { setMyPageMaximized } from "./server/actions";

/** 화면 최대화 계정 설정(`ui_prefs.shell.maximized`) — 읽기 관용 · 쓰기는 boolean만 · 꺼짐은 키 삭제. */
describe("화면 최대화 계정 설정", () => {
  it("true일 때만 켜짐 — 없거나 모양이 다르면 꺼짐", () => {
    expect(readPageMaximized({ shell: { maximized: true } })).toBe(true);
    expect(readPageMaximized({ shell: { maximized: "true" } })).toBe(false);
    expect(readPageMaximized({ shell: [] })).toBe(false);
    expect(readPageMaximized({})).toBe(false);
    expect(readPageMaximized(null)).toBe(false);
    expect(readPageMaximized("x")).toBe(false);
  });

  it("켜면 true를, 끄면 키를 지운다(기본값은 저장하지 않는다)", async () => {
    await setMyPageMaximized(true);
    expect(patch).toHaveBeenLastCalledWith(PAGE_MAXIMIZE_NS, { [PAGE_MAXIMIZE_KEY]: true });
    await setMyPageMaximized(false);
    expect(patch).toHaveBeenLastCalledWith(PAGE_MAXIMIZE_NS, { [PAGE_MAXIMIZE_KEY]: undefined });
  });

  it("boolean이 아니면 저장하지 않는다", async () => {
    patch.mockClear();
    expect(await setMyPageMaximized("on")).toEqual({ ok: false, error: "잘못된 값입니다" });
    expect(patch).not.toHaveBeenCalled();
  });
});
