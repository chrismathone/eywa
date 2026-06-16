import Link from "next/link";
import { Fraunces } from "next/font/google";
import type { ReactNode } from "react";
import { EyIcon } from "@/components/icons/eywa-icons";
import { NAV_LINKS } from "@/data/marketing";
import { CtaButton } from "./_ui/cta-button";
import "./_motion/landing.css";

/** Latin serif 악센트 — 영문/숫자 글리프 전용, 비차단(swap). 한글엔 미적용. */
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata = {
  title: "EYWA — 원장님이 가장 먼저 켜는 학원관리 프로그램",
  description:
    "출결·수납·상담·학부모 알림까지, 학원 운영의 모든 흐름을 한 화면에서. 한 번의 출석 체크가 0.4초 만에 학부모·강사·원장·회계로 동시에 흐릅니다. 베타 기간 무료.",
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`ey-landing ${fraunces.variable} bg-background text-foreground min-h-screen`}>
      <MarketingNav />
      <main>{children}</main>
    </div>
  );
}

function MarketingNav() {
  return (
    <header className="border-line bg-background/75 sticky top-0 z-40 border-b backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1180px] items-center justify-between px-6 sm:px-10 lg:px-16">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md">
            <EyIcon name="leaf" size={16} />
          </span>
          <span className="text-[19px] font-extrabold tracking-tight">EYWA</span>
        </Link>

        <nav className="hidden items-center gap-7 md:flex" aria-label="주요 메뉴">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-text-dim hover:text-foreground text-[13.5px] font-medium transition-colors"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="text-text-dim hover:text-foreground hidden text-[13.5px] font-medium transition-colors md:inline"
          >
            로그인
          </Link>
          <CtaButton href="/login" size="sm">
            무료로 시작
          </CtaButton>
        </div>
      </div>
    </header>
  );
}
