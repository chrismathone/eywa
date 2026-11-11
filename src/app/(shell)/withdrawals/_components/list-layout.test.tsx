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

/**
 * 자는 **창(스크롤러)**이다 — 옆 카드(사유 분석) 높이가 아니다(원장 2026-09-16).
 * 그래서 이 픽스처는 `<main>` 안에 그리고 창 높이(1000)와 목록의 문서상 위치(300)를 준다.
 */
const VIEWPORT = 1000;
const ROWS_TOP = 300;
const PAD_BOTTOM = 40;
let main: HTMLElement;

describe("창 높이에 맞춘 명단 행 수", () => {
  beforeEach(() => {
    navigation.replace.mockReset();
    main = document.createElement("main");
    Object.defineProperty(main, "clientHeight", { value: VIEWPORT, configurable: true });
    document.body.appendChild(main);
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      gridTemplateColumns: "600px 400px",
      paddingBottom: `${PAD_BOTTOM}px`,
    } as CSSStyleDeclaration);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.tagName === "MAIN") return { top: 0, bottom: VIEWPORT, height: VIEWPORT } as DOMRect;
      if (this.hasAttribute("data-withdrawal-rows"))
        return { top: ROWS_TOP, bottom: ROWS_TOP + 44, height: 44 } as DOMRect;
      const height = this.hasAttribute("data-withdrawal-reasons") ? 400
        : this.hasAttribute("data-withdrawal-header") ? 80
        : this.hasAttribute("data-withdrawal-pager") ? 65 : 44;
      return { top: 0, bottom: height, height } as DOMRect;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    main.remove();
  });

  // 창 1000 − 목록 위 300 − (쪽 넘김 65 + 바닥 40) − 4 = 591 → 행 45px → 13행.
  // 🔴 옛 자(오른쪽 카드 400px)로는 같은 창에서 5행이었다 — 아래 절반이 비는 이유가 이것이었다.
  it("필터와 embed를 유지하면서 창에 맞춘 크기로 맞추고 첫 페이지로 돌아간다", () => {
    const { container } = render(<WithdrawalListLayout size={8} total={99}>{fixture}</WithdrawalListLayout>, {
      container: main,
    });
    const [href, options] = navigation.replace.mock.calls[0];
    const params = new URL(href, "https://aywa.test").searchParams;
    expect(params.get("size")).toBe("13");
    expect(params.has("page")).toBe(false);
    expect(params.get("reason")).toBe("move");
    expect(params.get("q")).toBe("Kim");
    expect(params.get("embed")).toBe("1");
    expect(options).toEqual({ scroll: false });
    // 두 카드 높이 = 창에 맞춘 명단 높이(머리 80 + 쪽 넘김 65 + 13행 × 45) — 옆 카드(400)가 아니다.
    expect((container.firstChild as HTMLElement).style.getPropertyValue("--withdrawal-list-height")).toBe("730px");
  });

  it("이미 맞는 크기면 같은 크기를 재요청하지 않는다(왕복 진동 방지)", () => {
    const { container } = render(<WithdrawalListLayout size={13} total={99}>{fixture}</WithdrawalListLayout>, {
      container: main,
    });
    expect(navigation.replace).not.toHaveBeenCalled();
    expect((container.firstChild as HTMLElement).style.getPropertyValue("--withdrawal-list-height")).toBe("730px");
  });

  it("🔴 옆 '사유 분석'이 창보다 길어도 명단 행 수·높이는 그대로 — 그 카드가 안에서 스크롤한다(원장 2026-10-15 · 적대 리뷰)", () => {
    // 사유 2단계로 사유 카드가 1200px이 돼도 명단을 늘리지 않는다(늘리면 아래가 비고, 행 수를 늘리면 사유 막대가 바뀔 때마다 다시 불러온다).
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
      if (this.tagName === "MAIN") return { top: 0, bottom: VIEWPORT, height: VIEWPORT } as DOMRect;
      if (this.hasAttribute("data-withdrawal-rows")) return { top: ROWS_TOP, bottom: ROWS_TOP + 44, height: 44 } as DOMRect;
      const height = this.hasAttribute("data-withdrawal-reasons") ? 1200
        : this.hasAttribute("data-withdrawal-header") ? 80
        : this.hasAttribute("data-withdrawal-pager") ? 65 : 44;
      return { top: 0, bottom: height, height } as DOMRect;
    });
    const { container } = render(<WithdrawalListLayout size={13} total={99}>{fixture}</WithdrawalListLayout>, { container: main });
    expect(navigation.replace).not.toHaveBeenCalled();
    expect((container.firstChild as HTMLElement).style.getPropertyValue("--withdrawal-list-height")).toBe("730px");
  });

  it("좁은 화면에서는 창과 별도로 기본 8행을 사용한다 — 목록 아래에 '사유 분석'이 오기 때문", () => {
    vi.mocked(window.getComputedStyle).mockReturnValue({
      gridTemplateColumns: "700px",
      paddingBottom: `${PAD_BOTTOM}px`,
    } as CSSStyleDeclaration);
    render(<WithdrawalListLayout size={5} total={19}>{fixture}</WithdrawalListLayout>, { container: main });
    expect(new URL(navigation.replace.mock.calls[0][0], "https://aywa.test").searchParams.get("size")).toBe("8");
  });

  it("🔴 명단이 첫 화면 아래쪽에서 시작하면(위에 강사별 퇴원율 카드) 한 화면 높이로 잰다 — 5행으로 줄지 않는다(원장 2026-11-11)", () => {
    // 명단 묶음이 문서 900에서 시작(창 1000의 절반 아래) · 행 영역은 그 100 아래(카드 머리).
    // beforeEach의 가짜 자(같은 spy) 위에 덮는다 — 그 구현을 먼저 꺼내 둬야 자기 자신을 부르지 않는다.
    const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
    const base = spy.getMockImplementation()!;
    spy.mockImplementation(function (this: HTMLElement) {
      if (this.parentElement === main && this.tagName === "DIV") return { top: 900, bottom: 1600, height: 700 } as DOMRect;
      if (this.hasAttribute("data-withdrawal-rows")) return { top: 1000, bottom: 1044, height: 44 } as DOMRect;
      return base.call(this);
    });
    const { container } = render(<WithdrawalListLayout size={5} total={99}>{fixture}</WithdrawalListLayout>, { container: main });
    // 창 1000 − (카드 머리 100 + 위 여백 16) − (쪽 넘김 65 + 바닥 40) − 4 = 775 → 행 45px → 17행.
    expect(new URL(navigation.replace.mock.calls[0][0], "https://aywa.test").searchParams.get("size")).toBe("17");
    // 하한에 걸린 것이 아니라 두 카드 높이를 맞춘다(옆 '사유 분석'이 혼자 길게 늘어나지 않게).
    expect((container.firstChild as HTMLElement).style.getPropertyValue("--withdrawal-list-height")).not.toBe("");
  });

  it("🔴 최소 창에서도 하한(5행) 아래로 떨어지지 않는다 — 1행 목록은 쪽 넘김을 무의미하게 만든다", () => {
    // 창이 목록 위 높이(300)보다 조금 큰 정도 = 남는 자리가 한 행도 안 된다.
    Object.defineProperty(main, "clientHeight", { value: 420, configurable: true });
    const { container } = render(<WithdrawalListLayout size={8} total={99}>{fixture}</WithdrawalListLayout>, { container: main });
    expect(new URL(navigation.replace.mock.calls[0][0], "https://aywa.test").searchParams.get("size")).toBe("5");
    // 하한에 걸린 창에선 두 카드 높이를 걸지 않는다 — 5행 높이로 사유 카드를 자르지 않게(리뷰 2026-10-15).
    expect((container.firstChild as HTMLElement).style.getPropertyValue("--withdrawal-list-height")).toBe("");
  });
});
