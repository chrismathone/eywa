import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import { AppProviders } from "@/lib/providers/app-providers";
import { pretendard } from "./fonts";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "eywa — 인재원 학원관리",
  description: "원장님이 가장 먼저 켜는 학원관리 프로그램.",
};

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
