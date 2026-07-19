// 학원 브랜드 색(settings.profile.brandColor)을 셸 CSS 변수로 주입하기 위한 순수 헬퍼.
// globals.css의 --primary(#0e7c46)와 그 파생 토큰을 테넌트별 hex로 덮어쓴다(layout.tsx).
import type { CSSProperties } from "react";

/** globals.css의 기본 --primary(Precision Pine). 이 값이면 오버라이드하지 않는다(불필요한 inline style 회피).
 *  ⚠️ globals.css `--primary`와 항상 같은 값(소문자)이어야 한다 — 리스킨 시 함께 갱신. */
export const DEFAULT_BRAND_COLOR = "#0e7c46";

/** 과거 기본색들 — 옛 기본값이 tenant_settings에 그대로 저장된 테넌트가 있어(실측: injaewon #1a5f3c)
 *  이 값들도 "기본"으로 간주해 주입을 생략한다(리스킨을 자동 추종, 데이터 마이그 불필요).
 *  누군가 옛 기본색을 진짜 브랜드색으로 쓰고 싶다면 미세하게 다른 hex를 고르면 된다(엣지, 허용 트레이드오프). */
const LEGACY_DEFAULT_BRAND_COLORS = new Set(["#1a5f3c"]);

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

/** 배경 hex에 대비되는 글자색(#101613 또는 #ffffff) — sRGB 휘도 기준. 유효하지 않으면 빈 문자열. */
export function readableTextColor(bgHex: string): string {
  const rgb = hexToRgb(bgHex);
  if (!rgb) return "";
  const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return lum > 0.6 ? "#101613" : "#ffffff";
}

/** hex + alpha → "rgba(r, g, b, a)". 유효하지 않으면 빈 문자열. */
export function hexToRgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return "";
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
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
    "--primary-soft": hexToRgba(hex, 0.1),
    "--primary-softer": hexToRgba(hex, 0.05),
    "--ring": hex,
    "--chart-2": hex,
    "--sidebar-primary": hex,
    "--sidebar-ring": hex,
    "--sidebar-accent-foreground": hex,
  } as CSSProperties;
}
