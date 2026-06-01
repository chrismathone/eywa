import Link from "next/link";
import type { ReactNode } from "react";
import { NAV_LINKS } from "@/data/marketing";

export const metadata = {
  title: "EYWA — 원장님이 가장 먼저 켜는 학원관리 프로그램",
  description:
    "출결·수납·상담·학부모 알림까지 학원 운영에 꼭 필요한 모든 기능을 한 화면에서. 베타 무료.",
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background text-foreground min-h-screen">
      <MarketingNav />
      <main>{children}</main>
    </div>
  );
}

function MarketingNav() {
  return (
    <header className="bg-background border-line sticky top-0 z-30 border-b">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between px-16 py-[18px]">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="bg-ink flex size-7 items-center justify-center rounded-[3px]">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="5" fill="none" stroke="#fff" strokeWidth="1.2" />
              <circle cx="8" cy="8" r="2" fill="#fff" />
            </svg>
          </span>
          <span className="text-foreground text-[19px] font-extrabold tracking-tight">EYWA</span>
        </Link>
        <nav className="hidden items-center gap-6 md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-text-dim hover:text-foreground text-[14px] font-medium transition"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="text-foreground hidden text-[14px] font-medium hover:underline md:inline"
          >
            로그인
          </Link>
          <Link
            href="/login"
            className="bg-primary text-primary-foreground hover:bg-primary-hover inline-flex items-center rounded-xl px-[18px] py-2.5 text-[14px] font-semibold transition"
          >
            무료로 시작하기
          </Link>
        </div>
      </div>
    </header>
  );
}
