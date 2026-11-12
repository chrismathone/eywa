// 학원 브랜드 색(settings.profile.brandColor)을 셸 CSS 변수로 주입하기 위한 순수 헬퍼.
// globals.css의 --primary(#153e75)와 그 파생 토큰을 테넌트별 hex로 덮어쓴다(layout.tsx).
import type { CSSProperties } from "react";

/** globals.css의 기본 --primary(Injaewon Navy). 이 값이면 오버라이드하지 않는다(불필요한 inline style 회피).
 *  ⚠️ globals.css `--primary`와 항상 같은 값(소문자)이어야 한다 — 리스킨 시 함께 갱신. */
export const DEFAULT_BRAND_COLOR = "#153e75";

/** 과거 기본색들 — 옛 기본값이 tenant_settings에 그대로 저장된 테넌트가 있어(실측: injaewon #1a5f3c)
 *  이 값들도 "기본"으로 간주해 주입을 생략한다(리스킨을 자동 추종, 데이터 마이그 불필요).
 *  누군가 옛 기본색을 진짜 브랜드색으로 쓰고 싶다면 미세하게 다른 hex를 고르면 된다(엣지, 허용 트레이드오프). */
const LEGACY_DEFAULT_BRAND_COLORS = new Set(["#1a5f3c", "#0e7c46"]);

/** #RGB 또는 #RRGGBB(대소문자 무관)만 허용. */
export function isHexColor(value: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
}

/** #RGB → #RRGGBB 정규화 후 [r,g,b] 반환. 유효하지 않으면 null. */
function hexToRgb(hex: string): [number, number, number] | null {
  const v = hex.trim();
  if (!isHexColor(v)) return null;
  let body = v.slice(1);
  if (body.length === 3) body = body.split("").map((c) => c + c).join("");
  const n = parseInt(body, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 배경 hex에 대비되는 글자색(#121212 또는 #ffffff) — sRGB 휘도 기준. 유효하지 않으면 빈 문자열. */
export function readableTextColor(bgHex: string): string {
  const rgb = hexToRgb(bgHex);
  if (!rgb) return "";
  const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return lum > 0.6 ? "#121212" : "#ffffff";
}

/**
 * WCAG 상대휘도(0~1) — **감마 보정을 거친** 값이다. 유효하지 않으면 null.
 *
 * 🔴 `readableTextColor`가 쓰는 0.299/0.587/0.114(체감 밝기)와 **다른 물건**이다. 그 공식으로
 *    대비를 판정하면 초록·마젠타 계열이 실제보다 훨씬 밝게 계산돼 "통과했는데 안 읽히는" 색이 나온다
 *    (2026-08-19 적대 리뷰 실측: 순수 초록이 기준을 통과했지만 실제 대비 2.5:1). 대비는 이쪽으로만 잰다.
 */
export function relativeLuminance(hex: string): number | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

/** 두 색의 WCAG 대비비(1~21). 하나라도 형식이 틀리면 null. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `hex`를 alpha만큼 `bgHex` 위에 얹었을 때의 **불투명 합성색**. 유효하지 않으면 빈 문자열. */
export function compositeOver(hex: string, alpha: number, bgHex: string): string {
  const fg = hexToRgb(hex);
  const bg = hexToRgb(bgHex);
  if (!fg || !bg) return "";
  const a = Math.min(Math.max(alpha, 0), 1);
  const to2 = (i: number) =>
    Math.round(fg[i]! * a + bg[i]! * (1 - a))
      .toString(16)
      .padStart(2, "0");
  return `#${to2(0)}${to2(1)}${to2(2)}`;
}

/**
 * `hex`를 **검정 쪽으로 낮춰** `bgHex` 위에서 목표 대비를 확보한 글자색을 만든다(색상은 유지).
 * 사용자가 색상환에서 밝은 색을 골라도 글자가 읽히게 하는 안전벨트 — 판정은 위 `contrastRatio`.
 *
 * 검정(k=0)은 옅은 배경에서 항상 목표를 넘으므로 반드시 수렴한다. 이미 충분하면 원본 그대로.
 * 유효하지 않으면 빈 문자열(호출부가 폴백을 고를 수 있게).
 */
export function darkenHexForContrast(hex: string, bgHex: string, target: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb || relativeLuminance(bgHex) === null) return "";
  const scaled = (k: number) =>
    `#${rgb
      .map((v) => Math.round(v * k).toString(16).padStart(2, "0"))
      .join("")}`;
  if ((contrastRatio(scaled(1), bgHex) ?? 0) >= target) return hex.trim().toLowerCase();

  // k를 이진 탐색 — 대비는 k에 대해 단조(어두울수록 옅은 배경과의 대비가 커진다).
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 12; i += 1) {
    const mid = (lo + hi) / 2;
    if ((contrastRatio(scaled(mid), bgHex) ?? 0) >= target) lo = mid;
    else hi = mid;
  }
  return scaled(lo);
}

/** hex + alpha → "rgba(r, g, b, a)". 유효하지 않으면 빈 문자열. */
export function hexToRgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return "";
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

/**
 * 학원 브랜드색이 지금 화면에 반영되는가 — 앱 전체 색 테마(`src/app/instrument-theme.css`, 루트 레이아웃이 늘 싣는다)가
 * `--primary`를 `!important`로 덮어 `brandColorVars` 주입이 효과가 없다(리뷰 C5). 반영되지 않는 동안 학원 설정의 '브랜드 색상'
 * 입력칸은 숨긴다(소비처 없는 설정은 노출하지 않는다 — CLAUDE.md). 저장된 값은 지우지 않는다. 테마를 걷거나 브랜드색을 따르게
 * 바꾸는 날 이 값을 false로.
 */
export const BRAND_COLOR_OVERRIDDEN_BY_THEME = true;

/**
 * 저장된 브랜드색이 **실제로 화면에 주입되는가**. false면 globals.css 기본 팔레트(v3 네이비)가 그대로
 * 쓰인다 — 값이 비었거나·형식이 틀렸거나·현/과거 기본색(LEGACY_DEFAULT_BRAND_COLORS)일 때.
 * 판정은 brandColorVars에 위임한다(로직 이중화 금지 — 갈라지면 설정 화면이 거짓말을 하게 된다).
 * 용도: /owner 브랜드 색상 필드가 "저장돼 있지만 적용되지 않는 값"을 그대로 보여주던 문제
 * (2026-07-20 감사) — 사용자가 그린 스와치를 보면서 화면은 네이비인 상태를 설명하기 위함.
 */
export function isBrandColorApplied(brandColor: string | undefined | null): boolean {
  return brandColorVars(brandColor) !== null;
}

/**
 * 브랜드 색에서 셸에 주입할 CSS 변수 묶음을 만든다. 유효하지 않거나 기본색이면 null(주입 생략).
 * --primary와 그 파생(soft/softer)·동일 hex를 쓰는 토큰(ring, chart-2, sidebar-primary 등)을 함께 덮는다.
 * --primary-foreground / --sidebar-primary-foreground(흰색)는 대비 위해 유지(자동 대비 가드는 후속).
 */
export function brandColorVars(brandColor: string | undefined | null): CSSProperties | null {
  if (!brandColor) return null;
  const hex = brandColor.trim();
  const lower = hex.toLowerCase();
  if (!isHexColor(hex) || lower === DEFAULT_BRAND_COLOR || LEGACY_DEFAULT_BRAND_COLORS.has(lower)) return null;
  return {
    "--primary": hex,
    // alpha는 globals.css --primary-soft/-softer와 동기(v4: 0.11/0.05).
    "--primary-soft": hexToRgba(hex, 0.11),
    "--primary-softer": hexToRgba(hex, 0.05),
    "--ring": hex,
    "--chart-2": hex,
    "--sidebar-primary": hex,
    "--sidebar-ring": hex,
    "--sidebar-accent-foreground": hex,
    // v4에서 사이드바 활성 배경이 회색→브랜드 틴트가 됐다. 여기서 함께 덮지 않으면 테넌트 브랜드색
    // 글자에 네이비 틴트 배경이 깔려 색이 어긋난다(글자만 따라오던 종전 버그).
    "--sidebar-accent": hexToRgba(hex, 0.07),
  } as CSSProperties;
}
