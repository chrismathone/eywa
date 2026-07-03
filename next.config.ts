import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // exceljs(+ 전이 의존 unzipper→fstream→rimraf)는 무거운 CJS 라이브러리 — 번들러가 감싸면 dev(Turbopack)가
  // pnpm 심볼릭 링크 너머 rimraf를 못 풀어 그걸 import하는 서버액션(엑셀 가져오기/내보내기)이 붙은 라우트
  // (예: /timetable)가 통째로 "Module not found: rimraf"로 안 뜬다. external로 두면 Node가 런타임에 resolve
  // (rimraf는 실제로 존재·해결됨) → 번들 대상에서 빠져 dev/프로덕션 모두 안정 + 서버 번들도 가벼워진다.
  serverExternalPackages: ["exceljs"],
};

export default nextConfig;
