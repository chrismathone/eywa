import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SettledReport } from "../report";
import type { AssistantLevel } from "../levels";
import type { Turn } from "./assistant-state";
import { AssistantTurn } from "./assistant-turn";

vi.mock("./report-chart", () => ({ ReportChart: () => null }));
afterEach(cleanup);
const report: SettledReport = { title: "미납 현황", blocks: [{ type: "summary", text: "미납 3건입니다." }], datasets: {} };
describe("단일 모델 답변 — 옛 강도 이력도 선택·상향 안내 없음", () => {
  for (const level of ["low", "normal", "high"] as const satisfies readonly AssistantLevel[]) {
    it(`${level} 이력에는 답만 표시하고 강도 상향 버튼을 만들지 않는다`, () => {
      const turn: Turn = { key: "t1", messageId: "m1", question: "미납 몇 건?", level, createdAt: "2026-11-13T01:00:00Z", status: "done", steps: [], queries: [], report, error: null, live: true };
      render(<AssistantTurn turn={turn} canRetry onRetry={() => {}} onReload={() => {}} />);
      expect(screen.getByText("미납 3건입니다.")).toBeInTheDocument();
      expect(screen.queryByText(/추론|강도/)).toBeNull();
      expect(screen.queryByRole("button", { name: /보통으로|강함으로/ })).toBeNull();
    });
  }
});
