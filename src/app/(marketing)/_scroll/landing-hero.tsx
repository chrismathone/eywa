import Link from "next/link";
import { DashboardMock } from "./dashboard-mock";

/** 히어로 — 제목·로그인 + 스크롤에 따라 눕혔다 세우는 대시보드 화면(예시, `dashboard-mock`). 기울기는 `landing-motion`이 `--t`로 준다. */
export function LandingHero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="wrap hero-in">
        <p className="kicker">AYWA · 학원 운영 프로그램</p>
        <h1 className="h1" id="hero-title">출석부터 수납까지,<br />학원 운영은 한곳에서.</h1>
        <p className="lead">출석부·시간표·상담·수납·강사 시트를 창으로 열어 나란히 놓고 씁니다. 대시보드에는 재원생·결석·수납처럼 오늘 볼 숫자가 모여 있고, 숫자를 누르면 명단이 열립니다.</p>
        <div className="cta"><Link className="btn" href="/login">로그인</Link><a className="arrow" href="#ask">도입 문의</a></div>
      </div>
      <div className="hero-vis">
        <div className="ph ph-hero" aria-hidden="true"></div>
        <div className="frame-wrap">
          <div className="frame" id="heroFrame" role="img" aria-label="AYWA 대시보드 화면 예시">
            <div className="chrome"><i></i><i></i><i></i><span className="url">www.aywa.co.kr/dashboard</span></div>
            <DashboardMock />
          </div>
        </div>
      </div>
    </section>
  );
}
