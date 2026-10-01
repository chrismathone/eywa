import { describe, expect, it } from "vitest";
import { RESTORE_CORNERS, RESTORE_INSET, cornerRect, pickCorner, samplePoints } from "./restore-corner";

/** '화면 원래대로' 자리 고르기 — 오른쪽 위(원장 지정)가 먼저, 막히면 비키고, 다 막히면 제자리. */
describe("restore-corner", () => {
  const size = { width: 140, height: 26 };
  const viewport = { width: 1600, height: 900 };

  it("오른쪽 위는 스크롤바를 피해 오른쪽 끝에서 띄운다", () => {
    const r = cornerRect("top-right", size, viewport);
    expect(r.left + r.width).toBe(viewport.width - RESTORE_INSET.x);
    expect(r.top).toBe(RESTORE_INSET.y);
  });

  it("아래 모서리는 바닥에서 띄운다(표 가로 스크롤바)", () => {
    const r = cornerRect("bottom-left", size, viewport);
    expect(r.left).toBe(RESTORE_INSET.x);
    expect(r.top + r.height).toBe(viewport.height - RESTORE_INSET.bottom);
  });

  it("점 다섯 개(귀퉁이 넷 + 가운데)가 전부 버튼 안에 있다", () => {
    const r = cornerRect("top-right", size, viewport);
    const pts = samplePoints(r);
    expect(pts).toHaveLength(5);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThan(r.left);
      expect(x).toBeLessThan(r.left + r.width);
      expect(y).toBeGreaterThan(r.top);
      expect(y).toBeLessThan(r.top + r.height);
    }
  });

  it("안 막혔으면 오른쪽 위", () => {
    expect(pickCorner("bottom-left", () => false)).toBe("top-right");
  });

  it("오른쪽 위가 막히면(시간표 '편집') 다음 모서리로 비킨다", () => {
    expect(pickCorner("top-right", (c) => c === "top-right")).toBe("bottom-right");
    expect(pickCorner("top-right", (c) => c !== "bottom-left")).toBe("bottom-left");
  });

  it("네 곳이 다 막히면 지금 자리를 지킨다(뛰어다니지 않게)", () => {
    expect(pickCorner("bottom-right", () => true)).toBe("bottom-right");
  });

  it("오른쪽 위가 순서의 맨 앞이다", () => {
    expect(RESTORE_CORNERS[0]).toBe("top-right");
  });
});
