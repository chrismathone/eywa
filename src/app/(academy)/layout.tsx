import type { ReactNode } from "react";
import { Nanum_Myeongjo } from "next/font/google";
import "./academy.css";

/**
 * 학원 공개 랜딩(/academy) 전용 크롬리스 레이아웃 — 사이드바·헤더 없음. 비로그인 공개.
 * ((intake)/(kiosk)/(auth)/(print)과 동일 패턴. 공개 통과는 lib/supabase/proxy.ts 에서.)
 *
 * ⚠️ 이 화면의 관객은 원장이 아니라 **학부모**다. 앱 팔레트 v4(네이비)를 따르지 않고
 *    벽에 박힌 황동 크레스트 색을 따른다 — 근거는 academy.css 머리주석.
 * ⚠️ globals.css는 루트 layout이 이미 넣는다. 여기서 또 넣지 말 것(중복 주입).
 *
 * 제목 세리프 한 벌만 더하고 본문은 앱 전역 Pretendard를 그대로 쓴다 —
 * 한글 웹폰트는 무거워서 무게(800) 하나로 제한한다. display:swap이라 첫 페인트를 막지 않는다.
 */
const academySerif = Nanum_Myeongjo({
  variable: "--font-academy-serif",
  // ⚠️ "korean"은 Next 폰트 데이터에 없는 서브셋이라 타입 에러가 난다. 그런데 구글은
  //    subset=latin 요청에도 한글 unicode-range 92개 블록을 전부 내려주고(실측), next/font가
  //    그 분할을 그대로 self-host 한다 → 브라우저는 쓰는 글자가 든 조각만 받는다.
  subsets: ["latin"],
  weight: ["800"],
  display: "swap",
  preload: false,
  fallback: ["Apple SD Gothic Neo", "Malgun Gothic", "serif"],
});

export default function AcademyLayout({ children }: { children: ReactNode }) {
  return <div className={`ac ${academySerif.variable}`}>{children}</div>;
}
