import { describe, expect, it } from "vitest";
import { detectInAppBrowser, kakaoOpenExternalUrl } from "./in-app-browser";

const IOS_KAKAO = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.8.5";
const ANDROID_KAKAO = "Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36;KAKAOTALK 2410850";
const NAVER = "Mozilla/5.0 (Linux; Android 13; SM-G991N; wv) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36 NAVER(inapp; search; 2000; 12.8.0)";
const WEBVIEW = "Mozilla/5.0 (Linux; Android 13; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36";
const CHROME = "Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
const SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const SAMSUNG = "Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36";

describe("인앱 브라우저 판정", () => {
  it("카카오톡(아이폰·안드로이드)은 카카오톡으로 알아보고 기본 브라우저 열기를 쓴다", () => {
    expect(detectInAppBrowser(IOS_KAKAO)).toEqual({ name: "카카오톡", kakao: true });
    expect(detectInAppBrowser(ANDROID_KAKAO)).toEqual({ name: "카카오톡", kakao: true });
  });
  it("다른 앱은 이름만, 이름 모르는 안드로이드 웹뷰는 '앱'", () => {
    expect(detectInAppBrowser(NAVER)).toEqual({ name: "네이버 앱", kakao: false });
    expect(detectInAppBrowser(WEBVIEW)).toEqual({ name: "앱", kakao: false });
  });
  it("일반 브라우저는 경고하지 않는다", () => {
    for (const ua of [CHROME, SAFARI, SAMSUNG, ""]) expect(detectInAppBrowser(ua)).toBeNull();
  });
  it("기본 브라우저 열기 주소는 지금 주소를 그대로 싣는다", () => {
    expect(kakaoOpenExternalUrl("https://www.aywa.co.kr/v/abc?h=2026-10-16"))
      .toBe("kakaotalk://web/openExternal?url=https%3A%2F%2Fwww.aywa.co.kr%2Fv%2Fabc%3Fh%3D2026-10-16");
  });
});
