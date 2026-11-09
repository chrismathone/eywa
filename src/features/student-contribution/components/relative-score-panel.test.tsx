import { expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, emptyRaws } from "../model/config";
const m = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("../server/queries", () => ({ getContributionList: m.list }));
import { RelativeScorePanel } from "./relative-score-panel";
const input = { studentId: "self", total: 0, recent: 0, revision: 1, refreshedAt: "2026-11-03T00:00:00Z" };
const data = { ready: true, historyReady: true, config: DEFAULT_CONFIG, revision: 1, refreshedAt: input.refreshedAt, month: "2026-11",
  rows: [{ id: "self", name: "이름은 전송하지 않음", status: "enrolled", grade: "중2", enrolledMonths: 2, family: {state:"ready",asOf:"2026-11-03",members:[],activeCount:1,activeSiblings:0,needsReview:0,selfActive:true}, total: { raws: emptyRaws(), recent: emptyRaws(), unavailable: [] } }] };
it("같은 배점·집계의 집단 요약만 클라이언트에 보낸다", async () => {
  m.list.mockResolvedValue(data);
  const element = await RelativeScorePanel(input);
  expect(element.props.options).toHaveLength(6);
  expect(JSON.stringify(element.props)).not.toContain("이름은 전송하지 않음");
});
it("다른 집계 또는 다른 점수의 순위를 붙이지 않는다", async () => {
  m.list.mockResolvedValue({ ...data, revision: 2 });
  expect((await RelativeScorePanel(input)).props.error).toContain("기준이 달라");
  m.list.mockResolvedValue(data);
  expect((await RelativeScorePanel({ ...input, total: 10 })).props.error).toContain("기준이 달라");
});
it("권한 없음·조회 실패를 빈 비교 집단의 최하위로 표시하지 않는다", async () => {
  m.list.mockResolvedValue(null);
  expect((await RelativeScorePanel(input)).props.options).toEqual([]);
  m.list.mockRejectedValue(new Error("조회 실패"));
  expect((await RelativeScorePanel(input)).props.error).toContain("불러오지 못했습니다");
});
