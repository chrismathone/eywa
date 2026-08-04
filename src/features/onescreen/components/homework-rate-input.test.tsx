import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { HomeworkRateInput } from "./homework-rate-input";

/**
 * 표 모드에서 이 칸은 **고정 130px**(onescreen-grid colgroup + table-fixed)인데 내용은
 * 숫자(48) + % + 알약 2개 ≈ 161px다. 접히지 않으면 넘친 알약이 옆 칸(교재명)으로 삐져나가고
 * 그 칸의 불투명 입력 배경에 덮여 **"라벨이 가려진다"**(원장 제보 2026-08-04, 실측 넘침 42px).
 * 행 높이는 옆 칸(학부모 문구 3칸)이 정하므로 아래로 접히는 건 공짜다.
 * 여기서 잠그는 계약: **넘치면 다음 줄로 내린다 + 알약 2개는 한 덩어리로 내려간다.**
 */
describe("HomeworkRateInput — 좁은 칸에서 접힘", () => {
  it("컨테이너가 줄바꿈을 허용한다(넘쳐도 옆 칸을 침범하지 않게)", () => {
    const { container } = render(<HomeworkRateInput value="" onChange={vi.fn()} label="홍길동 과제 수행률" />);
    const root = container.firstChild as HTMLElement;

    expect(root.className).toContain("flex-wrap");
  });

  it("미제출·없음 알약은 같은 묶음 안에 있다(따로 접혀 행마다 모양이 달라지지 않게)", () => {
    render(<HomeworkRateInput value="" onChange={vi.fn()} label="홍길동 과제 수행률" />);

    const notSubmitted = screen.getByRole("button", { name: "미제출" });
    const none = screen.getByRole("button", { name: "없음" });

    expect(notSubmitted.parentElement).toBe(none.parentElement);
  });

  it("숫자·미제출·없음은 그대로 동작한다(접힘은 배치만 바꾼다)", () => {
    const onChange = vi.fn();
    render(<HomeworkRateInput value="90%" onChange={onChange} label="홍길동 과제 수행률" />);

    expect(screen.getByLabelText("홍길동 과제 수행률")).toHaveValue("90");
    expect(screen.getByRole("button", { name: "미제출" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "없음" }).getAttribute("aria-pressed")).toBe("false");
  });
});
