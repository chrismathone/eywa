import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { HeaderSearchSlot } from "./header-search-slot";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Page({ withHeader = true }: { withHeader?: boolean }) {
  return (
    <div>
      {withHeader ? (
        <header data-page-header="">
          <div data-page-header-search="" data-testid="slot" />
        </header>
      ) : null}
      <div data-testid="toolbar">
        <HeaderSearchSlot>
          <button type="button">검색</button>
        </HeaderSearchSlot>
      </div>
    </div>
  );
}

describe("검색은 화면 머리에 선다(원장 2026-10-19)", () => {
  it("머리가 보이면 머리 검색 자리로 옮겨 그린다", () => {
    // 테스트 DOM엔 레이아웃이 없다 — rect 개수로 '그려져 있음/숨겨짐'을 흉내 낸다.
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
    const { getByTestId } = render(<Page />);
    expect(getByTestId("slot").textContent).toBe("검색");
    expect(getByTestId("toolbar").textContent).toBe("");
  });

  it("머리가 숨겨져 있으면(창·모바일에서 접힌 머리) 원래 자리에 남는다 — 검색이 사라지지 않게", () => {
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([] as unknown as DOMRectList);
    const { getByTestId } = render(<Page />);
    expect(getByTestId("slot").textContent).toBe("");
    expect(getByTestId("toolbar").textContent).toBe("검색");
  });

  it("머리가 없는 화면도 원래 자리", () => {
    const { getByTestId } = render(<Page withHeader={false} />);
    expect(getByTestId("toolbar").textContent).toBe("검색");
  });
});
