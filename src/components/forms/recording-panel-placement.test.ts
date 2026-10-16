import { describe, expect, it } from "vitest";
import { CAPSULE_EXPANDED_WIDTH, PANEL_GAP, VIEWPORT_EDGE, capsuleFootprint, placeRecordingPanel, stackFootprint, type Box, type PanelPlacement } from "./recording-panel-placement";

/**
 * 녹음 정보창 자리(원장 2026-10-14 "녹음 아이콘 위치에 따라 스마트하게 보기 좋은 위치로. 너무 몰려있지않게").
 * 캡슐 = 앵커가 펼친 CAPSULE_EXPANDED_WIDTH 자리(자리 계산은 앵커 크기와 무관한 순수 함수라 여기선 48px 상자로 잰다).
 * 앵커 좌표는 use-recording-position이 화면 16px 안으로 묶는다.
 */
const DESK = { width: 1440, height: 900 };
const PANEL = { width: 320, height: 200 };
const anchorAt = (left: number, top: number): Box => ({ left, top, width: 48, height: 48 });
/** 화면 폭으로 펼치는 쪽을 고르는 규칙(use-recording-position chooseSide)과 같게 */
const sideFor = (anchor: Box, viewport: { width: number }) => viewport.width - anchor.left >= CAPSULE_EXPANDED_WIDTH + 16 ? "right" : "left";

function place(anchor: Box, viewport = DESK, panel = PANEL, side = sideFor(anchor, viewport)) {
  const capsule = capsuleFootprint(anchor, side);
  return { capsule, at: placeRecordingPanel({ capsule, panel, viewport }), panel, viewport };
}
function panelBox({ at, panel, viewport }: { at: PanelPlacement; panel: { width: number; height: number }; viewport: { width: number; height: number } }): Box {
  return { left: at.left, top: at.top, width: Math.min(panel.width, viewport.width - VIEWPORT_EDGE * 2), height: at.maxHeight ?? panel.height };
}
const overlaps = (a: Box, b: Box) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
function expectInsideAndClear(result: ReturnType<typeof place>) {
  const box = panelBox(result);
  expect(box.left).toBeGreaterThanOrEqual(VIEWPORT_EDGE);
  expect(box.top).toBeGreaterThanOrEqual(VIEWPORT_EDGE);
  expect(box.left + box.width).toBeLessThanOrEqual(result.viewport.width - VIEWPORT_EDGE);
  expect(box.top + box.height).toBeLessThanOrEqual(result.viewport.height - VIEWPORT_EDGE);
  expect(overlaps(box, result.capsule)).toBe(false);
}

describe("capsuleFootprint — 정보창이 피해야 할 펼친 캡슐", () => {
  it("왼쪽으로 펼치면 앵커 오른쪽 끝에서, 오른쪽으로 펼치면 앵커 왼쪽 끝에서 펼친 폭만큼", () => {
    const wide = CAPSULE_EXPANDED_WIDTH;
    expect(capsuleFootprint(anchorAt(1376, 772), "left")).toEqual({ left: 1376 + 48 - wide, top: 772, width: wide, height: 48 });
    expect(capsuleFootprint(anchorAt(16, 772), "right")).toEqual({ left: 16, top: 772, width: wide, height: 48 });
    expect(capsuleFootprint(anchorAt(16, 772), undefined).left).toBe(16 + 48 - wide);
  });
});

describe("placeRecordingPanel — 네 귀퉁이·가운데", () => {
  it("오른쪽 아래(새 녹음 기본 자리) = 위로, 캡슐 오른쪽 끝에 맞춰, 16px 띄워", () => {
    const result = place(anchorAt(1376, 772));
    expect(result.at).toEqual({ side: "top", left: 1424 - 320, top: 772 - PANEL_GAP - 200, maxHeight: null });
    expectInsideAndClear(result);
  });
  it("왼쪽 위 = 아래로, 왼쪽 끝에 맞춰", () => {
    const result = place(anchorAt(16, 16));
    expect(result.at).toEqual({ side: "bottom", left: 16, top: 64 + PANEL_GAP, maxHeight: null });
    expectInsideAndClear(result);
  });
  it("오른쪽 위 = 아래로, 오른쪽 끝에 맞춰", () => {
    const result = place(anchorAt(1376, 16));
    expect(result.at).toMatchObject({ side: "bottom", left: 1104, top: 80 });
    expectInsideAndClear(result);
  });
  it("왼쪽 아래 = 위로, 왼쪽 끝에 맞춰", () => {
    const result = place(anchorAt(16, 836));
    expect(result.at).toMatchObject({ side: "top", left: 16, top: 836 - PANEL_GAP - 200 });
    expectInsideAndClear(result);
  });
  it("가운데 = 캡슐 가운데에 맞춰, 위·아래 공간이 같으면 위", () => {
    const result = place(anchorAt(696, 426));
    const capsuleCenter = result.capsule.left + result.capsule.width / 2;
    expect(result.at.side).toBe("top");
    expect(result.at.left + 320 / 2).toBe(capsuleCenter);
    expectInsideAndClear(result);
  });
  it("세로는 공간이 더 넓은 쪽 — 위쪽 절반이면 아래로, 아래쪽 절반이면 위로", () => {
    expect(place(anchorAt(696, 300)).at.side).toBe("bottom");
    expect(place(anchorAt(696, 560)).at.side).toBe("top");
  });
});

describe("placeRecordingPanel — 좁은 화면·화면 끝", () => {
  it("폰 폭(360) — 정보창이 화면 폭을 다 쓰고 16px 안쪽에", () => {
    const viewport = { width: 360, height: 640 };
    const result = place(anchorAt(296, 512), viewport, { width: 328, height: 220 });
    expect(result.at).toMatchObject({ side: "top", left: 16, maxHeight: null });
    expectInsideAndClear(result);
  });
  it("측정 폭이 화면보다 넓어도 16px 가장자리를 지킨다", () => {
    const viewport = { width: 300, height: 640 };
    const result = place(anchorAt(236, 512), viewport, { width: 320, height: 220 });
    expect(result.at.left).toBe(16);
    expectInsideAndClear(result);
  });
  it("캡슐이 화면 끝에 붙어 펼친 자리가 화면 밖으로 나가도(끄는 중 옛 방향) 정보창은 화면 안", () => {
    const result = place(anchorAt(16, 400), DESK, PANEL, "left");
    expect(result.capsule.left).toBeLessThan(0);
    expectInsideAndClear(result);
  });
  it("오른쪽 끝·아래 끝에 붙은 캡슐", () => {
    expectInsideAndClear(place(anchorAt(1440 - 64, 900 - 64)));
    expectInsideAndClear(place(anchorAt(1440 - 64, 420)));
  });
  it("위·아래가 다 모자란 낮은 화면 = 캡슐 옆(넓은 쪽)으로", () => {
    const viewport = { width: 1024, height: 300 };
    const result = place(anchorAt(960, 172), viewport, { width: 320, height: 220 });
    expect(result.at.side).toBe("left");
    expect(result.at.left + 320).toBe(result.capsule.left - PANEL_GAP);
    expectInsideAndClear(result);
  });
  it("옆에도 안 들어가면 넓은 쪽에 높이를 줄여 넣는다(정보창 안에서 스크롤)", () => {
    const viewport = { width: 360, height: 300 };
    const result = place(anchorAt(296, 172), viewport, { width: 328, height: 240 });
    expect(result.at).toEqual({ side: "top", left: 16, top: VIEWPORT_EDGE, maxHeight: 172 - PANEL_GAP - VIEWPORT_EDGE });
    expectInsideAndClear(result);
  });
  it("캡슐을 피할 자리가 없는 아주 작은 화면 — 화면 안으로만 자른다", () => {
    const viewport = { width: 200, height: 150 };
    const result = place(anchorAt(136, 22), viewport, { width: 168, height: 200 });
    const box = panelBox(result);
    expect(box.top).toBeGreaterThanOrEqual(VIEWPORT_EDGE);
    expect(box.top + box.height).toBeLessThanOrEqual(viewport.height - VIEWPORT_EDGE);
    expect(box.left).toBeGreaterThanOrEqual(VIEWPORT_EDGE);
  });
  it("정보창이 길어지면(녹음 완료 안내·오류) 다시 재도 캡슐을 덮지 않는다", () => {
    for (const height of [180, 260, 420, 700]) expectInsideAndClear(place(anchorAt(1376, 772), DESK, { width: 320, height }));
  });
});
/** 원장 2026-10-16 여러 녹음 — 정보창이 위에 쌓인 다른 녹음 아이콘을 덮으면 그 녹음으로 옮겨 갈 수 없다. */
describe("stackFootprint — 쌓인 녹음 아이콘 묶음", () => {
  const icon = (top: number, left = 1175): Box => ({ left, top, width: 88, height: 60 });
  it("같은 줄로 맞닿아 쌓인 아이콘은 하나로 묶고, 정보창은 묶음 전체를 피한다", () => {
    const own = icon(748);
    const stack = stackFootprint(own, [icon(676), icon(604)]);
    expect(stack).toEqual({ left: 1175, top: 604, width: 88, height: 204 });
    const at = placeRecordingPanel({ capsule: stack, panel: PANEL, viewport: DESK });
    expect(overlaps({ left: at.left, top: at.top, width: PANEL.width, height: at.maxHeight ?? PANEL.height }, stack)).toBe(false);
  });
  it("끌어서 떨어뜨린 아이콘(다른 줄·멀리)은 묶지 않는다", () => {
    const own = icon(748);
    expect(stackFootprint(own, [icon(100, 16), icon(400)])).toEqual(own);
  });
  it("가운데가 빠져도 이어진 것만 — 사이가 벌어지면 끊는다", () => {
    expect(stackFootprint(icon(748), [icon(676), icon(300)])).toEqual({ left: 1175, top: 676, width: 88, height: 132 });
  });
});
