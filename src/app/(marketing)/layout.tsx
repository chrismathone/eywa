import type { ReactNode } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/public-site/brand-mark";
import { landingDisplay } from "@/components/public-site/fonts";
import { AYWA_SITE_DESCRIPTION, AYWA_SITE_TITLE } from "@/lib/config/site-metadata";
import "./landing.css";
import "./_desk/desk-shell.css";
import "./_desk/desk-win.css";

export const metadata = { title: AYWA_SITE_TITLE, description: AYWA_SITE_DESCRIPTION };

/** 공개 랜딩 크롬 — 스타일은 전부 `.lp` 아래로만(globals.css 비오염, (academy)와 같은 방식). */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`lp ${landingDisplay.variable}`}>
      <a href="#main-content" className="skip">본문으로 이동</a>
      <header className="top">
        <div className="wrap">
          <Link className="mark" href="/" aria-label="AYWA 처음으로">
            <BrandMark size={28} /><b>AYWA</b><small>학원 운영 업무 공간</small>
          </Link>
          <Link className="btn sm" href="/login">로그인</Link>
        </div>
      </header>
      <main id="main-content">{children}</main>
      <footer className="site-foot">
        <div className="wrap">
          <span className="mark"><BrandMark size={22} /><b>AYWA</b></span>
          <p>학원의 하루를 연결하는 업무 공간 · 이 페이지의 화면 속 이름과 숫자는 모두 예시입니다.</p>
          <span className="copy">© AYWA</span>
        </div>
      </footer>
    </div>
  );
}
