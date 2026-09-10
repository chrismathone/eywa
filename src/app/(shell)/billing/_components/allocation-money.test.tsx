import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AllocationMoney } from "./allocation-money";

afterEach(cleanup);
describe("단가 누락 금액 표시", () => {
  it("실측이 0이어도 비교할 확정 금액을 모르면 차액은 미계산이다", () => {
    render(<AllocationMoney value={0} pricedRows={0} missingPriceRows={0} missingConfirmedRows={1} difference />);
    expect(screen.getByText("미계산")).toHaveAttribute("title", "확정 금액 1건 미계산");
    expect(screen.queryByText("0원")).not.toBeInTheDocument();
  });
  it("단가가 전부 없으면 계산용 0을 실제 0원으로 노출하지 않는다", () => {
    render(<AllocationMoney value={0} pricedRows={0} missingPriceRows={3} />);
    expect(screen.getByText("미계산")).toBeInTheDocument();
    expect(screen.queryByText("0원")).not.toBeInTheDocument();
  });
  it("입력된 단가 0원은 유효한 0원으로 표시한다", () => {
    render(
      <AllocationMoney
        value={0}
        pricedRows={3}
        missingPriceRows={0}
        difference
      />,
    );
    expect(screen.getByText("0원")).toHaveClass("text-green");
  });
  it("일부만 계산한 실측액은 누락을 밝힌다", () => {
    render(
      <AllocationMoney value={150000} pricedRows={2} missingPriceRows={1} />,
    );
    expect(screen.getByText("일부 집계")).toHaveAttribute(
      "title",
      "단가 미입력 1건 제외",
    );
  });
  it("누락이 있는 차액은 일치한 것처럼 비교하지 않는다", () => {
    render(
      <AllocationMoney
        value={0}
        pricedRows={2}
        missingPriceRows={1}
        difference
      />,
    );
    expect(screen.getByText("미계산")).toBeInTheDocument();
    expect(screen.queryByText("0원")).not.toBeInTheDocument();
  });
});
