/**
 * 다른 앱 안에서 연 웹 화면(인앱 브라우저)인가 — 제출 화면의 "끊길 수 있다" 경고용(원장 2026-10-17).
 * 실측: 한 학생이 카카오톡 안에서 800MB~1.4GB 영상을 5번 올리다 4번이 끊겼다(앱을 내리거나 화면을 벗어나면 전송이 멈춘다).
 * 판정은 경고에만 쓴다 — 업로드를 막지 않는다(못 알아본 앱은 경고 없이 지금처럼 올린다).
 */
// 이름은 판정에만 쓴다 — 화면 문구는 앱 이름을 말하지 않는다(원장 2026-10-17 *"카카오톡으로 한정짓는 말보다는"*).
const APPS: RegExp[] = [/KAKAOTALK/i, /NAVER\(inapp/i, /DaumApps/i, /Instagram/i, /FBAN|FBAV/i, /\bLine\//, /\bBAND\//i];

/** `kakao` = 기본 브라우저로 여는 길(카카오톡 전용 스킴)이 있다. */
export type InAppBrowser = { kakao: boolean };

/** `null` = 일반 브라우저(또는 못 알아봄). 이름 모르는 안드로이드 웹뷰(`; wv)`)도 앱 안으로 본다. */
export function detectInAppBrowser(userAgent: string): InAppBrowser | null {
  if (APPS.some((test) => test.test(userAgent)) || (/Android/i.test(userAgent) && /; wv\)/.test(userAgent)))
    return { kakao: /KAKAOTALK/i.test(userAgent) };
  return null;
}

/** 카카오톡에서 지금 주소를 기본 브라우저로 여는 주소(카카오톡 전용 스킴 — 다른 앱에선 쓰지 않는다). */
export const kakaoOpenExternalUrl = (href: string) => `kakaotalk://web/openExternal?url=${encodeURIComponent(href)}`;
