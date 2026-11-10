import type { ReactNode } from "react";

// 키오스크 전용 크롬리스 레이아웃 — 사이드바·헤더 없음. 태블릿 풀스크린.
// (auth)/(print)과 동일 패턴. 워크스페이스 플로팅 창 시스템과 무관(태블릿이 /kiosk URL로 직접 접속).
export default function KioskLayout({ children }: { children: ReactNode }) {
  return <div className="bg-bg-canvas text-foreground min-h-screen">{children}</div>;
}
