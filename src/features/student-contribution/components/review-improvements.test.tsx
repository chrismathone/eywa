import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DEFAULT_CONFIG, emptyRaws } from "../model/config";
import { emptyPayload, type StoredContributionMonth } from "../model/stored";
const m = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }));
vi.mock("./ontology-navigation", () => ({ useOntologyNavigation: () => ({ pending: false, navigate: m.navigate }) }));
import { ScoreTrend } from "./score-trend";
import { MonthMetrics } from "./month-metrics";
import { StudentDetailActions } from "./student-detail-actions";
import { SettingsChangeSummary } from "./settings-change-summary";
import { CorrectionDetails } from "./correction-details";
beforeEach(() => { vi.clearAllMocks(); window.history.replaceState(null, "", "/student-contribution/s?embed=1&list=page%3D2"); });
afterEach(cleanup);

it("정정의 원래 달을 열어도 목록 복귀 조건과 임베드 상태를 보존한다", () => {
  render(<CorrectionDetails studentId="s" entries={[{ month: "2026-09", metric: "subjectMonths", before: 1, after: 0, delta: -1, evidenceIds: [], kind: "source" }]} />);
  const link = screen.getByRole("link", { name: "2026년 9월 원래 달 내역" });
  const query = new URL(link.getAttribute("href")!, "https://test.local").searchParams;
  expect(Object.fromEntries(query)).toEqual({ embed: "1", list: "page=2", month: "2026-09" });
});

it("그래프 미리보기는 조회하지 않고 클릭·Enter 선택만 월과 복귀 조건을 함께 전달한다", () => {
  render(<ScoreTrend studentId="s" selectedMonth="2026-09" points={[{ month: "2026-09", total: 1, change: 1 }, { month: "2026-10", total: 2, change: 1 }]} />);
  const september = screen.getByRole("button", { name: "2026년 9월 누적 1점" }), october = screen.getByRole("button", { name: "2026년 10월 누적 2점" });
  expect(september.getAttribute("aria-pressed")).toBe("true");
  expect([september, october].filter((el) => el.getAttribute("tabindex") === "0")).toHaveLength(1);
  fireEvent.mouseEnter(october);
  expect(screen.getByText("2026년 10월 미리보기")).toBeTruthy(); expect(m.navigate).not.toHaveBeenCalled();
  fireEvent.click(october);
  const target = new URL(m.navigate.mock.calls[0]![0], "https://test.local");
  expect(Object.fromEntries(target.searchParams)).toEqual({ embed: "1", list: "page=2", month: "2026-10" });
  fireEvent.keyDown(october, { key: "Enter" }); expect(m.navigate).toHaveBeenCalledTimes(2);
});

it("요약 바로가기를 눌렀을 때만 현재 연결을 펼치고 목록 복귀 조건을 유지한다", () => {
  const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
  render(<><StudentDetailActions studentId="s" /><details id="current-connections-s"><summary>현재 연결</summary><section id="record-summary-s" tabIndex={-1}>저장된 요약 내용</section></details></>);
  const panel = screen.getByText("현재 연결").closest("details")!;
  expect(panel.open).toBe(false);
  expect(screen.getByRole("link", { name: "원생 목록" }).getAttribute("href")).toBe("/student-contribution?page=2");
  fireEvent.click(screen.getByRole("button", { name: "최근 기록 요약" }));
  expect(panel.open).toBe(true); expect(scroll).toHaveBeenCalledOnce();
  expect(document.activeElement?.id).toBe("record-summary-s"); scroll.mockRestore();
});

it("좁은 그래프에서 겹친 원보다 실제 포인터에 가까운 달을 선택하고 기록 없는 달은 조회하지 않는다", () => {
  const points = [{ month: "2026-08", total: 1, change: 1 }, { month: "2026-09", total: 1, change: 0, hasRecord: false }, { month: "2026-10", total: 2, change: 1 }];
  render(<ScoreTrend studentId="s" selectedMonth="2026-10" points={points} />);
  const october = screen.getByRole("button", { name: "2026년 10월 누적 2점" });
  const svg = october.closest("svg")!;
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({ left: 0, width: 640 } as DOMRect);
  fireEvent.click(october, { clientX: 65, detail: 1 });
  expect(m.navigate.mock.calls[0]![0]).toContain("month=2026-08");
  expect(document.activeElement?.getAttribute("data-month")).toBe("2026-08");
  fireEvent.click(october, { clientX: 342.5, detail: 1 });
  expect(m.navigate).toHaveBeenCalledOnce();
  expect(screen.getByText("이 달 집계 기록 없음")).toBeTruthy();
  expect(screen.queryByRole("link", { name: "이 달 내역" })).toBeNull();
  fireEvent.keyDown(october, { key: "Home" });
  expect(document.activeElement?.getAttribute("data-month")).toBe("2026-08");
  fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
  expect(document.activeElement?.getAttribute("data-month")).toBe("2026-10");
});

it("실적 없는 항목만 접고 정정·누적 실적·자료 확인 전 항목은 남긴다", () => {
  const selected: StoredContributionMonth = { month: "2026-10", studentId: "s", raws: { ...emptyRaws(), tuitionWon: 100000 },
    correction: { ...emptyRaws(), referralConsult: -1 }, closedAt: null, reconstructed: false, computedAt: "now", historical: [],
    evidenceIds: [], unavailable: ["parentPositiveMonths"], payload: emptyPayload() };
  render(<MonthMetrics selected={selected} total={{ ...emptyRaws(), tenureYears: 1 }} config={DEFAULT_CONFIG} />);
  for (const label of ["수업료 기여", "소개 상담", "장기 재원", "학부모 긍정 신호"]) expect(screen.getByText(label)).toBeTruthy();
  expect(screen.queryByText("개근")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /실적 없는 .* 항목도 보기/ }));
  expect(screen.getByText("개근")).toBeTruthy();
});

it("저장 위치의 변경 요약에 끈 항목과 배점·인정 기준 차이를 표시한다", () => {
  const after = structuredClone(DEFAULT_CONFIG); after.rates.tuitionWon.points = 2; after.rates.perfectMonths.enabled = false; after.referrals.months = 24;
  render(<SettingsChangeSummary before={DEFAULT_CONFIG} after={after} delta={35} />);
  const summary = within(screen.getByRole("region", { name: "저장할 변경 사항" }));
  expect(summary.getByText("변경 사항 3개")).toBeTruthy();
  expect(summary.getByText("수업료 기여: 1점 → 2점")).toBeTruthy();
  expect(summary.getByText(/개근:.*평가 제외/)).toBeTruthy();
  expect(summary.getByText("소개 재인정 간격: 12 → 24개월")).toBeTruthy();
});
