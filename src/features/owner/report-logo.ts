/**
 * 보고서 머리의 로고 경로 — 보고서 전용 로고(`report.logoUrl`)가 있으면 그것, 없으면 학원 로고(`profile.logoUrl`).
 * 원장 2026-10-26 *"수학보고서 시지입시관 이름 빼"* → 학원 로고는 그대로 두고 **보고서에만** 다른 로고를 쓰기로.
 * /r 공유 페이지 · 보고서 인쇄 · 원스크린 미리보기가 이 함수 하나를 거친다(미리보기가 발송본과 갈리지 않게).
 */
export function reportLogoPath(s: { profile: { logoUrl: string }; report: { logoUrl?: string } }): string {
  return s.report.logoUrl?.trim() || s.profile.logoUrl;
}
