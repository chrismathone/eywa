/**
 * 윈도우 기하 — 순수 함수(테스트 강제). DOM·React 무관.
 * 좌표계: 캔버스 로컬(0,0 = 캔버스 좌상단). bounds = 캔버스 크기.
 */
export type Rect = { x: number; y: number; w: number; h: number };
export type Bounds = { width: number; height: number };
export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
// 절반(left/right/top/bottom)·최대화(max)·1/4 모서리(tl/tr/bl/br)
export type SnapZone =
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "max"
  | "tl"
  | "tr"
  | "bl"
  | "br"
  | null;

export const MIN_W = 360;
export const MIN_H = 280;

/** 캔버스 안으로 + 최소 크기 보장하여 보정. */
export function clampRect(rect: Rect, bounds: Bounds): Rect {
  const w = Math.min(Math.max(rect.w, MIN_W), Math.max(MIN_W, bounds.width));
  const h = Math.min(Math.max(rect.h, MIN_H), Math.max(MIN_H, bounds.height));
  const x = Math.min(Math.max(rect.x, 0), Math.max(0, bounds.width - w));
  const y = Math.min(Math.max(rect.y, 0), Math.max(0, bounds.height - h));
  return { x, y, w, h };
}

/** 기본 창 크기(폼·목록 등 일반 메뉴). */
export const DEFAULT_WINDOW = { w: 480, h: 560 };

/**
 * 라우트(메뉴)별 기본 창 크기 — 넓은 표는 크게 열어 가로 스크롤을 최소화한다.
 * 없는 메뉴는 DEFAULT_WINDOW. 캔버스보다 크면 cascadeNext에서 clamp됨.
 */
export const ROUTE_WINDOW_SIZE: Record<string, { w: number; h: number }> = {
  timetable: { w: 1040, h: 680 }, // 강사×요일 표라 폭이 넓음
  classes: { w: 1100, h: 700 }, // 8열 표 + 필터바(과목·강사·요일·정렬·검색) — 넓으면 한 줄
  billing: { w: 760, h: 620 }, // 수납/교재/지출 책갈피 + 다열 표라 폭이 넓음
  // 학생×30~31일 매트릭스. 폭이 좁으면 이름 칼럼이 글자당 줄바꿈돼 행이 2배로 커지고(세로 스크롤
  // 유발), 1280이면 30·31일 달 모두 이름이 한 줄로 펴져 콘텐츠가 ~488px로 줄어든다(세로 스크롤 제거).
  attendance: { w: 1280, h: 620 },
  exams: { w: 960, h: 680 }, // 시험 목록(통계 열) + 반 일괄 점수 그리드
  lesson_reports: { w: 980, h: 720 }, // 수업보고서 발송 관리 — 발송 큐 + 강사별 작성률 + 목록(다열 표·필터)
  consultations: { w: 760, h: 640 }, // 상담 목록(카드)·상세(내용+AI 7섹션) — 읽기 콘텐츠라 기본 480은 좁음. 상세 id도 prefix 상속

  "staff/payroll": { w: 920, h: 640 }, // 월별 전직원 급여표(8열) — 폭 넓음
  "staff/resumes": { w: 840, h: 720 }, // 직원 이력서(작성 폼·A4형 시트 뷰) — 상세 id도 prefix로 상속
  "billing/refunds": { w: 840, h: 720 }, // 환불 요청서(작성 폼·A4형 시트 뷰) — 상세 id도 prefix로 상속
  owner: { w: 960, h: 720 }, // 학원 설정 콘솔 — 탭 + 목록 편집(과목·교시·직급) 폼
  documents: { w: 980, h: 640 }, // 데이터베이스(서식 저장소) — 탐색기형(좌 폴더 팬 + 우 상세 테이블)
  // ⚠️ 메뉴 루트 창 id는 경로가 아니라 menuKey(언더스코어) — windowIdForHref가 menuKey를 반환한다.
  textbook_requests: { w: 1180, h: 760 }, // 교재 요청 — ijw 구조(좌 폼 + 우 실시간 요청서 미리보기 720px)
  // "새 X" 생성 폼 창(옛 우측 슬라이드 패널 폭 계승). 기본 480×560은 다열 폼엔 좁다.
  "classes/new": { w: 760, h: 680 },
  "staff/new": { w: 620, h: 680 },
  "students/new": { w: 760, h: 680 },
  "enrollment/new": { w: 820, h: 700 },
  "consultations/new": { w: 700, h: 660 },
  "meetings/new": { w: 600, h: 640 },
  "billing/expenses": { w: 720, h: 860 }, // 지출결의서 A4 문서(세로형) — 폭보다 높이가 필요
  // 인쇄 문서 창(세로 A4). 창 id 규약 `print/<type>/<recordId>` → longest-prefix가 `print/<type>` 매칭.
  // (windowIdForHref가 만드는 `enrollment/123/print`는 매칭 못 해 DEFAULT로 떨어지므로 명시 id 사용.)
  "print/enrollment": { w: 840, h: 1120 }, // 신입생 인수인계서
  "print/meetings": { w: 840, h: 1120 }, // 회의록
  "print/textbook": { w: 800, h: 1040 }, // 교재요청서 카드(짧음)
  "print/lesson_reports": { w: 840, h: 1120 }, // 수업 보고서(원스크린 PDF)
};

/**
 * 라우트 창 id → 기본 크기. 정확 매칭 후 **세그먼트 경로 longest-prefix**로 폴백 →
 * 상세 라우트(예: "billing/expenses/<uuid>", "exams/123")가 부모 등록 크기를 상속한다.
 * 등록된 다중 세그먼트 키(staff/payroll·…/new)는 마지막 세그먼트가 정적이라 상세 id가 오인 매칭하지 않음.
 * 없으면 undefined(→ 호출부가 DEFAULT_WINDOW).
 */
export function routeWindowSize(id: string): { w: number; h: number } | undefined {
  if (ROUTE_WINDOW_SIZE[id]) return ROUTE_WINDOW_SIZE[id];
  const seg = id.split("/");
  for (let i = seg.length - 1; i >= 1; i--) {
    const prefix = seg.slice(0, i).join("/");
    if (ROUTE_WINDOW_SIZE[prefix]) return ROUTE_WINDOW_SIZE[prefix];
  }
  return undefined;
}

/**
 * 커서(스테이지 로컬 sx,sy) 위치에서 새 창이 뜨도록 배치 — 타이틀바가 커서 바로 아래(약간 좌상)에
 * 오게 해 "클릭한 자리에서 팝업" 느낌. 화면 밖이면 clampRect로 안으로 보정. 링크 클릭 등 포인터가
 * 있는 열기에 사용(없으면 cascadeNext). restoreUnderPointer와 같은 "커서 아래" 컨벤션.
 */
export function rectAtPoint(sx: number, sy: number, bounds: Bounds, size = DEFAULT_WINDOW): Rect {
  const w = Math.min(size.w, Math.max(MIN_W, bounds.width - 40));
  const h = Math.min(size.h, Math.max(MIN_H, bounds.height - 40));
  return clampRect({ x: sx - 20, y: sy - 14, w, h }, bounds);
}

/** 새 창 기본 위치 — 인덱스만큼 cascade 오프셋(겹쳐 쌓이지 않게), 화면 넘으면 wrap. */
export function cascadeNext(count: number, bounds: Bounds, size = DEFAULT_WINDOW): Rect {
  const w = Math.min(size.w, Math.max(MIN_W, bounds.width - 40));
  const h = Math.min(size.h, Math.max(MIN_H, bounds.height - 40));
  const step = 28;
  const span = Math.max(0, Math.min(bounds.width - w, bounds.height - h) - 24);
  const offset = span > 0 ? (count * step) % (span + 1) : 0;
  return clampRect({ x: 24 + offset, y: 24 + offset, w, h }, bounds);
}

/**
 * 스포트라이트 포커스 창 영역 — 상단 중앙 큰 박스(하단 ~40%는 커버 스트립 몫).
 * 폭 min(스테이지-32, 1100), 높이 ≈ 60%, 좌우 중앙, top 16. clampRect로 최소크기 보정.
 */
export function spotlightTop(bounds: Bounds): Rect {
  const w = Math.min(bounds.width - 32, 1100);
  const h = Math.round(bounds.height * 0.6);
  const x = Math.round((bounds.width - w) / 2);
  return clampRect({ x, y: 16, w, h }, bounds);
}

/**
 * 스포트라이트 상단 타일 — 올라온 창(spotlightRaised) count개를 상단 영역에 가로로 균등 타일.
 * count<=1이면 spotlightTop(중앙 큰 박스 1개). 2~3개면 좌우로 분할(가운데 gap). 하단 ~40%는 커버 스트립 몫.
 */
export function spotlightTile(bounds: Bounds, index: number, count: number): Rect {
  if (count <= 1) return spotlightTop(bounds);
  const margin = 16;
  const gap = 14;
  const h = Math.round(bounds.height * 0.6);
  const areaW = bounds.width - margin * 2;
  const w = Math.round((areaW - gap * (count - 1)) / count);
  const x = margin + index * (w + gap);
  return clampRect({ x, y: 16, w, h }, bounds);
}

/** 스냅 존 → 목표 사각형(좌/우 절반·전체 최대화·1/4 모서리). */
export function snapTarget(zone: SnapZone, bounds: Bounds): Rect | null {
  const hw = Math.round(bounds.width / 2);
  const hh = Math.round(bounds.height / 2);
  switch (zone) {
    case "left":
      return { x: 0, y: 0, w: hw, h: bounds.height };
    case "right":
      return { x: bounds.width - hw, y: 0, w: hw, h: bounds.height };
    case "top":
      return { x: 0, y: 0, w: bounds.width, h: hh };
    case "bottom":
      return { x: 0, y: bounds.height - hh, w: bounds.width, h: hh };
    case "max":
      return { x: 0, y: 0, w: bounds.width, h: bounds.height };
    case "tl":
      return { x: 0, y: 0, w: hw, h: hh };
    case "tr":
      return { x: bounds.width - hw, y: 0, w: hw, h: hh };
    case "bl":
      return { x: 0, y: bounds.height - hh, w: hw, h: hh };
    case "br":
      return { x: bounds.width - hw, y: bounds.height - hh, w: hw, h: hh };
    default:
      return null;
  }
}

/**
 * 드래그 포인터가 캔버스 가장자리 근처면 스냅 존 반환.
 * 우선순위: 모서리(1/4) > 상/하/좌/우 가장자리(절반). 좌/우 가장자리에 닿은 채
 * 상·하 corner 밴드 안이면 1/4, 가운데면 절반. (최대화는 드래그 아닌 버튼/더블클릭)
 */
export function snapZoneForPoint(
  px: number,
  py: number,
  bounds: Bounds,
  edge = 24,
  corner = 80,
): SnapZone {
  const nearLeft = px <= edge;
  const nearRight = px >= bounds.width - edge;
  if (nearLeft && py <= corner) return "tl";
  if (nearRight && py <= corner) return "tr";
  if (nearLeft && py >= bounds.height - corner) return "bl";
  if (nearRight && py >= bounds.height - corner) return "br";
  if (py <= edge) return "top";
  if (py >= bounds.height - edge) return "bottom";
  if (nearLeft) return "left";
  if (nearRight) return "right";
  return null;
}

export type LayoutTemplate = "split" | "stack" | "thirds";

/**
 * 레이아웃 템플릿 → 슬롯 사각형 배열(슬롯0 = 앵커 위치). Snap Assist 자동 타일링용.
 * anchorSide = 앵커가 놓인 쪽. split=좌우 절반, stack=앵커 full-half + 반대 상/하 ¼(1+2),
 * thirds=세로 3컬럼(앵커가 자기 쪽 끝 컬럼). 각 슬롯 clampRect.
 */
export function layoutSlots(
  template: LayoutTemplate,
  bounds: Bounds,
  anchorSide: "left" | "right",
): Rect[] {
  const W = bounds.width;
  const H = bounds.height;
  const hw = Math.round(W / 2);
  const hh = Math.round(H / 2);
  const left = anchorSide === "left";
  let slots: Rect[];
  if (template === "split") {
    const a = left ? { x: 0, y: 0, w: hw, h: H } : { x: W - hw, y: 0, w: hw, h: H };
    const b = left ? { x: W - hw, y: 0, w: hw, h: H } : { x: 0, y: 0, w: hw, h: H };
    slots = [a, b];
  } else if (template === "stack") {
    const a = left ? { x: 0, y: 0, w: hw, h: H } : { x: W - hw, y: 0, w: hw, h: H };
    const sx = left ? W - hw : 0;
    slots = [a, { x: sx, y: 0, w: hw, h: hh }, { x: sx, y: H - hh, w: hw, h: hh }];
  } else {
    const t = Math.round(W / 3);
    const cols = [
      { x: 0, y: 0, w: t, h: H },
      { x: t, y: 0, w: W - 2 * t, h: H },
      { x: W - t, y: 0, w: t, h: H },
    ];
    slots = left ? [cols[0], cols[1], cols[2]] : [cols[2], cols[1], cols[0]];
  }
  return slots.map((r) => clampRect(r, bounds));
}

// ── Snap Layouts 바 (Windows 11식, 드래그 중 상단 레이아웃 선택) ──────────────
type Frac = { x: number; y: number; w: number; h: number };

/** 템플릿 → 고정방향 분수 슬롯(0~1). 좌=좌, 1+2=좌1·우2. clamp 없음(바·미리보기 공용). */
export function templateFractions(t: LayoutTemplate): Frac[] {
  if (t === "split") {
    return [
      { x: 0, y: 0, w: 0.5, h: 1 },
      { x: 0.5, y: 0, w: 0.5, h: 1 },
    ];
  }
  if (t === "stack") {
    return [
      { x: 0, y: 0, w: 0.5, h: 1 },
      { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ];
  }
  return [
    { x: 0, y: 0, w: 1 / 3, h: 1 },
    { x: 1 / 3, y: 0, w: 1 / 3, h: 1 },
    { x: 2 / 3, y: 0, w: 1 / 3, h: 1 },
  ];
}

/** 분수 슬롯 × bounds → 실제 rect(clamp). */
export function templateSlots(t: LayoutTemplate, bounds: Bounds): Rect[] {
  return templateFractions(t).map((f) =>
    clampRect({ x: f.x * bounds.width, y: f.y * bounds.height, w: f.w * bounds.width, h: f.h * bounds.height }, bounds),
  );
}

/** 열린 창 수에 맞는 바 템플릿 목록. */
export function snapBarTemplates(count: number): LayoutTemplate[] {
  if (count >= 3) return ["split", "stack", "thirds"];
  if (count === 2) return ["split"];
  return [];
}

const BAR = { cell: 92, diagH: 52, gap: 10, padX: 10, padY: 8, labelH: 16, top: 14 };

export type SnapBar = {
  x: number;
  y: number;
  w: number;
  h: number;
  items: { template: LayoutTemplate; box: Rect; cells: Frac[] }[];
};

/** 상단 중앙 스냅 레이아웃 바의 기하(스테이지 좌표). 렌더·히트테스트 단일 소스. count<2면 null. */
export function snapBar(bounds: Bounds, count: number): SnapBar | null {
  const templates = snapBarTemplates(count);
  const n = templates.length;
  if (n === 0) return null;
  const { cell, diagH, gap, padX, padY, labelH, top } = BAR;
  const w = n * cell + (n - 1) * gap + padX * 2;
  const h = diagH + labelH + padY * 2 + 4;
  const x = Math.round((bounds.width - w) / 2);
  const y = top;
  const items = templates.map((t, i) => {
    const bx = x + padX + i * (cell + gap);
    const by = y + padY;
    const box = { x: bx, y: by, w: cell, h: diagH };
    const cells = templateFractions(t).map((f) => ({
      x: bx + f.x * cell,
      y: by + f.y * diagH,
      w: f.w * cell,
      h: f.h * diagH,
    }));
    return { template: t, box, cells };
  });
  return { x, y, w, h, items };
}

/** 스테이지 로컬 포인터가 바의 어느 템플릿·슬롯 위인지(없으면 null). */
export function snapBarHitTest(
  px: number,
  py: number,
  bounds: Bounds,
  count: number,
): { template: LayoutTemplate; slot: number } | null {
  const bar = snapBar(bounds, count);
  if (!bar) return null;
  if (px < bar.x || px > bar.x + bar.w || py < bar.y || py > bar.y + bar.h) return null;
  for (const item of bar.items) {
    for (let s = 0; s < item.cells.length; s++) {
      const c = item.cells[s];
      if (px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h) {
        return { template: item.template, slot: s };
      }
    }
  }
  return null;
}

/**
 * 배경 드롭 존 — 라우트 창을 드래그해 상단 중앙 이 칩에 놓으면 "배경으로 보내기"(swapToBackground).
 * 스냅 바(창 2개+에서만 노출)와 독립 → 창이 1개여도 동작. 충돌 회피용으로 스냅 바는
 * SNAP_BAR_BG_OFFSET만큼 아래로 밀어 그린다(렌더·히트테스트 동일 오프셋). 타이틀바 "배경으로 보내기"
 * 버튼과 공존(중복 경로).
 */
export const SNAP_BAR_BG_OFFSET = 44;
export function backgroundDropZone(bounds: Bounds): Rect {
  const w = Math.min(240, Math.max(160, bounds.width - 40));
  return { x: Math.round((bounds.width - w) / 2), y: 6, w, h: 30 };
}
export function pointInRect(px: number, py: number, r: Rect): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

/** 8방향 핸들 리사이즈 — 델타 적용 + 최소크기(이동변 보정) + 캔버스 clamp. */
export function resizeRect(
  rect: Rect,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  bounds: Bounds,
): Rect {
  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.w;
  let bottom = rect.y + rect.h;

  if (handle.includes("e")) right = rect.x + rect.w + dx;
  if (handle.includes("s")) bottom = rect.y + rect.h + dy;
  if (handle.includes("w")) left = rect.x + dx;
  if (handle.includes("n")) top = rect.y + dy;

  if (right - left < MIN_W) {
    if (handle.includes("w")) left = right - MIN_W;
    else right = left + MIN_W;
  }
  if (bottom - top < MIN_H) {
    if (handle.includes("n")) top = bottom - MIN_H;
    else bottom = top + MIN_H;
  }

  return clampRect({ x: left, y: top, w: right - left, h: bottom - top }, bounds);
}

/** id를 z-order 맨 앞(배열 끝)으로. idempotent. */
export function bringToFront(order: string[], id: string): string[] {
  return [...order.filter((i) => i !== id), id];
}
