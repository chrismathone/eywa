/**
 * 월간 계획서(MP) **제목 맞추기** — 순수(Vitest). 서버·클라·인쇄가 함께 쓰므로 `server-only` 금지([[#61]]).
 *
 * 원장 2026-09-02: *"반이 너무 길어서 칸 밖으로 나감. `(September 2026)`은 다음줄로 처리하고
 * 글씨 크기 조정 필요함."*
 *
 * 🔑 **두 가지를 함께 해야 낫는다.** 월을 다음 줄로 내리는 것만으로는 `Middle School English Course 1-5`가
 *    여전히 넘치고, 줄이기만 하면 `LE1`까지 작아진다 → **월은 항상 둘째 줄 + 반 이름은 길이에 따라 단계 축소**.
 * 🔴 **제목 띠 높이(60px = 시트 3행)는 안 늘린다.** 늘리면 표가 아래로 밀려 A4 한 장이 더 깨진다.
 *    두 줄이 60px 안에 들어가도록 사다리 상한(24pt)과 줄간격을 잡았다(24pt×1.05 + 12pt×1.15 ≈ 52px).
 *
 * ⚠️ **폭 판정은 글자 수가 아니라 표시 폭**이다([`name-fit.ts`](@/features/attendance/seat/name-fit) 선례).
 *    `LE1`(`Let's Express 1`, 15자)이 `MEC1-5`(`Middle School English Course 1-5`, 31자)보다 절반도 안 좁다.
 * ⚠️ 아래 표는 **제목이 실제로 쓰는 글꼴 그대로** 헤드리스 크롬에서 글자마다 잰 값이다
 *    (`Arial, Helvetica, sans-serif` · `font-weight: 800`). 🔴 **700으로 재면 안 된다** — Arial엔 800 굵기가
 *    없어 브라우저가 굵기를 합성(faux bold)하고, 그만큼 **약 15% 넓어진다**. 그 차이를 놓쳐서 `Let's Speak 4b`가
 *    "들어간다"로 잘못 계산됐었다(실측 한 줄 579.7px vs 칸 557px = 넘침).
 */
import { MP_SHEET_GEOM } from "./month-plan-sheet-style";

/**
 * 글자 하나의 폭(em, 1em = 글자 크기) — 헤드리스 크롬 `measureText` 실측(Arial 800).
 * 표에 없는 글자는 아래 폴백을 쓴다.
 */
const TITLE_EM: Record<string, number> = {
  A: 0.778, B: 0.778, C: 0.778, D: 0.778, E: 0.722, F: 0.667, G: 0.833, H: 0.833, I: 0.389,
  J: 0.667, K: 0.833, L: 0.667, M: 0.944, N: 0.833, O: 0.833, P: 0.722, Q: 0.833, R: 0.778,
  S: 0.722, T: 0.722, U: 0.833, V: 0.778, W: 1.0, X: 0.778, Y: 0.778, Z: 0.722,
  a: 0.667, b: 0.667, c: 0.667, d: 0.667, e: 0.667, f: 0.389, g: 0.667, h: 0.667, i: 0.333,
  j: 0.333, k: 0.667, l: 0.333, m: 1.0, n: 0.667, o: 0.667, p: 0.667, q: 0.667, r: 0.444,
  s: 0.611, t: 0.444, u: 0.667, v: 0.611, w: 0.944, x: 0.667, y: 0.611, z: 0.556,
  " ": 0.333, "'": 0.278, "(": 0.389, ")": 0.389, ".": 0.333, ",": 0.333, "-": 0.333,
  "/": 0.278, "&": 0.889, "+": 0.66,
};
/** 숫자는 폭이 모두 같다(0.667). */
const DIGIT_EM = 0.667;
/** 한글·전각 — 실측 0.92지만 **1로 넉넉히** 본다(넘쳐서 깨지는 쪽이 조금 작은 쪽보다 나쁘다). */
const WIDE_EM = 1;
/** 표에 없는 아스키 기호. */
const OTHER_EM = 0.5;

/** 제목 한 줄의 표시 폭(em). 글자 크기(px)를 곱하면 대략의 픽셀 폭이다. */
export function mpTitleWidthEm(text: string): number {
  let em = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20) continue;
    if (ch >= "0" && ch <= "9") em += DIGIT_EM;
    else if (code > 0x7e) em += WIDE_EM;
    else em += TITLE_EM[ch] ?? OTHER_EM;
  }
  return Math.round(em * 1000) / 1000;
}

/**
 * 제목이 쓸 수 있는 폭(px) — 문서 폭에서 로고 칸(A·B)과 오른쪽 칸(강사·범례)을 뺀 나머지.
 * ⚠️ 문서 폭은 열 수에 따라 달라진다(주 3일 3열 = 810px / 주 5일 = 1296px) — 그래서 **상수가 아니다**.
 */
export function mpTitleBoxPx(dataColumnCount: number): number {
  const doc = MP_SHEET_GEOM.col * (1 + dataColumnCount);
  return doc - MP_SHEET_GEOM.col * MP_SHEET_GEOM.logoCols - MP_SHEET_GEOM.sideW - TITLE_PAD_PX;
}
/** 좌우 여백(px-2 = 8×2) + 오른쪽 격자선 1px + 반올림 여유 1px. */
const TITLE_PAD_PX = 18;

/**
 * 반 이름 줄의 사다리(pt) — 첫 단계가 원본 시트 값(24pt)이고 **마지막이 하한**이다.
 * 하한에서도 넘치면 `MP_CLIP`(overflow hidden + 어절 접기)이 격자 밖으로 새는 것을 막는다.
 */
export const MP_TITLE_NAME_STEPS_PT = [24, 20, 17, 14, 12] as const;
/** 월 줄의 사다리 — 내용이 `(September 2026)` 한 종류라 짧다. */
export const MP_TITLE_PERIOD_STEPS_PT = [12, 10, 9] as const;

/**
 * 실측 표의 오차 여유(±2% 관측) — **넘치는 쪽이 더 나쁘므로** 칸을 조금 좁게 잡는다.
 * (합산값이 실측보다 큰 이름도, 작은 이름도 있었다: `Ready To Talk 5` +1.6% / `MEC1-5` −0.2%.)
 */
const SAFETY = 0.98;

const PT_TO_PX = 96 / 72;

export type MpTitleFit = {
  /** 반 이름 줄 글자 크기(CSS 값). */
  nameSize: string;
  /** 월 줄 글자 크기(CSS 값). */
  periodSize: string;
  /** 하한에서도 넘친다 — 소비처는 `MP_CLIP`으로 마감한다(격자 밖으로는 안 나간다). */
  clipped: boolean;
};

/** 그 폭에 들어가는 가장 큰 단계를 고른다(없으면 하한). */
function pickStep(text: string, boxPx: number, steps: readonly number[]): { pt: number; fits: boolean } {
  const em = mpTitleWidthEm(text);
  const usable = boxPx * SAFETY;
  for (const pt of steps) {
    if (em * pt * PT_TO_PX <= usable) return { pt, fits: true };
  }
  return { pt: steps[steps.length - 1]!, fits: false };
}

/**
 * 제목 두 줄의 글자 크기 — 반 이름은 길이에 따라 줄이고, 월 줄은 제 사다리로 따로 정한다.
 * 🔴 **두 줄 합이 제목 띠(60px)를 넘지 않는다** — 사다리 상한과 줄간격이 그 조건으로 정해졌다.
 */
export function mpFitTitle(name: string, period: string, boxPx: number): MpTitleFit {
  const n = pickStep(name, boxPx, MP_TITLE_NAME_STEPS_PT);
  const p = period ? pickStep(period, boxPx, MP_TITLE_PERIOD_STEPS_PT) : { pt: MP_TITLE_PERIOD_STEPS_PT[0], fits: true };
  return { nameSize: `${n.pt}pt`, periodSize: `${p.pt}pt`, clipped: !n.fits || !p.fits };
}
