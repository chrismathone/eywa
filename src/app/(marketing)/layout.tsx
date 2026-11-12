import type { ReactNode } from "react";
import Link from "next/link";
import { AYWA_SITE_DESCRIPTION } from "@/lib/config/site-metadata";

const LANDING_TITLE = "AI원장키트 | 학원 운영부터 학습까지";
import "./_scroll/landing-base.css";
import "./_scroll/landing-scenes.css";
import "./_scroll/landing-cards.css";
import "./_scroll/landing-responsive.css";
import "./_scroll/flagship.css";
import "./_scroll/flagship-scenes.css";
import "./_scroll/flagship-new.css";
import "./_scroll/flagship-dash.css";

/** 공개 랜딩 = AI원장키트(에이와 · 부원장AI · 인재원SRS) 쇼룸 — 탭 제목만 우산 브랜드로. 공유 미리보기(OG)는 사이트 공통 그대로. */
export const metadata = { title: LANDING_TITLE, description: AYWA_SITE_DESCRIPTION };

/** 공개 랜딩 크롬 — 스타일은 전부 `.lp` 아래로만(globals.css 비오염, (academy)와 같은 방식). 본문 글꼴은 앱 전역 Pretendard. */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="lp" id="top">
      <a href="#main-content" className="skip">본문으로 이동</a>
      <header className="nav" id="nav">
        <div className="wrap in">
          <a className="wm" href="#top" aria-label="AI원장키트 처음으로">AI원장키트</a>
          <nav aria-label="주요 메뉴">
            <a href="#showroom">제품 쇼룸</a><a href="#scene-win">에이와 화면</a><a href="#assistant">학원 비서</a>
            <a href="#menus">에이와 메뉴</a><a href="#compare">운영 현황</a><a href="#ask">도입 안내</a>
          </nav>
          <span className="sp" />
          <Link className="btn sm" href="/login">로그인</Link>
        </div>
      </header>
      <main id="main-content">{children}</main>
      <footer className="ft">
        <div className="wrap">
          <span className="wm">AI원장키트</span><span>에이와 · 부원장AI · 인재원SRS</span><span className="sp" />
          <span>화면에 나오는 이름과 숫자는 모두 예시입니다.</span><span>© AI원장키트</span>
        </div>
      </footer>
    </div>
  );
}
