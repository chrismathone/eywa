import type { Metadata } from "next";
import { brandLabels, getPublicBranding } from "@/features/owner/server/public-branding";
import { WalkScene } from "./walk-scene";

/**
 * 학원 공개 랜딩(/academy) — 관객은 학부모. 입구 영상을 스크롤로 감아 상담 데스크까지 걸어 들어간다.
 *
 * ⚠️ aywa **제품** 랜딩(`/`, (marketing))과는 다른 페이지다. 저쪽 관객은 원장(고객사)이고
 *    로그인·도입 문의 안내가 있다. 여기는 학원 자신의 홍보면이라 섞지 말 것.
 * ⚠️ 학원명은 하드코딩하지 않고 `getPublicBranding()`으로 읽는다 — 로그인 전이라 세션이 없어
 *    `getTenantSettings()`는 못 쓴다(**회사 브랜드 학원**만 확정 — 1개면 그 학원, 2개+면 env `PUBLIC_BRAND_TENANT_SLUG`,
 *    아니면 제품 중립 표기로 폴백. `pickBrandTenantId`, 2026-09-18).
 *
 * TODO(문구): 아래 본문·과목 설명·알림 예시·상담 링크는 아직 확정 전 예시다.
 *   상담 CTA는 이미 있는 QR 공개접수(`/intake/[token]`)로 연결하면 된다 — 토큰 확정 후 배선.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { academyName } = brandLabels(await getPublicBranding());
  const name = academyName ?? "학원";
  return {
    title: `${name} — 문 안쪽`,
    description: `${name} 입구에서 상담 데스크까지, 그대로 걸어 들어가 보세요.`,
  };
}

export default async function AcademyLandingPage() {
  // 🔴 wordmark로 폴백하면 안 된다 — brandLabels()가 로고문구 미설정 시 "AYWA"(제품명)로
  // 떨어지는데, 여기서 그걸 쓰면 학원 자신의 홍보면 헤더·푸터에 aywa 제품명이 학원 브랜드처럼
  // 노출된다("제품 중립 표기" 원칙 위반, 아래 title generateMetadata와 동일하게 "학원"으로 통일).
  const { academyName } = brandLabels(await getPublicBranding());
  const name = academyName ?? "학원";

  return (
    <>
      <header className="ac-topbar" id="ac-topbar">
        <a className="ac-brand" href="#ac-top">
          {name}
          <i>.</i>
        </a>
        <a className="ac-topcta" href="#ac-invite">
          상담 신청
        </a>
      </header>

      <WalkScene>
        <div className="ac-panel ac-panel-intro">
          <p className="ac-eyebrow lat ac-p-eyebrow">Injaewon</p>
          <p className="ac-p-title">
            문을 열어
            <br />
            두었습니다
          </p>
          <p className="ac-p-body">
            입구에서 상담 데스크까지,
            <br />
            그대로 걸어 들어가 보세요.
          </p>
        </div>

        <div className="ac-panel ac-panel-desk">
          <p className="ac-eyebrow ac-p-eyebrow">상담 데스크</p>
          <p className="ac-p-title">
            여기서부터
            <br />
            시작합니다
          </p>
          <p className="ac-p-body">
            학년과 지금 진도만 알려주시면
            <br />
            어느 반이 맞는지 함께 봐 드립니다.
          </p>
          <p className="ac-chips">
            <b>레벨테스트</b>
            <b>반 배정 상담</b>
            <b>셔틀 노선</b>
          </p>
          <a className="ac-p-cta" href="#ac-invite">
            상담 신청하기 →
          </a>
        </div>

        <div className="ac-hud" aria-hidden="true">
          <span className="ac-hud-label">
            <span className="ac-caret">↓</span> <b>스크롤</b>해서 들어가 보세요
          </span>
          <span className="ac-rail">
            <i />
          </span>
        </div>
      </WalkScene>

      {/* 필름과 본문 사이 한 마디 — 색이 뚝 끊기면 두 페이지처럼 보인다 */}
      <section className="ac-threshold">
        <div className="ac-hair" aria-hidden="true" />
        <p className="ac-serif">
          문은 하루에
          <br />
          수백 번 열립니다
        </p>
        <p className="ac-sub">
          그 문을 지나는 아이가 오늘 무엇을 했는지, 집에서도 아실 수 있게 만들어 두는 것.
        </p>
      </section>

      <div className="ac-light" id="ac-top">
        <div className="ac-wrap">
          <div className="ac-lede">
            <p className="ac-eyebrow">문 안쪽</p>
            <h1>
              가르치는 일만큼
              <br />
              기록하는 일을 합니다
            </h1>
            <p>
              등원하면 문자가 갑니다. 수업이 끝나면 그날 무엇을 했고 무엇이 숙제인지 보고서로
              갑니다. 학부모가 학원에 전화해서 물어보지 않아도 되도록 만들어 두는 것, 그게 저희가 문
              안쪽에서 하는 일입니다.
            </p>
          </div>
        </div>

        <div className="ac-wrap ac-rows">
          <div className="ac-row">
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/academy/sec-math.webp" alt="인재원 복도에 놓인 수상 기록과 안내 게시판" />
            </figure>
            <div>
              <p className="ac-eyebrow lat">Brenos Mathmong</p>
              <h2>수학</h2>
              <p>
                학년과 진도로 반을 나누고, 매일의 테스트를 기록으로 남깁니다. 오답이 쌓이는 자리를
                놓치지 않기 위해서입니다.
              </p>
            </div>
          </div>
          <div className="ac-row">
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/academy/sec-eng.webp" alt="인재원 복도 끝으로 이어지는 밝은 강의 공간" />
            </figure>
            <div>
              <p className="ac-eyebrow">EiE · 인재원 영어</p>
              <h2>영어</h2>
              <p>두 갈래로 운영합니다. 어디서 시작할지는 짐작하지 않고 레벨테스트로 정합니다.</p>
            </div>
          </div>
          <div className="ac-row">
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/academy/sec-shuttle.webp" alt="인재원 입구의 유리문과 황동 사인" />
            </figure>
            <div>
              <p className="ac-eyebrow">등하원 기록</p>
              <h2>셔틀</h2>
              <p>
                노선과 정류장을 정해 두고, 어디서 타고 어디서 내렸는지 남깁니다. 오늘 아이가 어느
                차를 탔는지 되짚을 수 있습니다.
              </p>
            </div>
          </div>
        </div>

        {/* 말로 설명하는 대신 학부모가 실제로 받는 것을 그대로 보여준다 */}
        <div className="ac-wrap ac-proof">
          <div className="ac-proof-head">
            <p className="ac-eyebrow">학부모에게 가는 것</p>
            <h2>
              말로 설명하는 대신
              <br />
              그대로 보여드립니다
            </h2>
            <p>등원과 수업이 끝나면 이런 내용이 갑니다. 따로 물어보지 않으셔도 됩니다.</p>
          </div>
          <div className="ac-msgs">
            <div className="ac-msg">
              <span className="ac-who">등원 알림</span>
              <p>OO 학생이 방금 등원했습니다.</p>
              <span className="ac-time">오후 4:02</span>
            </div>
            <div className="ac-msg">
              <span className="ac-who">수업 보고서</span>
              <p>
                오늘은 이차함수 그래프를 다뤘습니다. 데일리 테스트는 12문제 중 10개 맞음. 오늘 과제는
                42-60p입니다.
              </p>
              <span className="ac-time">오후 6:35</span>
            </div>
          </div>
        </div>
      </div>

      <section className="ac-closing" id="ac-invite">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/academy/sec-desk.webp" alt="" aria-hidden="true" />
        <div className="ac-inner">
          <p className="ac-eyebrow">상담 신청</p>
          <h2>
            한 번 와 보시면
            <br />
            가장 빠릅니다
          </h2>
          <p>학년과 지금 진도만 알려주시면, 어느 반이 맞는지 함께 봐 드립니다.</p>
          <a className="ac-btn" href="#ac-invite">
            상담 신청하기 →
          </a>
        </div>
      </section>

      <footer className="ac-footer">
        <div className="ac-wrap">
          <span className="ac-mark">
            {name}
            <i>.</i>
          </span>
          <p className="ac-note">
            <b>문구는 아직 예시입니다.</b> 과목 설명·알림 예시·상담 링크는 확정하신 내용과 실제
            연락처로 바꿔야 합니다. 상담 버튼은 QR 공개접수 폼으로 연결할 예정입니다.
          </p>
        </div>
      </footer>
    </>
  );
}
