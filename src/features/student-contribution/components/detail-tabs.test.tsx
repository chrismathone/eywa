import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
const m = vi.hoisted(() => ({ navigate: vi.fn(), push: vi.fn(), pending: false }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(window.location.search), useRouter: () => ({ push: m.push }) }));
vi.mock("./ontology-navigation", () => ({ NavigationScope: ({ children }: { children: React.ReactNode }) => children,
  useOntologyNavigation: () => ({ pending: m.pending, navigate: m.navigate }) }));
import { StudentDetailTabs } from "./student-detail-tabs";
import { TrendMonthPanel } from "./trend-month-panel";
import { stackSegments, trendGeometry } from "./trend-geometry";
beforeEach(() => { vi.clearAllMocks(); m.pending = false; window.history.replaceState(null, "", "/student-contribution/s?embed=1&list=page%3D2&month=2026-09"); });
afterEach(cleanup);

function Counter() { const [n, setN] = useState(0); return <button type="button" onClick={() => setN(n + 1)}>눌린 수 {n}</button>; }
const tabs = () => render(<StudentDetailTabs evidenceNote="9월 근거" summary={<Counter />} evidence={<p>근거 표</p>} />);

it("탭을 바꿔도 서버에 다시 묻지 않고 같은 달·목록 복귀·창 상태를 주소에 남긴다", () => {
  tabs();
  expect(screen.getByText("근거 표").closest("[role=tabpanel]")!.hasAttribute("hidden")).toBe(true);
  fireEvent.click(screen.getByText("눌린 수 0"));
  fireEvent.click(screen.getByRole("tab", { name: "계산 근거" }));
  expect(Object.fromEntries(new URLSearchParams(window.location.search))).toEqual({ embed: "1", list: "page=2", month: "2026-09", view: "evidence" });
  expect(screen.getByRole("tab", { name: "계산 근거" }).getAttribute("aria-selected")).toBe("true");
  expect(m.push).not.toHaveBeenCalled(); expect(m.navigate).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole("tab", { name: "계산 근거" }), { key: "ArrowLeft" });
  // 숨겼던 요약 탭은 마운트를 유지해 차트 선택·기간 같은 화면 상태가 남는다.
  expect(screen.getByText("눌린 수 1")).toBeTruthy();
  expect(new URLSearchParams(window.location.search).get("view")).toBeNull();
  expect(document.activeElement?.id).toBe("contribution-tab-summary");
});

it("달을 불러오는 동안에는 탭을 바꾸지 않아 진행 중인 달 이동이 버려지지 않는다", () => {
  m.pending = true; tabs();
  fireEvent.click(screen.getByRole("tab", { name: "계산 근거" }));
  fireEvent.click(screen.getByRole("tab", { name: "추이·요약" }));
  expect(new URLSearchParams(window.location.search).get("view")).toBeNull();
  expect(screen.getByRole("tab", { name: "추이·요약" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tab", { name: "계산 근거" }).getAttribute("aria-disabled")).toBe("true");
  expect(screen.getByRole("status").textContent).toContain("불러오는 중");
});

it("주소에 근거 탭이 있으면 처음부터 근거를 보여 준다", () => {
  window.history.replaceState(null, "", "/student-contribution/s?month=2026-09&view=evidence");
  tabs();
  expect(screen.getByText("근거 표").closest("[role=tabpanel]")!.hasAttribute("hidden")).toBe(false);
  expect(screen.getByText("눌린 수 0").closest("[role=tabpanel]")!.hasAttribute("hidden")).toBe(true);
});

const point = { month: "2026-09", total: 30, change: -2, operations: 1, participation: 0, correction: -3, hasRecord: true, status: "closed" as const,
  items: [{ metric: "tuitionWon" as const, value: 1, correction: -3 }] };
it("선택한 달의 증감을 부호와 낱말로 말하고 정정은 음수로 남긴다", () => {
  render(<StudentDetailTabs evidenceNote="" evidence={<p>근거 표</p>} summary={<TrendMonthPanel point={point} preview={false} pending={false}
    comparison={{ kind: "change", previous: "2026-08", previousChange: 0, delta: -2 }} />} />);
  const panel = within(screen.getByRole("complementary", { name: "선택한 달의 증감" }));
  expect(panel.getByText("−2")).toBeTruthy(); expect(panel.getByText("누적 감소")).toBeTruthy();
  expect(panel.getByText(/지난달\(8월\) 0점과 견주면/)).toBeTruthy(); expect(panel.getByText("−2점 · 감소")).toBeTruthy();
  expect(panel.queryByText(/%|무한/)).toBeNull();
  expect(panel.getByText("정정 · 수업료 기여")).toBeTruthy(); expect(panel.getByText("−3점")).toBeTruthy();
  fireEvent.click(panel.getByRole("button", { name: "이 달 계산 근거 보기" }));
  expect(new URLSearchParams(window.location.search).get("view")).toBe("evidence");
  expect(screen.getByText("근거 표").closest("[role=tabpanel]")!.hasAttribute("hidden")).toBe(false);
});

it("집계 중인 달은 지난달과 증감 판정을 내지 않고 실제 0과 기록 없음을 가른다", () => {
  const view = render(<TrendMonthPanel point={{ ...point, change: 1.5, status: "current" }} preview={false} pending={false} comparison={{ kind: "open", previous: "2026-08", previousChange: 4 }} />);
  expect(screen.getByText("집계 중")).toBeTruthy(); expect(screen.getByText(/이번 달은 집계 중이라 지난달과 견주지 않습니다/)).toBeTruthy();
  expect(screen.queryByText(/· 증가|· 감소/)).toBeNull();
  const empty = { ...point, change: 0, operations: 0, correction: 0, items: [] };
  view.rerender(<TrendMonthPanel point={empty} preview={false} pending={false} comparison={{ kind: "first" }} />);
  expect(screen.getByText("이 달에 반영된 실적이 없습니다. 실제 0점입니다.")).toBeTruthy();
  // 확인 전 자료가 있거나 집계 중인 달의 0점은 '실제 0'으로 단정하지 않는다.
  view.rerender(<TrendMonthPanel point={{ ...empty, unavailable: 1 }} preview={false} pending={false} comparison={{ kind: "first" }} />);
  expect(screen.queryByText(/실제 0점/)).toBeNull(); expect(screen.getByText("확인 전 자료가 있는 항목 1개 · 확인된 실적만 반영했습니다.")).toBeTruthy();
  view.rerender(<TrendMonthPanel point={{ ...empty, status: "current" }} preview={false} pending={false} comparison={{ kind: "open", previous: null, previousChange: null }} />);
  expect(screen.queryByText(/실제 0점/)).toBeNull(); expect(screen.getByText(/지금까지 반영된 실적이 없습니다/)).toBeTruthy();
  view.rerender(<TrendMonthPanel point={point} preview={false} pending={false} comparison={{ kind: "previous-merged", previous: "2026-08" }} />);
  expect(screen.getByText("지난달(8월)은 병합 전 원생의 기록이라 견주지 않습니다.")).toBeTruthy();
  view.rerender(<TrendMonthPanel point={{ month: "2026-07", total: 30, change: 0, hasRecord: false, status: "none" }} preview pending={false} comparison={{ kind: "none" }} />);
  expect(screen.queryByText(/실제 0점/)).toBeNull(); expect(screen.getByText("집계 기록이 없는 달은 선택할 수 없습니다.")).toBeTruthy();
});

it("양수는 0 위로, 환불·정정 같은 음수는 0 아래로 항목마다 따로 쌓는다", () => {
  expect(stackSegments({ month: "m", total: 0, change: 1, operations: 3, participation: 1, correction: -3 })).toEqual([
    { key: "operations", kind: "operations", from: 0, to: 3 }, { key: "participation", kind: "participation", from: 3, to: 4 }, { key: "correction", kind: "correction", from: 0, to: -3 }]);
  // 같은 달 안의 소개 +15와 환불 −5는 +10 하나로 상쇄되지 않는다.
  expect(stackSegments({ month: "m", total: 0, change: 10, operations: 10, items: [{ metric: "referralStarted", value: 15, correction: 0 }, { metric: "tuitionWon", value: -5, correction: 0 },
    { metric: "perfectMonths", value: 1, correction: -1 }] })).toEqual([
    { key: "referralStarted", kind: "operations", from: 0, to: 15 }, { key: "tuitionWon", kind: "operations", from: 0, to: -5 },
    { key: "perfectMonths", kind: "participation", from: 15, to: 16 }, { key: "perfectMonths:correction", kind: "correction", from: -5, to: -6 }]);
  expect(stackSegments({ month: "m", total: 0, change: 0, operations: 0, participation: 0, correction: 0 })).toEqual([]);
});

it("증감 눈금은 같은 값을 두 번 세우지 않고 누적 눈금은 실제 축 끝과 같다", () => {
  const down = trendGeometry([{ month: "2026-01", total: 5, change: 0, hasRecord: false }, { month: "2026-02", total: 1, change: -4, correction: -4, operations: 0 }], 640, true);
  expect(down.barTicks).toEqual([0, -4]);
  expect(trendGeometry([{ month: "2026-01", total: 0, change: 0, operations: 0 }], 640, false).barTicks).toEqual([0]);
  const wide = trendGeometry([{ month: "2026-01", total: 421.53, change: 4 }, { month: "2026-02", total: 471.63, change: 50 }], 640, true);
  expect(wide.lineTicks.every(Number.isInteger)).toBe(true); expect(wide.lineTicks[1]).toBeGreaterThanOrEqual(471.63);
  // 1년 내내 거의 안 변해도 확대 범위는 최소 1점 이상이라 위·아래 눈금이 같은 값이 되지 않는다.
  const flat = trendGeometry([{ month: "2026-01", total: 50.1, change: 0 }, { month: "2026-02", total: 50.105, change: 0.005 }], 640, true);
  expect(flat.lineTicks[1]! - flat.lineTicks[0]!).toBeGreaterThanOrEqual(2);
});
