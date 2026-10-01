import type { ReactNode } from "react";

// 학부모 공개 보고서(/r)·공용 링크 만료 안내(/expired) 크롬리스 레이아웃 — 사이드바·헤더 없음, 모바일 풀스크린(카톡/문자 링크 진입).
// (intake)/(kiosk)/(auth)/(print) 동일 패턴. 인증 불필요(share_token이 테넌트를 해석 — service_role 조회).
export default function ShareLayout({ children }: { children: ReactNode }) {
  return <div className="bg-bg-soft text-foreground min-h-screen">{children}</div>;
}
