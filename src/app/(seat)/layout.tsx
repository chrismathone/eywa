import type { ReactNode } from "react";

// 자리 출석부 공개(PIN) 전용 크롬리스 레이아웃 — 사이드바·헤더 없음. 태블릿 풀스크린.
// (kiosk)/(intake)/(auth)과 동일 패턴. 인증은 PIN httpOnly 쿠키.
export default function SeatPublicLayout({ children }: { children: ReactNode }) {
  return <div className="bg-bg-soft text-foreground min-h-screen">{children}</div>;
}
