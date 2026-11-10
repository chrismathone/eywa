import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 카드·표의 발송 게이트 재료 = 한 벌(row-send-gate.ts, 수정 계획 P1-O · 리뷰 B5).
 * 예전엔 두 화면이 입력 25줄을 따로 적어 카드만 회수 진행 중(`recallPending`)을 넘겼다 — 다시 갈라지지 않게 잠근다.
 */
const read = (p: string) => readFileSync(path.join(process.cwd(), "src/features/onescreen", p), "utf8");

describe("원스크린 발송 게이트 — 카드·표가 같은 조립을 부른다", () => {
  it.each(["components/report-card.tsx", "components/grid-row.tsx"])("%s → rowSendGate, evaluateSendGate 직접 호출 없음", (f) => {
    const src = read(f);
    expect(src).toContain("rowSendGate({");
    expect(src).not.toContain("evaluateSendGate(");
  });
  it("조립은 회수 진행 중을 넘긴다", () => {
    expect(read("row-send-gate.ts")).toContain("recallPending: isRecallInFlight(liveStatus ?? null)");
  });
  it("자동저장은 줄(session-save-queue)을 거친다 — 맨 saveOnescreenSession(...).then 금지(실패가 조용히 사라진다)", () => {
    const src = read("components/onescreen-client.tsx");
    expect(src).toContain("createSessionSaveQueue({");
    expect(src).not.toMatch(/void saveOnescreenSession\(/);
  });
});
