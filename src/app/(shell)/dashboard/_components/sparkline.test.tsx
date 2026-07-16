import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sparkline } from "./sparkline";

describe("Sparkline", () => {
  it("null 구간을 건너 잇지 않고 7일 x 위치를 유지한다", () => {
    const { container } = render(<Sparkline data={[10, 20, null, null, 30, 40, null]} />);
    const strokes = [...container.querySelectorAll('path[fill="none"]')];

    expect(strokes).toHaveLength(2);
    expect(strokes[0]).toHaveAttribute("d", expect.stringContaining("M 0 "));
    expect(strokes[0]).toHaveAttribute("d", expect.stringContaining("L 16.666666666666668 "));
    expect(strokes[1]).toHaveAttribute("d", expect.stringContaining("M 66.66666666666667 "));
    expect(strokes[1]).toHaveAttribute("d", expect.stringContaining("L 83.33333333333334 "));
    expect(container.innerHTML).not.toContain("NaN");
  });

  it("고립된 실제 0% 한 점도 정직하게 표시한다", () => {
    const { container } = render(<Sparkline data={[null, null, 0, null]} />);
    const point = container.querySelector("circle");

    expect(point).toHaveAttribute("cx", "66.66666666666667");
    expect(container.querySelectorAll('path[fill="none"]')).toHaveLength(0);
  });
});
