/**
 * '화면 원래대로' 버튼이 설 **모서리** 고르기 — 순수 계산(DOM 판정은 호출부가 `collides`로 넘긴다).
 *
 * 버튼은 본문 위에 떠 있다(`fixed`). 자리를 따로 비우면(위 띠) 숨긴 헤더만큼의 높이를 도로 쓰게 되고, 떠 있으면
 * 그 아래 컨트롤을 가린다 — 시간표는 오른쪽 위가 하필 '편집' 버튼이다. 그래서 **기본은 오른쪽 위**(원장 지시)로 두고,
 * 그 자리 밑에 누를 것(버튼·링크·입력)이 있으면 다음 모서리로 비킨다. 네 곳이 다 막히면 지금 자리를 지킨다
 * (계속 뛰어다니는 버튼이 가리는 버튼보다 나쁘다).
 */
export type RestoreCorner = "top-right" | "bottom-right" | "bottom-left" | "top-left";

/** 비키는 순서 — 오른쪽 위가 원장 지정 자리, 다음은 툴바와 먼 아래쪽. */
export const RESTORE_CORNERS: readonly RestoreCorner[] = ["top-right", "bottom-right", "bottom-left", "top-left"];

/**
 * 가장자리 여백(px). 오른쪽은 셸 `<main>`의 세로 스크롤바 위에 앉지 않게 더 띄운다(얇은 스크롤바 ≈ 11px —
 * 버튼이 그 위에 앉으면 맨 위에서 스크롤바를 못 잡는다). 아래는 표의 가로 스크롤바를 피해 같은 만큼.
 */
export const RESTORE_INSET = { x: 20, y: 8, bottom: 20 } as const;

export type Rect = { left: number; top: number; width: number; height: number };

/** 모서리 → 버튼이 차지할 사각형(뷰포트 좌표). */
export function cornerRect(corner: RestoreCorner, size: { width: number; height: number }, viewport: { width: number; height: number }): Rect {
  const left = corner.endsWith("right") ? viewport.width - RESTORE_INSET.x - size.width : RESTORE_INSET.x;
  const top = corner.startsWith("top") ? RESTORE_INSET.y : viewport.height - RESTORE_INSET.bottom - size.height;
  return { left, top, width: size.width, height: size.height };
}

/** 겹침 판정에 쓸 점 — 네 귀퉁이(안쪽 2px)와 가운데. 버튼보다 작은 컨트롤도 한 점에는 걸린다. */
export function samplePoints(r: Rect): Array<[number, number]> {
  const l = r.left + 2;
  const t = r.top + 2;
  const rr = r.left + r.width - 2;
  const b = r.top + r.height - 2;
  return [
    [l, t],
    [rr, t],
    [l, b],
    [rr, b],
    [r.left + r.width / 2, r.top + r.height / 2],
  ];
}

/** 막히지 않은 첫 모서리(순서 = RESTORE_CORNERS). 전부 막혔으면 지금 자리. */
export function pickCorner(current: RestoreCorner, collides: (corner: RestoreCorner) => boolean): RestoreCorner {
  for (const c of RESTORE_CORNERS) if (!collides(c)) return c;
  return current;
}

/** 버튼 밑에 있으면 "가린다"고 보는 요소 — 누르거나 입력하는 것. */
export const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "label",
  "[contenteditable='true']",
  "[role='button']",
  "[role='link']",
  "[role='tab']",
  "[role='checkbox']",
  "[role='switch']",
  "[role='combobox']",
  "[role='menuitem']",
  "[role='option']",
  "[role='slider']",
].join(",");
