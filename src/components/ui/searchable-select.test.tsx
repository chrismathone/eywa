import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SearchableSelect } from "./searchable-select";

afterEach(cleanup);

const OPTIONS = [
  { value: "all", label: "전체" },
  { value: "math", label: "수학" },
];

/**
 * 🔴 `aria-label`은 **버튼 안의 글자를 덮는다** — 축 이름만 주면 낭독기가 "과목 필터"까지만 읽고
 *    지금 고른 값을 영영 안 읽는다(재리뷰 2026-09-04). 필터 트리거 100여 곳이 이 부품을 쓴다.
 *    (같은 일을 하는 `HrefSelect`는 처음부터 트리거에 aria-label을 안 달아 보이는 글자가 곧 이름이다.)
 */
describe("SearchableSelect 트리거 접근성 이름", () => {
  it("서술 라벨을 주면 **값을 붙여** 한 이름으로 만든다", () => {
    render(<SearchableSelect options={OPTIONS} value="math" ariaLabel="과목 필터" valuePrefix="과목" />);
    expect(screen.getByRole("button", { name: "과목 필터: 수학" })).toBeTruthy();
  });

  it("고른 게 없으면 placeholder가 값 자리에 선다(이름이 축만 남지 않는다)", () => {
    render(<SearchableSelect options={OPTIONS} value="" ariaLabel="담임 필터" placeholder="전체" />);
    expect(screen.getByRole("button", { name: "담임 필터: 전체" })).toBeTruthy();
  });

  it("서술 라벨이 없으면 aria-label을 달지 않는다 — 보이는 글자가 곧 이름", () => {
    const { container } = render(<SearchableSelect options={OPTIONS} value="math" />);
    const trigger = container.querySelector("button")!;
    expect(trigger.hasAttribute("aria-label")).toBe(false);
    expect(trigger.textContent).toContain("수학");
  });
});
