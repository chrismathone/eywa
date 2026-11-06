import type { NextConfig } from "next";
import { buildLegacyHostRedirects } from "./src/lib/config/legacy-redirects";

const nextConfig: NextConfig = {
  // 도메인 이전(2026-09-18 준비, 구매 뒤 env 둘로 켠다) — 옛 호스트(`eywa-alpha.vercel.app`)로 온 페이지 요청을 새
  // 도메인의 **같은 경로**로 308. 붙여 둔 자산 QR 라벨·학부모 공유 링크가 산다. `/api/*`는 제외(전사 웹훅·크론·워커).
  // env가 비어 있으면 0개 = 지금과 같다. 규칙·테스트 = src/lib/config/legacy-redirects.ts.
  async redirects() {
    return buildLegacyHostRedirects({
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
      LEGACY_REDIRECT_HOSTS: process.env.LEGACY_REDIRECT_HOSTS,
    });
  },
  // 남의 사이트가 aywa를 iframe으로 띄우지 못하게(클릭재킹 방어, 2026-09-25) — 창 시스템은 **같은 origin** iframe이라
  // 'self'로 그대로 산다. 로그인 쿠키가 SameSite라 남의 사이트 안에선 어차피 로그아웃 상태지만, 로그인 화면을 겹쳐
  // 띄워 입력을 가로채는 길까지 닫는다. ⚠️ 외부 서비스에 aywa 화면을 iframe으로 넣어야 하는 날이 오면 여기서 그 출처를 연다.
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'self'" }] }];
  },
  // Keep Next 16.2's default HTML-only crawlers and add Kakao: its preview must find OG tags in <head>.
  htmlLimitedBots: /[\w-]+-Google|Google-[\w-]+|Chrome-Lighthouse|Slurp|DuckDuckBot|baiduspider|yandex|sogou|bitlybot|tumblr|vkShare|quora link preview|redditbot|ia_archiver|Bingbot|BingPreview|applebot|facebookexternalhit|facebookcatalog|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|SkypeUriPreview|Yeti|googleweblight|kakaotalk|kakaoscrap/i,
  // dev 전용 — Next 16은 localhost 외 출처의 dev 리소스(/_next/webpack-hmr 등)를 기본 차단한다. 폰·태블릿에서
  // LAN IP로 접속하면 HMR 소켓 핸드셰이크가 막히고 **하이드레이션이 끝나지 않아 버튼 onClick이 통째로 죽는다**
  // (네이티브 select만 살아 "클릭이 안 됨"처럼 보임 — 2026-07-15 QR 접수 폼 실측). 프로덕션엔 HMR이 없어 무관.
  // QR 접수 폼처럼 모바일 실기기 확인이 필요한 화면 때문에 사설 IP 대역을 허용해 둔다.
  allowedDevOrigins: ["192.168.101.16", "192.168.0.*", "192.168.1.*", "192.168.101.*"],
  // exceljs(+ 전이 의존 unzipper→fstream→rimraf)는 무거운 CJS 라이브러리 — 번들러가 감싸면 dev(Turbopack)가
  // pnpm 심볼릭 링크 너머 rimraf를 못 풀어 그걸 import하는 서버액션(엑셀 가져오기/내보내기)이 붙은 라우트
  // (예: /timetable)가 통째로 "Module not found: rimraf"로 안 뜬다. external로 두면 Node가 런타임에 resolve
  // (rimraf는 실제로 존재·해결됨) → 번들 대상에서 빠져 dev/프로덕션 모두 안정 + 서버 번들도 가벼워진다.
  // libpg-query(학원 비서 SQL 검사 — Postgres 17 파서 WASM)는 실행 중에 `__dirname`으로 .wasm을 읽는다 — 번들하면 경로가 깨지고,
  // 파일 추적이 동적 경로를 못 따라가니 비서 질문 라우트에 .wasm을 명시로 싣는다(outputFileTracingIncludes).
  // 🔴 **실제 경로(.pnpm)만** — `./node_modules/libpg-query/…`는 pnpm 링크라, 그 아래 파일을 따로 실으면 같은 자리가 '링크'이면서
  //    '파일 든 폴더'가 돼 Vercel이 함수 묶음을 거절한다("invalid deployment package … symlinked directories" · 2026-11-06 배포 실패).
  //    Node는 require 때 링크를 실제 경로로 풀므로 `__dirname` = .pnpm 경로 → 여기 실은 .wasm을 읽는다.
  serverExternalPackages: ["exceljs", "libpg-query"],
  outputFileTracingIncludes: {
    "/api/assistant/ask": ["./node_modules/.pnpm/libpg-query@*/node_modules/libpg-query/wasm/**/*"],
  },
  // ── Vercel 빌드 비용(2026-07-23) ────────────────────────────────────────────────────────
  // 빌드 과금 = **올림(분) × CPU 수 × 단가**라, 빌드에서 1~2분만 덜어도 배포마다 그만큼 곱해서 줄어든다.
  // 실측: 이번 청구주기 2일 만에 포함 크레딧 $20 중 $7.64 소진, 그중 **Build CPU Minutes가 $4.86(64%)**.
  //
  // 타입체크는 **푸시 전 로컬에서 이미 돌린다**(작업 절차상 tsc+lint 통과가 완료 조건). Vercel이 같은 검사를
  // 다시 하는 건 순수 중복이다. 이 리포의 tsc는 단독 실행만 **31초**이고, 빌드 과금은 **분 단위 올림**이라
  // 30초~1분을 덜어내면 배포마다 1분치(=CPU 수 × 단가)가 통째로 빠진다.
  // ⚠️ 로컬 빌드 시간으로 절감폭을 재지 말 것 — OS 파일 캐시 상태에 따라 43초~2분 51초까지 흔들렸다.
  //    실제 절감은 Vercel 빌드 로그의 소요 시간으로 확인한다.
  // ⚠️ ESLint는 끌 필요가 없다 — Next 16은 빌드 중 ESLint를 아예 돌리지 않는다(`eslint` 키도 사라짐).
  //
  // ⚠️ 트레이드오프: 타입 오류가 있어도 **배포가 막히지 않는다**. Next는 SWC로 타입을 지우고 컴파일하므로
  //    대부분은 런타임에 무해하지만, 안전망이 로컬 검증으로 옮겨간 것이다 —
  //    **푸시 전 `pnpm typecheck`를 건너뛰지 말 것**(이게 이제 유일한 게이트다).
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
