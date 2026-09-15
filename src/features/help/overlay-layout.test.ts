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
  // 🔴 **key 있는 것만** 센다 — key 없는 설명은 겹침에 안 뜨는 목록 설명서 전용이라, 같이 세면
  //    검사 대상이 화면과 어긋난다(적대 리뷰 2026-09-15).
  const shown = MANUALS.flatMap((m) => m.callouts.filter((c) => c.key));
  const bodies = shown.map((c) => overlayPlainText(c.body));
  const longest = [...bodies].sort((a, b) => b.length - a.length)[0] ?? "";
  // 실측(2026-09-15, 프로젝트 글꼴로 크로미움·엣지 렌더)으로 **180px에서 두 줄 · 220px 이상에선 한 줄**인 실제 제목.
  const TWO_LINES_AT_180 = "그룹 설정 · 강사 순서 · 뷰 설정";

  it("실제로 3줄을 넘는 설명이 있다(이 전제가 무너지면 아래 검사가 공허해진다)", () => {
    const perLine = Math.floor((BALLOON_W - 20) / 15);
    expect(Math.ceil(longest.length / perLine)).toBeGreaterThan(3);
  });

  it("가장 긴 설명도 잘리지 않을 높이를 준다", () => {
    const perLine = Math.floor((BALLOON_W - 20) / 15);
    const lines = Math.ceil(longest.length / perLine);
    // 안쪽 여백(6×2) + 제목 줄(14×1.45=20.3) + 사이(2) + 본문 줄(14×1.375=19.25씩)
    expect(balloonHeight(longest)).toBeGreaterThanOrEqual(12 + 20.3 + 2 + lines * 19.25);
  });

  // 🔴 말풍선이 칸 폭에 맞춰 **200px 미만으로 좁아지면** 긴 제목이 번호와 함께 두 줄로 꺾인다 — 한 줄로
  //    못박으면 그만큼 본문 끝이 잘린다. 그래서 실제로 두 줄이 되는 폭(180px)에서 잰다.
  it("좁은 말풍선에서 긴 제목이 두 줄로 꺾이는 만큼 상자가 높아진다", () => {
    const body = "설명 한 줄입니다";
    expect(balloonHeight(body, 180, Infinity, TWO_LINES_AT_180)).toBeGreaterThan(
      balloonHeight(body, 180, Infinity, "짧다"),
    );
  });

  // 배선 — 배치가 제목을 높이 계산에 **실제로 넘기는지**. `balloonHeight`만 부르면 이 배선이 빠져도 통과한다.
  it("배치도 제목 줄 수를 반영한다(칸 폭 180px 말풍선)", () => {
    const box = { x: 40, y: 40, w: 180, h: 60 };
    const place = (label: string) =>
      placeOverlay([{ key: "k", n: 7, label, body: "설명 한 줄입니다", box }], vp)[0]!.balloon;
    expect(place(TWO_LINES_AT_180).w).toBe(180);
    expect(place(TWO_LINES_AT_180).h).toBeGreaterThan(place("짧다").h);
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
