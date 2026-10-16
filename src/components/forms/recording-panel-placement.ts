/**
 * 녹음 정보창 자리 — 떠 있는 녹음 캡슐이 화면 어디에 있는지로 정한다(원장 2026-10-14
 * *"녹음 아이콘 위치에 따라 스마트하게 보기 좋은 위치로. 너무 몰려있지않게"*).
 *
 * - 세로: 캡슐 위·아래 중 **공간이 더 넓은 쪽**(같으면 위).
 * - 가로: 캡슐이 화면 오른쪽 1/3이면 오른쪽 끝, 왼쪽 1/3이면 왼쪽 끝, 가운데면 가운데에 맞춘다.
 * - 캡슐과 정보창 사이는 `PANEL_GAP`, 화면 가장자리는 `VIEWPORT_EDGE`만큼 띄운다. 정보창은 캡슐을 덮지 않는다.
 * - 위·아래 어디에도 다 안 들어가면 캡슐 옆(왼쪽·오른쪽 중 넓은 쪽)으로, 거기도 안 되면 위·아래 중 넓은 쪽에
 *   높이를 줄여(`maxHeight` — 정보창이 안에서 스크롤) 넣는다. 캡슐과 겹치지 않는 자리가 아예 없을 만큼 작은
 *   화면에서만 화면 안으로 자른다.
 *
 * DOM을 모르는 순수 함수다 — 측정은 호출부(`recording-runtime.tsx`)가 하고 여기서는 계산만 한다.
 */
export const PANEL_GAP = 16;
export const VIEWPORT_EDGE = 16;
/** 접힌 캡슐(마이크 + 그 밑의 제목) — CSS(`recording-runtime.module.css`)의 88×60px과 같은 값. */
export const CAPSULE_WIDTH = 88;
export const CAPSULE_HEIGHT = 60;
/** 펼친 캡슐 폭(시간까지) — CSS의 152px과 같은 값. */
export const CAPSULE_EXPANDED_WIDTH = 152;
/** 높이를 줄여 넣을 때 이보다 낮아지면 쓸 수 없는 판이라 그 자리를 버린다. */
const MIN_PANEL_HEIGHT = 120;

export type Box = { left: number; top: number; width: number; height: number };
export type PanelSide = "top" | "bottom" | "left" | "right";
export type PanelPlacement = { left: number; top: number; maxHeight: number | null; side: PanelSide };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));

/**
 * 정보창이 피해야 할 캡슐 자리 — 정보창이 열린 동안 캡슐은 시간까지 펼쳐 둔다. 펼치는 쪽(`data-side`)은
 * `right`면 앵커 왼쪽 끝에서 오른쪽으로, 그 밖에는 앵커 오른쪽 끝에서 왼쪽으로 자란다.
 */
export function capsuleFootprint(anchor: Box, side: string | undefined): Box {
  const width = Math.max(anchor.width, CAPSULE_EXPANDED_WIDTH);
  const left = side === "right" ? anchor.left : anchor.left + anchor.width - width;
  return { left, top: anchor.top, width, height: anchor.height };
}

/** 쌓인 녹음 아이콘을 한 묶음으로 보는 간격 — 새 아이콘은 12px 간격으로 위에 쌓인다(use-recording-position). */
const STACK_NEAR = 16;

/**
 * 정보창이 피해야 할 녹음 아이콘 묶음 — 이 아이콘과, 그것과 같은 줄(가로가 겹친다)로 맞닿아 쌓인 다른 녹음 아이콘들을 합친
 * 상자(원장 2026-10-16 여러 녹음). 자기 아이콘만 피하면 정보창이 위에 쌓인 다른 녹음 아이콘을 덮어 누를 수 없었다.
 * 끌어서 따로 떨어뜨린 아이콘은 묶지 않는다(화면 반대편 아이콘까지 묶으면 정보창 자리가 사라진다).
 */
export function stackFootprint(own: Box, others: readonly Box[]): Box {
  let union = own;
  const rest = [...others];
  for (let grew = true; grew;) {
    grew = false;
    for (let i = rest.length - 1; i >= 0; i--) {
      const box = rest[i];
      const sameColumn = box.left < union.left + union.width && union.left < box.left + box.width;
      const touching = box.top <= union.top + union.height + STACK_NEAR && union.top <= box.top + box.height + STACK_NEAR;
      if (!sameColumn || !touching) continue;
      const left = Math.min(union.left, box.left);
      const top = Math.min(union.top, box.top);
      union = { left, top, width: Math.max(union.left + union.width, box.left + box.width) - left, height: Math.max(union.top + union.height, box.top + box.height) - top };
      rest.splice(i, 1);
      grew = true;
    }
  }
  return union;
}

/** 캡슐 중심이 축의 어느 1/3에 있는지로 정보창의 시작 좌표를 고른다(끝 맞춤·가운데·시작 맞춤). */
function alignOnAxis(start: number, size: number, panelSize: number, viewportSize: number): number {
  const center = start + size / 2;
  if (center >= (viewportSize * 2) / 3) return start + size - panelSize;
  if (center <= viewportSize / 3) return start;
  return center - panelSize / 2;
}

export function placeRecordingPanel({ capsule, panel, viewport }: {
  capsule: Box;
  panel: { width: number; height: number };
  viewport: { width: number; height: number };
}): PanelPlacement {
  const width = Math.min(panel.width, Math.max(0, viewport.width - VIEWPORT_EDGE * 2));
  const fullHeight = Math.min(panel.height, Math.max(0, viewport.height - VIEWPORT_EDGE * 2));
  const right = capsule.left + capsule.width;
  const bottom = capsule.top + capsule.height;
  const above = capsule.top - PANEL_GAP - VIEWPORT_EDGE;
  const below = viewport.height - VIEWPORT_EDGE - PANEL_GAP - bottom;
  const verticalSide: PanelSide = below > above ? "bottom" : "top";
  const verticalSpace = Math.max(above, below);
  const xFor = () => clamp(alignOnAxis(capsule.left, capsule.width, width, viewport.width), VIEWPORT_EDGE, viewport.width - VIEWPORT_EDGE - width);
  const yFor = (side: PanelSide, height: number) => side === "top" ? capsule.top - PANEL_GAP - height : bottom + PANEL_GAP;

  if (panel.height <= verticalSpace) {
    return { side: verticalSide, left: xFor(), top: yFor(verticalSide, panel.height), maxHeight: null };
  }

  const leftSpace = capsule.left - PANEL_GAP - VIEWPORT_EDGE;
  const rightSpace = viewport.width - VIEWPORT_EDGE - PANEL_GAP - right;
  if (width <= Math.max(leftSpace, rightSpace)) {
    const side: PanelSide = rightSpace > leftSpace ? "right" : "left";
    const top = clamp(alignOnAxis(capsule.top, capsule.height, fullHeight, viewport.height), VIEWPORT_EDGE, viewport.height - VIEWPORT_EDGE - fullHeight);
    return { side, left: side === "right" ? right + PANEL_GAP : capsule.left - PANEL_GAP - width, top, maxHeight: fullHeight < panel.height ? fullHeight : null };
  }

  if (verticalSpace >= MIN_PANEL_HEIGHT) {
    return { side: verticalSide, left: xFor(), top: yFor(verticalSide, verticalSpace), maxHeight: verticalSpace };
  }

  // 캡슐을 피할 자리가 없는 아주 작은 화면 — 화면 안으로 자른다(정보창이 안에서 스크롤).
  const top = clamp(yFor(verticalSide, fullHeight), VIEWPORT_EDGE, viewport.height - VIEWPORT_EDGE - fullHeight);
  return { side: verticalSide, left: xFor(), top, maxHeight: fullHeight < panel.height ? fullHeight : null };
}
