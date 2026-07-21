import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import { AppProviders } from "@/lib/providers/app-providers";
import { brandLabels, getPublicBranding } from "@/features/owner/server/public-branding";
import { pretendard } from "./fonts";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

/**
 * 자체 metadata가 없는 라우트(키오스크 등)의 기본 탭 제목 — **학원명은 설정에서**(getPublicBranding).
 * 키오스크 본문은 이미 테넌트 학원명을 읽는데 탭 제목만 하드코딩("인재원")이라 어긋나 있었다.
 * 단일 테넌트가 아니면 제품명 단독으로 폴백. 조회는 cross-request 캐시라 라우트마다 DB를 때리지 않는다.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { academyName } = brandLabels(await getPublicBranding());
  return {
    title: academyName ? `eywa — ${academyName} 학원관리` : "eywa",
    description: "원장님이 가장 먼저 켜는 학원관리 프로그램.",
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
    >
      <body className="bg-background text-foreground min-h-full font-sans">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
