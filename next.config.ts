import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // dev 전용 — Next 16은 localhost 외 출처의 dev 리소스(/_next/webpack-hmr 등)를 기본 차단한다. 폰·태블릿에서
  // LAN IP로 접속하면 HMR 소켓 핸드셰이크가 막히고 **하이드레이션이 끝나지 않아 버튼 onClick이 통째로 죽는다**
  // (네이티브 select만 살아 "클릭이 안 됨"처럼 보임 — 2026-07-15 QR 접수 폼 실측). 프로덕션엔 HMR이 없어 무관.
  // QR 접수 폼처럼 모바일 실기기 확인이 필요한 화면 때문에 사설 IP 대역을 허용해 둔다.
  allowedDevOrigins: ["192.168.101.16", "192.168.0.*", "192.168.1.*", "192.168.101.*"],
  // exceljs(+ 전이 의존 unzipper→fstream→rimraf)는 무거운 CJS 라이브러리 — 번들러가 감싸면 dev(Turbopack)가
  // pnpm 심볼릭 링크 너머 rimraf를 못 풀어 그걸 import하는 서버액션(엑셀 가져오기/내보내기)이 붙은 라우트
  // (예: /timetable)가 통째로 "Module not found: rimraf"로 안 뜬다. external로 두면 Node가 런타임에 resolve
  // (rimraf는 실제로 존재·해결됨) → 번들 대상에서 빠져 dev/프로덕션 모두 안정 + 서버 번들도 가벼워진다.
  serverExternalPackages: ["exceljs"],
};

export default nextConfig;
