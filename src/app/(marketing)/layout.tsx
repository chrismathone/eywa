import type { ReactNode } from "react";
import Link from "next/link";
import { AYWA_SITE_DESCRIPTION, AYWA_SITE_TITLE } from "@/lib/config/site-metadata";
import "./_scroll/landing-base.css";
import "./_scroll/landing-dash.css";
import "./_scroll/landing-scenes.css";
import "./_scroll/landing-cards.css";
import "./_scroll/landing-responsive.css";

export const metadata = { title: AYWA_SITE_TITLE, description: AYWA_SITE_DESCRIPTION };

/** 공개 랜딩 크롬 — 스타일은 전부 `.lp` 아래로만(globals.css 비오염, (academy)와 같은 방식). 본문 글꼴은 앱 전역 Pretendard. */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="lp" id="top">
      <a href="#main-content" className="skip">본문으로 이동</a>
      <header className="nav" id="nav">
        <div className="wrap in">
          <a className="wm" href="#top" aria-label="AYWA 처음으로">aywa</a>
          <nav aria-label="주요 메뉴">
            <a href="#scene-win">화면 구성</a><a href="#scene-consult">상담 기록</a><a href="#menus">메뉴</a>
            <a href="#scene-att">출석부</a><a href="#teachers">강사 화면</a>
          </nav>
          <span className="sp" />
          <Link className="btn sm" href="/login">로그인</Link>
        </div>
      </header>
      <main id="main-content">{children}</main>
      <footer className="ft">
        <div className="wrap">
          <span className="wm">aywa</span><span>학원 운영을 한곳에서, AYWA</span><span className="sp" />
          <span>화면에 나오는 이름과 숫자는 모두 예시입니다.</span><span>© AYWA</span>
        </div>
      </footer>
    </div>
  );
}
