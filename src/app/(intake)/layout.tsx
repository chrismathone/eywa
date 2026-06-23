import type { ReactNode } from "react";

// 학부모 공개 접수 전용 크롬리스 레이아웃 — 사이드바·헤더 없음. 모바일 풀스크린(QR 스캔 진입).
// (kiosk)/(auth)/(print)과 동일 패턴. 인증 불필요(접수 토큰이 테넌트를 해석).
export default function IntakeLayout({ children }: { children: ReactNode }) {
  return <div className="bg-bg-soft text-foreground min-h-screen">{children}</div>;
}
