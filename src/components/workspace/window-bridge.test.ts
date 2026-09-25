import { describe, expect, it } from "vitest";
import { isFromCurrentDocument, windowDirtyMessage, WINDOW_DIRTY_MESSAGE } from "./window-bridge";

describe("미저장 메시지의 문서 표지", () => {
  it("보낸 문서의 표지(performance.timeOrigin)를 싣는다", () => {
    expect(windowDirtyMessage(true)).toEqual({ type: WINDOW_DIRTY_MESSAGE, dirty: true, doc: performance.timeOrigin });
  });

  it("🔴 떠난 문서가 늦게 보낸 메시지(표지가 지금 문서와 다름)는 버린다 — 새 문서를 거짓 주인으로 적지 않게", () => {
    const current = { performance: { timeOrigin: 2000.5 } } as unknown as Window;
    expect(isFromCurrentDocument(current, 2000.5)).toBe(true);
    expect(isFromCurrentDocument(current, 1000.25)).toBe(false);
  });

  it("표지가 없는 메시지(배포 직후 옛 코드 문서)는 종전대로 받는다", () => {
    const current = { performance: { timeOrigin: 2000.5 } } as unknown as Window;
    expect(isFromCurrentDocument(current, undefined)).toBe(true);
  });
});
