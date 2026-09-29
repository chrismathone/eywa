import Link from "next/link";
import { DashboardMock } from "./dashboard-mock";

/** 히어로 — 제목·로그인 + 스크롤에 따라 눕혔다 세우는 가상 화면. 기울기는 `landing-motion`이 `--t`로 준다. */
export function LandingHero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="wrap hero-in">
        <p className="kicker">에이와 · 학원 운영 프로그램</p>
        <h1 className="h1" id="hero-title">출석부터 수납까지,<br />학원 운영은 한곳에서.</h1>
        <p className="lead">수업과 운영의 흐름을 한곳에 모아, 오늘 필요한 일에 더 빠르게 집중할 수 있습니다.</p>
        <div className="cta"><Link className="btn" href="/login">로그인</Link><a className="arrow" href="#ask">도입 문의</a></div>
      </div>
      <div className="hero-vis">
        <div className="ph ph-hero" aria-hidden="true"></div>
        <div className="frame-wrap">
          <div className="frame" id="heroFrame" role="img" aria-label="실제 서비스 화면과 다른 에이와 가상 운영 보드">
            <div className="chrome"><i></i><i></i><i></i><span className="url">에이와 · 화면 연출 예시</span></div>
            <DashboardMock />
          </div>
        </div>
      </div>
    </section>
  );
}
