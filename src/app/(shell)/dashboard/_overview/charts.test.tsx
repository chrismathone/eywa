import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Columns, Donut, AttendanceHistory, COLORS } from "./charts";

describe("overview chart integrity", () => {
  it("keeps donut legend colors aligned when the first category is zero", () => {
    const html = renderToStaticMarkup(
      <Donut
        label="재원"
        data={[
          { label: "빈 분류", value: 0 },
          { label: "학생", value: 7 },
        ]}
      />,
    );
    expect(html).toContain(`stroke="${COLORS[1]}"`);
    expect(html).not.toContain(`stroke="${COLORS[0]}"`);
    expect(html).toContain("재원 7명");
    expect(html).not.toContain("NaN");
  });
  it("renders negative amounts around a zero baseline without negative SVG heights", () => {
    const html = renderToStaticMarkup(
      <Columns
        labels={["8월", "9월"]}
        series={[{ name: "수납", color: COLORS[0], values: [-1000, 4000] }]}
        unit="원"
      />,
    );
    expect(html).not.toMatch(/height="-/);
    expect(html).toContain("-1,000");
    expect(html).toContain("4,000");
  });
  it("distinguishes zero attendance from days with no records", () => {
    const html = renderToStaticMarkup(
      <AttendanceHistory
        points={[
          { date: "2026-09-09", rate: 0, total: 3 },
          { date: "2026-09-10", rate: null, total: 0 },
        ]}
      />,
    );
    expect(html).toContain("0.0%");
    expect(html).toContain("기록 없음");
    expect(html).not.toContain("NaN");
  });
});
