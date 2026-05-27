import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import { AppProviders } from "@/lib/providers/app-providers";
import { pretendard } from "./fonts";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "eywa — 인재원 학원관리",
  description: "ijw-calander의 경량 재작성 버전. 12개 메뉴, Next.js + Supabase.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${pretendard.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="bg-background text-foreground min-h-full font-sans">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
