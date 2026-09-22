import { Do_Hyeon } from "next/font/google";

/**
 * 공개 화면(랜딩·로그인) 제목 글꼴 — 건물 안내판 같은 Do Hyeon(400 한 벌). 본문은 앱 전역 Pretendard 그대로.
 * ⚠️ "korean" 서브셋은 Next 폰트 데이터에 없다 — latin으로 요청해도 구글이 한글 unicode-range 조각을 함께 내려주고
 *    next/font가 그대로 self-host 한다((academy) 레이아웃과 같은 방식). display:swap이라 첫 페인트를 막지 않는다.
 */
export const landingDisplay = Do_Hyeon({
  variable: "--font-landing-display",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  preload: false,
  fallback: ["Apple SD Gothic Neo", "Malgun Gothic", "sans-serif"],
});
