import { afterEach, expect, it, vi } from "vitest";
import { isDirectEditClick } from "./direct-edit";

afterEach(() => vi.unstubAllGlobals());
const click = (pointerType?: string, detail = 1) => ({ detail, nativeEvent: Object.assign(new Event("click"), { pointerType }) });

it("touch and pen open directly; mouse keeps double-click even on hybrid touch hardware", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  expect(isDirectEditClick(click("touch"))).toBe(true);
  expect(isDirectEditClick(click("pen"))).toBe(true);
  expect(isDirectEditClick(click("mouse"))).toBe(false);
});
it("keyboard activation opens an editor and older coarse-pointer clicks remain supported", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  expect(isDirectEditClick(click(undefined, 0))).toBe(true);
  expect(isDirectEditClick(click())).toBe(false);
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  expect(isDirectEditClick(click())).toBe(true);
});
