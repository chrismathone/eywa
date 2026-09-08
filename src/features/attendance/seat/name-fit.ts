/**
 * 자리(랩실·JJ실) 화면의 **이름 칸 글씨 맞추기** — 순수 함수(Vitest).
 *
 * 원장 2026-08-19: *"알파벳 때문에 이름이 짤리는 학생들, 짤리지 않게 그 학생만 이름 폰트 사이즈 줄이자."*
 * 동명이인을 가르는 알파벳 접미사(`김현준B`·`김준영D`)가 붙으면 세 글자 이름보다 한 뼘 길어져
 * 칸을 넘는다 — 실측(자리 슬롯 반 재원생 243명) 결과 **23명(9.5%)이 접미사 이름**이고, 이름은
 * 전부 2~4글자라 넘치는 건 사실상 이 접미사 한 글자다.
 *
 * 🔑 자르지 않고 **그 칩만** 한 단계씩 글씨를 줄인다. 칩 크기·격자·클릭 영역은 건드리지 않는다
 *    (글씨만 줄이므로 줄 높이도 그대로 — 소비처가 `leading-*`을 함께 고정한다).
 * 🔴 **하한이 있다** — 사다리 마지막 단계보다 작게는 안 간다. 거기서도 넘치면 `clipped`로 알려
 *    소비처가 말줄임 + 전체 이름 툴팁으로 마감한다(작아서 못 읽는 것보다 낫다).
 * ⚠️ 판정은 글자 수가 아니라 **표시 폭**이다 — `Kristine`(8글자·폭 3.60)은 `김하늘A`(4글자·폭 3.70)보다
 *    글자가 두 배 많아도 더 좁다.
 *    비율은 Pretendard Bold를 헤드리스 크롬으로 **글자마다 실측**해 표로 담았다(한글 1em, `A` 0.70em,
 *    `i` 0.28em, `W` 1.01em).
 * ⚠️ 남는 폭은 **가장 좁을 때**(격자 최소 폭)로 잡는다 — 창이 넓어 실제로는 더 널널할 수 있지만,
 *    넘쳐서 잘리는 쪽이 조금 작게 나오는 쪽보다 나쁘다.
 */

/**
 * 아스키 글자 폭 — Pretendard Bold **실측**(헤드리스 크롬, 한글 한 글자 = 1).
 *
 * ⚠️ 대문자·소문자로 뭉뚱그리면 안 된다: 같은 대문자라도 `W`(1.01)와 `I`(0.31)가 세 배 넘게 차이 난다.
 *    묶어서 그 무리의 최댓값으로 잡았더니 오차가 쌓여 `Kristine`이 "넘친다"로 잘못 나왔다(실제로는 들어간다).
 */
const ASCII_EM: Record<string, number> = {
  A: 0.7, B: 0.64, C: 0.64, D: 0.75, E: 0.54, F: 0.53, G: 0.72, H: 0.77, I: 0.31,
  J: 0.43, K: 0.65, L: 0.51, M: 0.96, N: 0.8, O: 0.78, P: 0.62, Q: 0.78, R: 0.65,
  S: 0.57, T: 0.58, U: 0.73, V: 0.67, W: 1.01, X: 0.65, Y: 0.61, Z: 0.61,
  a: 0.54, b: 0.63, c: 0.49, d: 0.63, e: 0.55, f: 0.37, g: 0.63, h: 0.61, i: 0.28,
  j: 0.28, k: 0.56, l: 0.28, m: 0.92, n: 0.61, o: 0.62, p: 0.63, q: 0.63, r: 0.39,
  s: 0.46, t: 0.38, u: 0.61, v: 0.54, w: 0.8, x: 0.54, y: 0.54, z: 0.48,
  " ": 0.35, "(": 0.36, ")": 0.36, ".": 0.26, "-": 0.41,
};

/** 글자 하나의 표시 폭(한글 한 글자 = 1). */
function charWidth(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  if (code < 0x20) return 0; // 제어문자 — 폭 없음
  if (code > 0xffff) return 2; // 이모지 등 — 한글 두 배로 본다
  if (code > 0x7e) return 1; // 한글·한자·전각(그 밖의 비아스키도 넉넉히 1로 본다)
  if (ch >= "0" && ch <= "9") return 0.58; // 숫자는 폭이 모두 같다
  return ASCII_EM[ch] ?? 0.45; // 표에 없는 기호는 중간값으로
}

/** 이름의 표시 폭(한글 한 글자 = 1). 글꼴 크기를 곱하면 대략의 픽셀 폭이 된다. */
export function nameDisplayWidth(name: string): number {
  let width = 0;
  for (const ch of name.trim()) width += charWidth(ch);
  return Math.round(width * 1000) / 1000;
}

export type SeatNameStep = {
  /** 글씨 크기(px) — 폭 계산에 쓰는 실수치. */
  px: number;
  /** 그 단계의 Tailwind 클래스. */
  className: string;
};

export type SeatNameLadder = {
  /** 이름이 쓸 수 있는 폭(px) — **가장 좁을 때** 기준. */
  widthPx: number;
  /**
   * 기본 → 한 단계 → 최소. 마지막이 하한이다.
   *
   * ⚠️ `text-xs`(줄 높이 1rem 동봉) 대신 `text-[12px]`을 쓴다 — 소비처가 `leading-*`로 줄 높이를
   *    고정하는데, 줄 높이를 함께 지정하는 유틸을 섞으면 어느 쪽이 이길지가 CSS 순서에 달린다.
   */
  steps: readonly [SeatNameStep, SeatNameStep, SeatNameStep];
};

/**
 * 랩실 출석부(`/attendance/seat/lab`)의 이름 칩.
 * 칸 최소 148px − 좌우 여백 20px − 상태 배지·'결' 버튼 자리 20px = 108px.
 */
export const SEAT_CHIP_NAME_LADDER: SeatNameLadder = {
  widthPx: 108,
  steps: [
    { px: 14, className: "text-sm" },
    { px: 13, className: "text-[13px]" },
    { px: 12, className: "text-[12px]" },
  ],
};

/**
 * 오늘의 출결 좌석표 칸(랩실·JJ실 카드 안 3열).
 * 카드 최소 176px − 좌우 16px − 열 간격 8px = 열 50.7px, 칸 여백 8px을 빼 43px(실측 일치).
 */
export const SEAT_CELL_NAME_LADDER: SeatNameLadder = {
  widthPx: 43,
  steps: [
    { px: 13, className: "text-[13px]" },
    { px: 12, className: "text-[12px]" },
    { px: 11, className: "text-[11px]" },
  ],
};

/**
 * 칸 폭에 **비례해 커지는** 이름 글자 — `font-size: clamp(min, N cqw, max)`.
 *
 * 원장 2026-09-04(좌석표 캡처): *"출결에도 학생 이름이 최대한 꽉 차게 해줄것. 우리 스타일대로."* — 디자인 v5 "라벨 안 글자를
 * 최대로". 위 사다리는 **가장 좁을 때**만 보고 고르므로 창을 넓혀 칸이 세 배가 되어도 글자는 13px 그대로였다(캡처의
 * 135px 칸에 13px 이름). 칸 폭을 컨테이너 쿼리 단위(`cqw`)로 읽으면 이름 폭(em)에 맞춰 칸을 채우는 크기가 CSS에서 나온다:
 * `N cqw = 채움 비율 ÷ 이름 폭(em)` — 세 글자 이름은 33.3cqw, `김하늘A`(3.7em)는 27cqw. 좌석표 가장 좁은 칸(내용 폭 39px) = 13px
 * (옛 사다리와 같다) / 135px 칸 = 24px(상한). ⚠️ `cqw`는 컨테이너의 **내용 상자**(padding 제외) 기준이라 기본 채움 비율은 1이다 —
 * 실측(2026-09-04)에서 0.9로 잡았더니 47px 칸이 11.8px로 옛 13px보다 작아졌다.
 *
 * 소비처 규약: 이름을 감싸는 **칸에 `@container`**(inline-size)를 달고 이름 `<span>`에 이 값을 `style.fontSize`로 준다.
 * 하한(`minPx`)에서도 넘치면 종전처럼 말줄임 + 툴팁(`fitSeatName(...).clipped`가 그 판정을 그대로 준다).
 * 상한 24px(`text-xl`) = 화면 제목 크기 — 이름이 그보다 커질 이유가 없다. px 숫자는 이 파일(허용 목록)에만 둔다.
 */
export function fluidNameFontSize(
  name: string,
  opts: { minPx: number; maxPx: number; /** 칸 내용 폭 중 이름이 쓸 비율(기본 1 — 배지 자리를 남겨야 하는 칩만 낮춘다). */ fill?: number },
): string {
  const width = Math.max(nameDisplayWidth(name), 0.5);
  const cqw = Math.floor(((opts.fill ?? 1) * 100 * 10) / width) / 10;
  return `clamp(${opts.minPx}px, ${cqw}cqw, ${opts.maxPx}px)`;
}

/** 출결 칸(좌석표·출결 모드·랩실 칩) 공통 상한 — 24px(`text-xl`). */
export const NAME_FILL_MAX_PX = 24;

/**
 * 소비처별 **하한**(px) — 그 칸의 가장 좁은 폭에서 옛 사다리와 같은 값(회귀 아님). 🔴 px 숫자는 이 파일에만 —
 * 소비처가 `minPx: 13`처럼 직접 적으면 이 규약이 화면마다 갈린다(적대 리뷰 2026-09-04).
 */
export const NAME_FILL_MIN_PX = {
  /** 좌석표 칸(내용 폭 39px) — 세 글자 13px, 접미사 이름은 11px 하한에서 말줄임. */
  seatCell: SEAT_CELL_NAME_LADDER.steps[2].px,
  /** 출결 모드 타일(폰 3열 ≈ 90px 칸). */
  quickTile: 13,
  /** 랩실 칩(148px 격자, 배지 자리를 남긴 폭). */
  labChip: SEAT_CHIP_NAME_LADDER.steps[2].px,
} as const;

/** 랩실 칩이 이름에 쓰는 폭 비율 — 오른쪽 위 상태 배지·'결' 버튼 자리(20px)를 남긴다. */
export const LAB_CHIP_NAME_FILL = 0.75;

export type SeatNameFit = {
  /** 그 이름에 씌울 글씨 크기 클래스. */
  className: string;
  /** 하한에서도 넘친다 — 소비처가 말줄임 + 전체 이름 툴팁으로 마감한다. */
  clipped: boolean;
};

/** 이름이 들어가는 가장 큰 단계를 고른다. 하한에서도 넘치면 하한 + `clipped`. */
export function fitSeatName(name: string, ladder: SeatNameLadder): SeatNameFit {
  const width = nameDisplayWidth(name);
  for (const step of ladder.steps) {
    if (width * step.px <= ladder.widthPx) return { className: step.className, clipped: false };
  }
  return { className: ladder.steps[2].className, clipped: true };
}
