import { describe, expect, it } from "vitest";
import {
  BALLOON_W,
  isOnScreen,
  overlayPlainText,
  placeOverlay,
  PILL_SIZE,
  type OverlayAnchor,
} from "./overlay-layout";

const vp = { w: 1000, h: 700 };

function a(partial: Partial<OverlayAnchor> & Pick<OverlayAnchor, "key" | "box">): OverlayAnchor {
  return { n: 1, label: "라벨", body: "설명", ...partial };
}

describe("isOnScreen", () => {
  it("크기 0 · 뷰포트 밖은 제외한다", () => {
    expect(isOnScreen({ x: 10, y: 10, w: 0, h: 20 }, vp)).toBe(false);
    expect(isOnScreen({ x: 10, y: 10, w: 20, h: 1 }, vp)).toBe(false);
    expect(isOnScreen({ x: 1200, y: 10, w: 40, h: 20 }, vp)).toBe(false);
    expect(isOnScreen({ x: 10, y: -40, w: 40, h: 20 }, vp)).toBe(false);
  });
  it("뷰포트와 겹치면 포함한다", () => {
    expect(isOnScreen({ x: 10, y: 10, w: 80, h: 24 }, vp)).toBe(true);
    expect(isOnScreen({ x: -10, y: 10, w: 40, h: 20 }, vp)).toBe(true);
  });
});

describe("overlayPlainText", () => {
  it("위키 표식과 강조를 평문으로 바꾼다 — 영문 키가 안 남는다", () => {
    expect(overlayPlainText("[[attendance|보강 예약]]을 **우클릭**으로")).toBe("보강 예약을 우클릭으로");
    expect(overlayPlainText("[[timetable]]")).toBe("시간표");
    expect(overlayPlainText("[[timetable]]")).not.toBe("timetable");
  });
});

describe("placeOverlay", () => {
  it("알약은 요소 왼쪽 위 모서리에 두고 컨트롤 한가운데를 가리지 않는다", () => {
    const [p] = placeOverlay([a({ key: "week", box: { x: 100, y: 80, w: 160, h: 32 } })], vp);
    expect(p!.pill.x).toBe(100 - PILL_SIZE / 2);
    expect(p!.pill.y).toBe(80 - PILL_SIZE / 2);
    expect(p!.pill.x + PILL_SIZE).toBeLessThan(100 + 80);
  });
  it("말풍선은 뷰포트 안에 있고 너비는 상수다", () => {
    const [p] = placeOverlay([a({ key: "week", box: { x: 20, y: 20, w: 80, h: 24 } })], vp);
    expect(p!.balloon.w).toBe(BALLOON_W);
    expect(p!.balloon.x).toBeGreaterThanOrEqual(8);
    expect(p!.balloon.x + p!.balloon.w).toBeLessThanOrEqual(vp.w - 8);
  });
  it("두 말풍선이 같은 자리를 안 차지하게 밀어 낸다", () => {
    const placed = placeOverlay(
      [
        a({ key: "a", n: 1, box: { x: 200, y: 100, w: 40, h: 24 } }),
        a({ key: "b", n: 2, box: { x: 210, y: 104, w: 40, h: 24 } }),
      ],
      vp,
    );
    const [x, y] = placed;
    const overlapX = Math.min(x!.balloon.x + x!.balloon.w, y!.balloon.x + y!.balloon.w) - Math.max(x!.balloon.x, y!.balloon.x);
    const overlapY = Math.min(x!.balloon.y + x!.balloon.h, y!.balloon.y + y!.balloon.h) - Math.max(x!.balloon.y, y!.balloon.y);
    expect(overlapX <= 0 || overlapY <= 0).toBe(true);
  });
  it("본문의 위키 표식을 말풍선에서 지운다", () => {
    const [p] = placeOverlay(
      [a({ key: "k", body: "[[students|원생목록]]에서 찾습니다", box: { x: 40, y: 40, w: 50, h: 20 } })],
      vp,
    );
    expect(p!.body).toBe("원생목록에서 찾습니다");
    expect(p!.body).not.toMatch(/\[\[/);
  });
});
