import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WithdrawalListLayout } from "./list-layout";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => "/withdrawals",
  useSearchParams: () => new URLSearchParams("q=Kim&reason=move&embed=1&page=3&size=8"),
}));

const fixture = <><section data-withdrawal-list><header data-withdrawal-header /><ul data-withdrawal-rows><li><a>원생</a></li></ul><footer data-withdrawal-pager /></section><aside data-withdrawal-reasons /></>;

describe("우측 카드에 맞춘 명단 높이", () => {
  beforeEach(() => {
    navigation.replace.mockReset();
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ gridTemplateColumns: "600px 400px" } as CSSStyleDeclaration);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const height = this.hasAttribute("data-withdrawal-reasons") ? 400
        : this.hasAttribute("data-withdrawal-header") ? 80
        : this.hasAttribute("data-withdrawal-pager") ? 65 : 44;
      return { height } as DOMRect;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("필터와 embed를 유지하면서 페이지 크기를 5로 맞추고 첫 페이지로 돌아간다", () => {
    const { container } = render(<WithdrawalListLayout size={8} total={19}>{fixture}</WithdrawalListLayout>);
    const [href, options] = navigation.replace.mock.calls[0];
    const params = new URL(href, "https://eywa.test").searchParams;
    expect(params.get("size")).toBe("5");
    expect(params.has("page")).toBe(false);
    expect(params.get("reason")).toBe("move");
    expect(params.get("q")).toBe("Kim");
    expect(params.get("embed")).toBe("1");
    expect(options).toEqual({ scroll: false });
    expect((container.firstChild as HTMLElement).style.getPropertyValue("--withdrawal-list-height")).toBe("400px");
  });
  it("마지막 페이지의 행이 적어도 카드 높이는 유지하고 같은 크기를 재요청하지 않는다", () => {
    const { container } = render(<WithdrawalListLayout size={5} total={19}>{fixture}</WithdrawalListLayout>);
    expect(navigation.replace).not.toHaveBeenCalled();
    expect((container.firstChild as HTMLElement).style.getPropertyValue("--withdrawal-list-height")).toBe("400px");
  });
  it("좁은 화면에서는 우측 카드와 별도로 기본 8행을 사용한다", () => {
    vi.mocked(window.getComputedStyle).mockReturnValue({ gridTemplateColumns: "700px" } as CSSStyleDeclaration);
    render(<WithdrawalListLayout size={5} total={19}>{fixture}</WithdrawalListLayout>);
    expect(new URL(navigation.replace.mock.calls[0][0], "https://eywa.test").searchParams.get("size")).toBe("8");
  });
});
