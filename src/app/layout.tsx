import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import { AppProviders } from "@/lib/providers/app-providers";
import { brandLabels, getPublicBranding } from "@/features/owner/server/public-branding";
import { AYWA_SHARE_METADATA, AYWA_SITE_DESCRIPTION } from "@/lib/config/site-metadata";
import { deskDetectScript } from "@/components/workspace/desk-detect";
import { pretendard } from "./fonts";
import "./globals.css";
import "./instrument-theme.css"; // 시안(dev 전용): 앱 전체 색감 = 새 대시보드 색감

// ⚠️ preload:false — de-mono 정책(2026-07-19) 이후 모노는 kbd 힌트·팔레트 라벨 등 극소수에서만 쓴다
// (`.num`은 tabular-nums만 걸고 Pretendard 유지). 그런데 next/font는 문서마다 preload 링크를 넣고,
// 메뉴가 **창=iframe**이라 창 하나당 새 문서 = preload가 곱해진다 → 모노 글리프를 한 글자도 안 쓰는
// 창에서 Chrome이 "preloaded but not used" 경고를 문서 수만큼 찍었다. 폰트는 self-host 그대로이고
// 첫 모노 글리프 렌더 시점에 로드된다(31KB + display:swap + 메트릭 폴백이라 체감 플래시 없음).
// Pretendard(fonts.ts)의 preload는 **유지** — 본문 전체 폰트라 빼면 첫 페인트가 시스템폰트로 튄다.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  preload: false,
});

/**
 * 자체 metadata가 없는 라우트(키오스크 등)의 기본 탭 제목 — **학원명은 설정에서**(getPublicBranding).
 * 키오스크 본문은 이미 테넌트 학원명을 읽는데 탭 제목만 하드코딩("인재원")이라 어긋나 있었다.
 * 단일 테넌트가 아니면 제품명 단독으로 폴백. 조회는 cross-request 캐시라 라우트마다 DB를 때리지 않는다.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { academyName } = brandLabels(await getPublicBranding());
  return {
    ...AYWA_SHARE_METADATA,
    title: academyName ? `에이와 — ${academyName} 학원관리` : "에이와",
    description: AYWA_SITE_DESCRIPTION,
    // 휴대폰 푸시(0188a) 전제 — **iOS는 홈 화면에 추가된 앱에만 푸시를 준다**(16.4+). 그 "추가"가
    // 성립하려면 manifest(display:standalone)와 apple-touch-icon이 있어야 한다. 안드로이드는 manifest
    // 없이도 푸시가 오지만, 같은 파일이 홈 화면 아이콘·이름을 함께 챙긴다.
    manifest: "/manifest.json",
    appleWebApp: { capable: true, title: academyName ? `${academyName} 에이와` : "에이와", statusBarStyle: "default" },
    icons: { icon: "/eywa-mark.png", apple: "/eywa-mark.png" },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${pretendard.variable} ${jetbrainsMono.variable} h-full antialiased`}
      // 판정 스크립트가 하이드레이션 전에 `data-desk`·`data-mouse`를 붙인다 — 그 두 속성의 불일치 경고만 끈다(이 요소 한 단계).
      suppressHydrationWarning
    >
      <head>
        {/* 데스크톱 셸 판정 — 실제 마우스 움직임(desk-detect.ts). 본문보다 먼저 돌아 첫 페인트부터 맞는 셸(번쩍임 없음). */}
        <script dangerouslySetInnerHTML={{ __html: deskDetectScript() }} />
      </head>
      <body className="bg-background text-foreground min-h-full font-sans">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
