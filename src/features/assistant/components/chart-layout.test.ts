import { describe, expect, it } from "vitest";
import { chartLayout } from "./chart-layout";

describe("보고서 차트의 읽기 방향", () => {
  it("긴 반 이름과 여러 강사의 비교는 모든 이름이 구별되는 가로 막대 높이를 확보한다", () => {
    const labels=Array.from({length:12},(_,i)=>`중등 수학 개별반 ${i+1}`);
    const result=chartLayout("bar",labels,2);
    expect(result.horizontal).toBe(true);
    expect(result.height).toBeGreaterThanOrEqual(12*34);
    expect(result.labelWidth).toBeGreaterThan(100);
  });
  it("대상 순위가 많으면 이름이 짧아도 가로로 펼치고, 짧은 두 대상 비교는 기존 방향을 유지한다", () => {
    expect(chartLayout("bar",["가","나","다","라","마","바","사"],1).horizontal).toBe(true);
    expect(chartLayout("bar",["A반","B반"],2).horizontal).toBe(false);
  });
  it("날짜가 길어도 시간 흐름의 선·영역과 원그래프는 가로 순위로 바꾸지 않는다", () => {
    for(const kind of ["line","area","pie"] as const) expect(chartLayout(kind,["2026-11-13"],1)).toMatchObject({horizontal:false,height:280});
  });
  it("쌓은 막대는 시리즈 수로 같은 항목의 높이를 부풀리지 않는다", () => {
    const labels=Array.from({length:12},(_,i)=>`반${i}`);
    expect(chartLayout("stacked_bar",labels,6).height).toBe(chartLayout("stacked_bar",labels,1).height);
  });
});
