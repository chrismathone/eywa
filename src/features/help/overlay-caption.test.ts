import { describe, expect, it } from "vitest";
import { HOVER_CARD_WIDTH } from "@/components/hover-tip/card-style";
import { MANUALS } from "./manuals";
import { captionSize, placeCaption } from "./overlay-caption";
import { overlapArea, overlayPlainText, placePills, PILL_SIZE, type OverlayAnchor } from "./overlay-layout";

const vp = { w: 1000, h: 700 };

function a(partial: Partial<OverlayAnchor> & Pick<OverlayAnchor, "key" | "box">): OverlayAnchor {
  return { n: 1, label: "라벨", body: "설명 한 줄입니다", ...partial };
}

const shown = MANUALS.flatMap((m) => m.callouts.filter((c) => c.key));
const bodies = shown.map((c) => overlayPlainText(c.body));
const longest = [...bodies].sort((a, b) => b.length - a.length)[0] ?? "";

describe("captionSize", () => {
  it("실제로 3줄을 넘는 설명이 있다(이 전제가 무너지면 아래 검사가 공허해진다)", () => {
    const perLine = Math.floor((HOVER_CARD_WIDTH - 24) / 15);
    expect(Math.ceil(longest.length / perLine)).toBeGreaterThan(3);
  });
  it("가장 긴 설명도 풋터·p-3을 포함한 콘텐츠 높이를 준다", () => {
    const perLine = Math.floor((HOVER_CARD_WIDTH - 24) / 15);
    const lines = Math.ceil(longest.length / perLine);
    const size = captionSize("라벨", longest, { w: 1000, h: 900 });
    expect(size.w).toBe(HOVER_CARD_WIDTH);
    expect(size.contentH).toBeGreaterThanOrEqual(24 + 21 + 2 + lines * 20 + 8 + 21);
  });
  it("짧은 글의 콘텐츠 높이가 긴 글보다 낮다", () => {
    expect(captionSize("라벨", "짧다", vp).contentH).toBeLessThan(
      captionSize("라벨", "가".repeat(80), vp).contentH,
    );
  });
  it("제목이 길면 콘텐츠 높이가 커진다", () => {
    const body = "설명 한 줄입니다";
    expect(captionSize("가".repeat(40), body, vp).contentH).toBeGreaterThan(
      captionSize("짧다", body, vp).contentH,
    );
  });
  it("긴 글은 뷰포트 상한에서 contentH > displayH 이라 스크롤 전제가 선다", () => {
    const size = captionSize("라벨", longest, { w: 1000, h: 160 });
    expect(size.contentH).toBeGreaterThan(size.displayH);
    expect(size.displayH).toBe(80);
  });
});

describe("placeCaption", () => {
  it("캡션은 뷰포트 안에 있고 폭은 토큰이다", () => {
    const box = { x: 400, y: 200, w: 80, h: 30 };
    const pill = { x: 376, y: 198 };
    const cap = placeCaption(box, pill, vp, "라벨", "짧은 설명", [
      { x: pill.x, y: pill.y, w: PILL_SIZE, h: PILL_SIZE },
    ]);
    expect(cap.card.w).toBe(HOVER_CARD_WIDTH);
    expect(cap.card.x).toBeGreaterThanOrEqual(8);
    expect(cap.card.x + cap.card.w).toBeLessThanOrEqual(vp.w - 8);
    expect(cap.card.y).toBeGreaterThanOrEqual(8);
    expect(cap.card.y + cap.card.h).toBeLessThanOrEqual(vp.h - 8);
  });
  it("좁은 창에서는 폭이 뷰포트 패드를 남긴다", () => {
    const box = { x: 20, y: 40, w: 80, h: 24 };
    const pill = { x: 8, y: 40 };
    const cap = placeCaption(box, pill, { w: 200, h: 400 }, "라벨", "짧다", []);
    expect(cap.card.w).toBe(200 - 16);
  });
  it("공간·알약 충돌이 없으면 타겟 아래를 고른다", () => {
    const box = { x: 400, y: 200, w: 80, h: 30 };
    const pill = { x: 376, y: 198 };
    const cap = placeCaption(box, pill, vp, "라벨", "짧은 설명", [
      { x: pill.x, y: pill.y, w: PILL_SIZE, h: PILL_SIZE },
    ]);
    expect(cap.card.y).toBeGreaterThanOrEqual(box.y + box.h);
  });
  it("넓은 행은 하단에 두고 거리가 16을 넘으면 스템이 있다", () => {
    const box = { x: 20, y: 80, w: 700, h: 36 };
    const pill = { x: 8, y: 80 };
    const cap = placeCaption(box, pill, vp, "라벨", "짧은 설명", [
      { x: pill.x, y: pill.y, w: PILL_SIZE, h: PILL_SIZE },
    ]);
    expect(box.w).toBeGreaterThan(vp.w * 0.6);
    expect(cap.card.y).toBeGreaterThan(vp.h * 0.5);
    expect(cap.stem).not.toBeNull();
  });
  it("툴바 8알약 vs 포커스 1 카드가 나머지 7과 overlap 0", () => {
    const anchors = [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
      a({ key: `t${i}`, n: i + 1, box: { x: 16 + i * 72, y: 8, w: 64, h: 32 } }),
    );
    const pills = placePills(anchors, vp);
    const focus = pills[0]!;
    const occupied = pills.map((p) => ({ x: p.pill.x, y: p.pill.y, w: PILL_SIZE, h: PILL_SIZE }));
    const cap = placeCaption(focus.box, focus.pill, vp, focus.label, focus.body, occupied);
    for (const p of occupied.slice(1)) {
      expect(overlapArea(cap.card, p)).toBe(0);
    }
  });
});
