/**
 * 다른 앱 안에서 연 웹 화면(인앱 브라우저)인가 — 제출 화면의 "끊길 수 있다" 경고용(원장 2026-10-17).
 * 실측: 한 학생이 카카오톡 안에서 800MB~1.4GB 영상을 5번 올리다 4번이 끊겼다(앱을 내리거나 화면을 벗어나면 전송이 멈춘다).
 * 판정은 경고에만 쓴다 — 업로드를 막지 않는다(못 알아본 앱은 경고 없이 지금처럼 올린다).
 */
const APPS: Array<{ test: RegExp; name: string }> = [
  { test: /KAKAOTALK/i, name: "카카오톡" },
  { test: /NAVER\(inapp/i, name: "네이버 앱" },
  { test: /DaumApps/i, name: "다음 앱" },
  { test: /Instagram/i, name: "인스타그램" },
  { test: /FBAN|FBAV/i, name: "페이스북" },
  { test: /\bLine\//, name: "라인" },
  { test: /\bBAND\//i, name: "밴드" },
];

export type InAppBrowser = { name: string; kakao: boolean };

/** `null` = 일반 브라우저(또는 못 알아봄). 안드로이드 웹뷰(`; wv)`)는 앱 이름을 몰라도 '앱'으로 본다. */
export function detectInAppBrowser(userAgent: string): InAppBrowser | null {
  const app = APPS.find((a) => a.test.test(userAgent));
  if (app) return { name: app.name, kakao: app.name === "카카오톡" };
  if (/Android/i.test(userAgent) && /; wv\)/.test(userAgent)) return { name: "앱", kakao: false };
  return null;
}

/** 카카오톡에서 지금 주소를 기본 브라우저로 여는 주소(카카오톡 전용 스킴 — 다른 앱에선 쓰지 않는다). */
export const kakaoOpenExternalUrl = (href: string) => `kakaotalk://web/openExternal?url=${encodeURIComponent(href)}`;
