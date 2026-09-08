import type { CSSProperties } from "react";
import { compositeOver, darkenHexForContrast, hexToRgba, isHexColor } from "@/lib/color-utils";
import {
  EVENT_COLORS,
  EVENT_COLOR_LABEL,
  isEventColor,
  type CalendarColor,
  type EventColor,
} from "./types";

/**
 * 캘린더 색 단일 소스 — **프리셋 토큰 키 또는 사용자 지정 hex** 둘 다를 한 곳에서 그린다
 * (원장 2026-08-19: *"새 태그 추가할 때 색상이 고정인데 내가 색상 선택해서 할 수 있게"*).
 *
 * 🔑 두 갈래가 필요한 이유: 프리셋(`primary`·`blue`…)은 **테마 토큰**이라 팔레트를 리스킨하면
 *    자동으로 따라오고 대비가 가드로 검증된다(palette-contrast). 사용자 hex는 그 보호 밖이라
 *    여기서 직접 안전하게 만든다 — 배경은 옅은 틴트, 글자는 **휘도를 낮춘 같은 색**
 *    (노랑을 골라도 흰 배경에서 읽힌다). 그래서 hex는 Tailwind 클래스가 아니라 inline style이다.
 *
 * ⚠️ Tailwind 동적 클래스 조립 금지 — 프리셋 클래스는 아래 정적 Record가 전부(purge에 잡히게).
 * ⚠️ 새 캘린더 표면은 이 파일의 `dotProps`/`chipProps`만 쓸 것 — 화면마다 Record를 복사하면
 *    hex 태그가 그 화면에서만 색을 잃는다(실제로 DOT_SOLID가 3벌로 갈라져 있었다).
 */

/** 칩 글자가 지켜야 할 WCAG 대비(본문 크기 하한). 못 미치면 같은 색을 어둡게 낮춘다. */
const INK_MIN_CONTRAST = 4.5;
/** 사용자 hex 칩 배경 틴트 — 프리셋 `-soft` 토큰(11~13%)과 같은 결. */
const CHIP_TINT_ALPHA = 0.14;
/**
 * 칩이 얹히는 면 — 팔레트 v4 "White Contrast"에서 캔버스·카드는 전부 순백이다.
 * 대비 계산은 이 위에 틴트를 합성한 색을 기준으로 한다(투명 배경은 대비를 못 잰다).
 */
const CHIP_SURFACE = "#ffffff";

/** 프리셋 점(solid) 클래스 — 종전 DOT_SOLID 3벌의 정본. */
const DOT_CLASS: Record<EventColor, string> = {
  primary: "bg-primary",
  blue: "bg-blue",
  green: "bg-green",
  amber: "bg-amber",
  purple: "bg-purple",
  rose: "bg-rose",
  neutral: "bg-neutral-fill",
};

/** 프리셋 칩(soft 배경 + 같은 색 글자) 클래스 — 종전 month-grid CHIP_CLASS의 정본. */
const CHIP_CLASS: Record<EventColor, string> = {
  primary: "bg-primary-soft text-primary",
  blue: "bg-blue-soft text-blue",
  green: "bg-green-soft text-green",
  amber: "bg-amber-soft text-amber",
  purple: "bg-purple-soft text-purple",
  rose: "bg-rose-soft text-rose",
  neutral: "bg-bg-soft text-text-dim",
};

/** 사용자 지정 hex인가 — 프리셋 키가 아니고 `#RGB`/`#RRGGBB` 형식. */
export function isCustomColor(c: string): boolean {
  return !isEventColor(c) && isHexColor(c);
}

/**
 * 저장·표시 전 정규화 — 프리셋 키는 그대로, hex는 소문자 `#rrggbb`로, 그 밖은 `primary`.
 * 조회(queries)와 저장(actions)이 **같은 함수**를 지나야 "저장은 됐는데 안 보이는 색"이 안 생긴다.
 */
export function normalizeCalendarColor(raw: string | null | undefined): CalendarColor {
  const v = String(raw ?? "").trim();
  if (isEventColor(v)) return v;
  if (!isHexColor(v)) return "primary";
  const body = v.slice(1).toLowerCase();
  return `#${body.length === 3 ? body.split("").map((c) => c + c).join("") : body}`;
}

/**
 * 색 점(solid) — 프리셋은 클래스, hex는 inline style.
 * 🔴 hex 점에는 **항상 헤어라인 링**을 넣는다 — 흰색·아주 밝은 색을 고르면 흰 면 위에서 점이
 *    통째로 사라져 "색이 저장 안 됐다"로 보인다(프리셋 7색은 전부 어두워 이 문제가 없었다).
 *    box-shadow inset이라 박스 크기가 안 변한다(팔레트 v4 카드 헤어라인과 같은 수법).
 */
export function dotProps(color: CalendarColor): { className: string; style?: CSSProperties } {
  if (isEventColor(color)) return { className: DOT_CLASS[color] };
  if (isCustomColor(color)) {
    return {
      className: "",
      style: { backgroundColor: color, boxShadow: "inset 0 0 0 1px rgba(29, 29, 31, 0.18)" },
    };
  }
  return { className: DOT_CLASS.primary };
}

/**
 * 일정 칩(옅은 배경 + 읽히는 글자) — 프리셋은 토큰 클래스(대비는 palette-contrast 가드가 지킨다),
 * hex는 틴트 배경 + **대비를 실제로 계산해** 어둡게 낮춘 같은 색 글자.
 */
export function chipProps(color: CalendarColor): { className: string; style?: CSSProperties } {
  if (isEventColor(color)) return { className: CHIP_CLASS[color] };
  if (isCustomColor(color)) {
    const surface = compositeOver(color, CHIP_TINT_ALPHA, CHIP_SURFACE);
    return {
      className: "",
      style: {
        backgroundColor: hexToRgba(color, CHIP_TINT_ALPHA),
        color: darkenHexForContrast(color, surface, INK_MIN_CONTRAST),
      },
    };
  }
  return { className: CHIP_CLASS.primary };
}

/** 칩 배경(틴트를 흰 면에 합성한 불투명색) — 대비 검증·미리보기가 같은 값을 쓰게 하는 단일 소스. */
export function chipSurfaceOf(color: CalendarColor): string {
  return isCustomColor(color) ? compositeOver(color, CHIP_TINT_ALPHA, CHIP_SURFACE) : CHIP_SURFACE;
}

/** 화면에 쓰는 색 이름 — 프리셋은 한글 이름, hex는 대문자 코드(그 자체가 이름이다). */
export function colorLabel(color: CalendarColor): string {
  if (isEventColor(color)) return EVENT_COLOR_LABEL[color];
  if (isCustomColor(color)) return color.toUpperCase();
  return EVENT_COLOR_LABEL.primary;
}

/** 색 선택기의 프리셋 목록 — 이름과 함께 노출한다(점만 있으면 무슨 색인지 모른다). */
export const PRESET_SWATCHES: { value: EventColor; label: string }[] = EVENT_COLORS.map((c) => ({
  value: c,
  label: EVENT_COLOR_LABEL[c],
}));

/**
 * 색 선택기의 '직접 선택' 시작점 — 프리셋 7색과 헷갈리지 않는 중간 톤 파랑.
 * (칩 글자는 `chipProps`가 대비를 맞춰 낮추므로, 이 값 자체의 밝기는 가독성을 좌우하지 않는다.)
 */
export const CUSTOM_COLOR_SEED = "#4a7ab8";
