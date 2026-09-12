import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act } from "react";
import {
  render,
  fireEvent,
  screen,
  within,
  cleanup,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  Bars,
  Columns,
  Donut,
  AttendanceHistory,
  COLORS,
  chartMoney,
} from "./charts";

describe("overview chart integrity", () => {
  it("표시 금액은 억·만 단위로 읽히고 툴팁과 표의 원 단위 금액은 보존한다", () => {
    expect(chartMoney(200_000_000)).toBe("2억");
    expect(chartMoney(100_000_000)).toBe("1억");
    expect(chartMoney(50_000_000)).toBe("5,000만");
    expect(chartMoney(-150_000_000)).toBe("-1.5억");
    expect(chartMoney(0)).toBe("0원");
    const html = renderToStaticMarkup(
      <Columns
        labels={["4월"]}
        series={[{ name: "수납", color: COLORS[0], values: [167_620_000] }]}
        unit="원"
        format={chartMoney}
      />,
    );
    expect(html).toContain("1.68억");
    expect(html).toContain("2억");
    expect(html).toContain("1억");
    expect(html).toContain("4월 수납: 167,620,000원");
    const view = render(
      <Columns
        labels={["4월"]}
        series={[{ name: "수납", color: COLORS[0], values: [167_620_000] }]}
        unit="원"
        format={chartMoney}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "수납 수치 자세히 보기" }),
    );
    const popup = screen.getByRole("dialog");
    expect(
      within(popup).getByRole("cell", { name: "167,620,000" }),
    ).toBeTruthy();
    expect(view.container.contains(popup)).toBe(false);
    cleanup();
  });
  it("hydrates all SVG titles without replacing the server-rendered charts", async () => {
    const charts = (
      <div>
        <Donut label="재원" data={[{ label: "초등", value: 184 }]} />
        <Columns
          labels={["9월"]}
          series={[{ name: "수납", color: COLORS[0], values: [12961] }]}
          unit="만원"
        />
        <AttendanceHistory
          points={[{ date: "2026-09-10", rate: 92.4, total: 327 }]}
        />
      </div>
    );
    const container = document.createElement("div");
    container.innerHTML = renderToString(charts);
    document.body.append(container);
    const firstCircle = container.querySelector("circle");
    const onRecoverableError = vi.fn();
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(container, charts, { onRecoverableError });
      });
      expect(onRecoverableError).not.toHaveBeenCalled();
      expect(container.querySelector("circle")).toBe(firstCircle);
      expect(container.querySelector("circle title")?.textContent).toBe(
        "초등: 184명 (100.0%)",
      );
    } finally {
      await act(async () => {
        root?.unmount();
      });
      container.remove();
    }
  });
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
    expect(html).not.toContain("NaN");
    render(
      <AttendanceHistory
        points={[
          { date: "2026-09-09", rate: 0, total: 3 },
          { date: "2026-09-10", rate: null, total: 0 },
        ]}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "최근 14일 등원율 자세히 보기" }),
    );
    const popup = screen.getByRole("dialog");
    expect(within(popup).getByText("26.09.10 (목)")).toBeTruthy();
    expect(within(popup).getByText("기록 없음")).toBeTruthy();
    expect(within(popup).getByText("0.0%")).toBeTruthy();
    cleanup();
  });
});

describe("2026-09-12 원장 지시 — 세로축 '명'·값 라벨 'end'·직원 구성 조각 막대", () => {
  it("axisFormat은 눈금(axis)에만 붙고 막대 위 값 라벨(columnValue)은 format 그대로다", () => {
    const html = renderToStaticMarkup(
      <Columns
        labels={["26.08", "26.09"]}
        series={[{ name: "등록", color: COLORS[0], values: [30, 60] }]}
        axisFormat={(n) => `${n}명`}
      />,
    );
    // 눈금 셋(0·30·60)이 전부 '명' — 값 라벨(columnValue)엔 '명'이 없어야 한다(뒤바뀌면 둘 다 실패). svg <title>·툴팁의 '명'은 unit이라 세지 않는다.
    for (const tick of ["0명", "30명", "60명"]) expect(html).toMatch(new RegExp(`class="[^"]*axis[^"]*"[^>]*>${tick}<`));
    expect(html).not.toMatch(/columnValue[^>]*>[^<]*명</);
    expect(html).toMatch(/class="[^"]*columnValue[^"]*"[^>]*>60</);
    expect(html).toMatch(/class="[^"]*columnValue[^"]*"[^>]*>30</);
    expect(html).toContain(">26.09<");
  });
  it("valueLabels='end'는 마지막 칸 하나만 적는다('last'는 마지막 시리즈의 모든 칸)", () => {
    const end = renderToStaticMarkup(
      <Columns labels={["26.08", "26.09"]} series={[{ name: "실청구", color: COLORS[0], values: [1_000, 2_000] }]} valueLabels="end" />,
    );
    expect(end.match(/columnValue/g)?.length).toBe(1);
    expect(end).toMatch(/columnValue[^>]*>2,000</);
    expect(end).toContain("<title");
    expect(end).toContain("실청구 (명)</title>"); // 단일 시리즈면 '비교'가 아니다
    const last = renderToStaticMarkup(
      <Columns labels={["26.08", "26.09"]} series={[{ name: "실청구", color: COLORS[0], values: [1_000, 2_000] }]} valueLabels="last" />,
    );
    expect(last.match(/columnValue/g)?.length).toBe(2);
  });
  it("segments가 있으면 한 막대를 조각으로 이어 칠하고(폭은 행이 아니라 전체 max 기준) 툴팁에 구성을 적는다", () => {
    const html = renderToStaticMarkup(
      <Bars
        data={[
          { label: "원장", value: 4 },
          { label: "강사", value: 2, segments: [{ label: "영어", value: 1, color: "#d23c48" }, { label: "수학", value: 1, color: "#1267d5" }] },
        ]}
        title="직원 구성"
        footer={<i data-legend="" />}
      />,
    );
    expect(html).toContain("data-segmented");
    // max=4 — 조각 1명은 25%(행 합 2명 기준이면 50%가 되어 막대가 늘 꽉 찬다)
    expect(html).toContain("width:25%;background:#d23c48");
    expect(html).toContain("width:25%;background:#1267d5");
    expect(html).toContain("width:100%;background:");
    expect(html).toContain("강사 2명 — 영어 1명 · 수학 1명");
    expect(html.match(/data-segmented/g)?.length).toBe(1);
    expect(html).toContain('data-legend=""');
  });
});
