import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { SlimTrend } from "./slim-trend";

const change = {
  days: 7,
  newCount: 0,
  withdrawnCount: 0,
  net: 0,
  bySubject: [],
};
const visible = { attendance: true, billing: false, enrollment: false };

describe("SlimTrend", () => {
  it("실제 0%는 데이터 없음이 아니라 0% 지표로 표시한다", () => {
    const { container } = render(
      <SlimTrend
        data={[{ date: "7/16", day: "목", attendance: 0, payment: null }]}
        change={change}
        subjects={buildSubjectMaps([])}
        visible={visible}
      />,
    );

    expect(container).toHaveTextContent("0%");
    expect(container).not.toHaveTextContent("데이터가 아직 없습니다");
    expect(container.innerHTML).not.toContain("NaN");
  });

  it("원천 행이 없는 null 시계열만 데이터 없음으로 표시한다", () => {
    const { container, getByText } = render(
      <SlimTrend
        data={[{ date: "7/16", day: "목", attendance: null, payment: null }]}
        change={change}
        subjects={buildSubjectMaps([])}
        visible={visible}
      />,
    );

    expect(getByText("최근 7일 데이터가 아직 없습니다")).toBeInTheDocument();
    expect(container).not.toHaveTextContent("0%");
  });

  it("마지막 기록 뒤 결측일이 있으면 기준일을 표시한다", () => {
    const { container } = render(
      <SlimTrend
        data={[
          { date: "7/14", day: "화", attendance: 50, payment: null },
          { date: "7/15", day: "수", attendance: null, payment: null },
          { date: "7/16", day: "목", attendance: null, payment: null },
        ]}
        change={change}
        subjects={buildSubjectMaps([])}
        visible={visible}
      />,
    );

    expect(container).toHaveTextContent("50%");
    expect(container).toHaveTextContent("7/14 기준");
  });
});
