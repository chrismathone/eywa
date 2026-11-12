import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SettledReport } from "@/features/assistant/report";
import { raiseLevelsFor } from "@/features/assistant/levels";
import type { Turn } from "./assistant-state";
import { AssistantTurn } from "./assistant-turn";

vi.mock("./report-chart", () => ({ ReportChart: () => null }));
afterEach(cleanup);

const report = { title: "11월 미납", blocks: [{ type: "summary", text: "미납 3건입니다." }], datasets: {} } as unknown as SettledReport;
const turn = (over: Partial<Turn> = {}): Turn => ({
  key: "t1", messageId: "m1", question: "11월 미납 몇 건?", level: "low", createdAt: "2026-11-12T01:00:00Z",
  status: "done", steps: [], queries: [], report, error: null, ...over,
});
const ASK = "마음에 들지 않으면 추론 강도를 올려서 다시 물어보시겠습니까?";

describe("추론 강도 올려 다시 묻기(원장 2026-11-12)", () => {
  it("권하는 강도 = 적음일 때만 보통·강함", () => {
    expect(raiseLevelsFor("low")).toEqual(["normal", "high"]);
    expect(raiseLevelsFor("normal")).toEqual([]);
    expect(raiseLevelsFor("high")).toEqual([]);
  });

  it("'적음'으로 끝난 답 아래에 묻고, 누르면 같은 질문을 그 강도로 다시 묻는다", () => {
    const onRetryAt = vi.fn();
    render(<AssistantTurn turn={turn()} canRetry onRetry={() => {}} onRetryAt={onRetryAt} onReload={() => {}} />);
    expect(screen.getByText(ASK)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /강함으로 다시 묻기/ }));
    expect(onRetryAt).toHaveBeenCalledWith(expect.objectContaining({ question: "11월 미납 몇 건?" }), "high");
  });

  it("보통·강함 답 · 아직 만드는 중 · 실패 · 마지막 답이 아님(onRetryAt 없음)에는 묻지 않는다", () => {
    const cases: [Partial<Turn>, boolean][] = [
      [{ level: "normal" }, true],
      [{ level: "high" }, true],
      [{ status: "streaming", report: null }, true],
      [{ status: "error", report: null, error: "실패" }, true],
      [{}, false],
    ];
    for (const [over, withHandler] of cases) {
      render(<AssistantTurn turn={turn(over)} canRetry onRetry={() => {}} onRetryAt={withHandler ? () => {} : undefined} onReload={() => {}} />);
      expect(screen.queryByText(ASK)).toBeNull();
      cleanup();
    }
  });

  it("다른 답을 받는 중이면 단추가 잠긴다", () => {
    render(<AssistantTurn turn={turn()} canRetry={false} onRetry={() => {}} onRetryAt={() => {}} onReload={() => {}} />);
    expect(screen.getByRole("button", { name: /보통으로 다시 묻기/ })).toBeDisabled();
  });
});
