import { describe, expect, it } from "vitest";
import { MANUALS } from "./manuals";
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

describe("말풍선은 설명을 통째로 담는다", () => {
  // 🔴 원장 제보 2026-09-15 *"창 크기에 따라 잘 맞춰야겠는데? 너무 안맞네 일부가"* — 3줄에서 잘라
  // 대부분의 설명이 *"…전체를 못"* 처럼 문장 중간에서 끊겼다. 실제 설명서 문장으로 잠근다.
  const bodies = MANUALS.flatMap((m) => m.callouts.map((c) => overlayPlainText(c.body)));
  const longest = [...bodies].sort((a, b) => b.length - a.length)[0] ?? "";

  it("실제로 3줄을 넘는 설명이 있다(이 전제가 무너지면 아래 검사가 공허해진다)", () => {
    const perLine = Math.floor((BALLOON_W - 20) / 15);
    expect(Math.ceil(longest.length / perLine)).toBeGreaterThan(3);
  });

  it("가장 긴 설명도 잘리지 않을 높이를 준다", () => {
    const perLine = Math.floor((BALLOON_W - 20) / 15);
    const lines = Math.ceil(longest.length / perLine);
    // 안쪽 여백(6×2) + 제목 줄(20) + 사이(2) + 본문 줄(20씩)
    expect(balloonHeight(longest)).toBeGreaterThanOrEqual(12 + 20 + 2 + lines * 20);
  });

  it("넓은 창에선 같은 글이 더 적은 줄로 든다", () => {
    const narrow = placeOverlay([anchorWith(longest)], { w: 900, h: 900 })[0]!.balloon;
    const wide = placeOverlay([anchorWith(longest)], { w: 2000, h: 900 })[0]!.balloon;
    expect(wide.w).toBeGreaterThan(narrow.w);
    expect(wide.h).toBeLessThanOrEqual(narrow.h);
  });
});

function anchorWith(body: string): OverlayAnchor {
  return { key: "k", n: 1, label: "라벨", body, box: { x: 40, y: 40, w: 100, h: 30 } };
}

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
  it("운영실 카드처럼 가로로 나란히 있으면 말풍선이 자기 칸에 붙는다", () => {
    const cards = [0, 1, 2, 3].map((i) =>
      a({ key: `c${i}`, n: i + 1, box: { x: 24 + i * 200, y: 80, w: 188, h: 110 } }),
    );
    const placed = placeOverlay(cards, { w: 900, h: 700 });
    noBalloonOverlap(placed);
    for (let i = 0; i < cards.length; i++) {
      const box = cards[i]!.box;
      const b = placed[i]!.balloon;
      const cx = b.x + b.w / 2;
      expect(cx, `card ${i}`).toBeGreaterThan(box.x - 24);
      expect(cx, `card ${i}`).toBeLessThan(box.x + box.w + 24);
    }
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
    const placed = placeOverlay([...top, ...grid], { w: 1100, h: 900 });
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
    for (let i = 0; i < 8; i++) {
      const box = { x: 16 + i * 72, y: 8, w: 64, h: 32 };
      const b = placed[i]!.balloon;
      const dist = Math.hypot(b.x + b.w / 2 - (box.x + box.w / 2), b.y + b.h / 2 - (box.y + box.h / 2));
      expect(dist, `item ${i}`).toBeLessThan(320);
    }
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
