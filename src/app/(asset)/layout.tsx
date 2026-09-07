import type { ReactNode } from "react";

// 자산 QR 착지 화면 전용 크롬리스 레이아웃 — 사이드바·헤더·알림벨 없음. 모바일 풀스크린(기기에 붙은 라벨을 찍고 들어온다).
// (seat)/(share)/(intake)/(kiosk)/(auth)/(print)과 동일 패턴. 인증 불필요 — 원장 2026-09-03
// *"seat/jj처럼 비로그인자도 볼 수 있게"*(공개 범위는 `/inventory/asset/…` **이 한 경로뿐**, proxy 참조).
// ⚠️ 크롬리스 라우트는 셸의 `main` 하단 여백을 못 받는다 — 하단 여백(pb-8 lg:pb-10)은 페이지가 직접 준다.
export default function AssetPublicLayout({ children }: { children: ReactNode }) {
  return <div className="bg-bg-soft text-foreground min-h-screen">{children}</div>;
}
