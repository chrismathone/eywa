import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// 월별 출석부 ↔ 수납 회차 확정 실시간 연동(원장 2026-10-07) — 보내는 쪽과 받는 쪽이 같은 신호 이름을 쓴다.
const read = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), "src", ...p), "utf8");
const SCOPE = `"billing:session-terms"`;

describe("출석부가 회차 확정 저장을 따라 다시 읽는다", () => {
  it("출석부 격자가 회차 확정 신호를 구독하고, 입력 뒤 새로 읽기와 같은 타이머로 묶는다", () => {
    const grid = read("app", "(shell)", "attendance", "_components", "grid-context.tsx");
    const at = grid.indexOf("subscribeRecordSaved((message) =>");
    expect(at, "구독이 없다").toBeGreaterThan(-1);
    const block = grid.slice(at, grid.indexOf("}, [scheduleRefresh]);", at));
    expect(block).toContain(`message.scope !== ${SCOPE}`);
    // 연속 확정(반 일괄·선택)을 한 번으로 묶는다 — 신호마다 곧바로 router.refresh()를 부르지 않는다.
    expect(block).toContain("scheduleRefresh()");
    expect(block).not.toContain("router.refresh()");
    // 숨은 창(최소화·유지 화면·뒤 탭)은 달 전체를 다시 읽지 않고 보이게 될 때 한 번만 — 같은 신호를 수강·시간표 저장도 쏜다.
    expect(block).toContain('document.visibilityState === "hidden"');
    expect(block).toContain("staleWhileHidden.current = true");
    expect(block).toContain('addEventListener("visibilitychange"');
    expect(block).toContain('removeEventListener("visibilitychange"');
  });

  it("회차 확정 쪽은 확정·해제·배분·이월 저장마다 같은 신호를 쏜다", () => {
    const dir = ["app", "(shell)", "billing", "_components"] as const;
    for (const file of ["session-terms-state.tsx", "receipt-allocation-dialog.tsx", "money-carry-cell.tsx", "term-delete-button.tsx"]) {
      expect(read(...dir, file), file).toContain(`publishRecordSaved(${SCOPE})`);
    }
  });
});
