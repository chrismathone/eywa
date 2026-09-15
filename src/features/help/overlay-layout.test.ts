import { describe, expect, it } from "vitest";
import {
  BALLOON_W,
  balloonHeight,
  isOnScreen,
  overlapArea,
  overlayPlainText,
  placeOverlay,
  PILL_SIZE,
  type OverlayAnchor,
} from "./overlay-layout";

const vp = { w: 1000, h: 700 };

function a(partial: Partial<OverlayAnchor> & Pick<OverlayAnchor, "key" | "box">): OverlayAnchor {
  return { n: 1, label: "라벨", body: "설명 한 줄입니다", ...partial };
}

function noBalloonOverlap(placed: { balloon: { x: number; y: number; w: number; h: number } }[]) {
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      expect(overlapArea(placed[i]!.balloon, placed[j]!.balloon), `${i} vs ${j}`).toBe(0);
    }
  }
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
  it("알약은 컨트롤 한가운데를 가리지 않는다", () => {
    const box = { x: 100, y: 80, w: 160, h: 32 };
    const [p] = placeOverlay([a({ key: "week", box })], vp);
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const covers =
      p!.pill.x <= cx &&
      cx <= p!.pill.x + PILL_SIZE &&
      p!.pill.y <= cy &&
      cy <= p!.pill.y + PILL_SIZE;
    expect(covers).toBe(false);
  });
  it("말풍선은 뷰포트 안에 있고 너비는 상수다", () => {
    const [p] = placeOverlay([a({ key: "week", box: { x: 20, y: 20, w: 80, h: 24 } })], vp);
    expect(p!.balloon.w).toBe(BALLOON_W);
    expect(p!.balloon.x).toBeGreaterThanOrEqual(8);
    expect(p!.balloon.x + p!.balloon.w).toBeLessThanOrEqual(vp.w - 8);
    expect(p!.balloon.y).toBeGreaterThanOrEqual(8);
    expect(p!.balloon.y + p!.balloon.h).toBeLessThanOrEqual(vp.h - 8);
  });
  it("두 말풍선이 같은 자리를 안 차지하게 밀어 낸다", () => {
    const placed = placeOverlay(
      [
        a({ key: "a", n: 1, box: { x: 200, y: 100, w: 40, h: 24 } }),
        a({ key: "b", n: 2, box: { x: 210, y: 104, w: 40, h: 24 } }),
      ],
      vp,
    );
    noBalloonOverlap(placed);
  });
  it("툴바 8개 + 격자 왼쪽 8개여도 말풍선이 안 겹친다", () => {
    const top = [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
      a({ key: `t${i}`, n: i + 1, box: { x: 16 + i * 72, y: 8, w: 64, h: 32 } }),
    );
    const grid = [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
      a({
        key: `g${i}`,
        n: i + 9,
        body: "보이는 칸 통째가 한 블록입니다. 반 이름을 클릭하면 반 창이 열립니다.",
        box: { x: 24, y: 120 + i * 48, w: 90, h: 40 },
      }),
    );
    const placed = placeOverlay([...top, ...grid], vp);
    expect(placed).toHaveLength(16);
    noBalloonOverlap(placed);
  });

  it("툴바처럼 위에 줄지은 여러 개는 한 자리에 안 쌓인다", () => {
    const placed = placeOverlay(
      [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
        a({ key: `k${i}`, n: i + 1, box: { x: 16 + i * 72, y: 8, w: 64, h: 32 } }),
      ),
      vp,
    );
    expect(placed).toHaveLength(8);
    noBalloonOverlap(placed);
    const xs = new Set(placed.map((p) => Math.round(p.balloon.x)));
    expect(xs.size).toBeGreaterThan(3);
  });
  it("짧은 글의 말풍선이 긴 글보다 낮다", () => {
    expect(balloonHeight("짧다")).toBeLessThan(balloonHeight("가".repeat(80)));
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
