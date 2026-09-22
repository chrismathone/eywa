import Image from "next/image";
import Link from "next/link";
import { MenuGlyph } from "@/components/icons/menu-glyph";
import { INQUIRY_NOTE, LANDING_ROLES, LANDING_SMALL_ROOMS } from "@/data/marketing";
import { RoomButton } from "../_desk/room-button";

/** 역할 카드 — 모형의 층이 곧 그 역할이 일하는 자리. '모형에서 열기'는 위 작업 공간의 그 방을 연다. */
export function RolesSection() {
  return (
    <section className="band" aria-labelledby="role-title">
      <div className="wrap">
        <div className="sec-head">
          <div><p className="kicker">역할별 화면</p><h2 id="role-title">같은 건물, 층마다<br />다른 사람이 일합니다.</h2></div>
          <p className="sub">원장·관리자, 강사, 데스크가 로그인하면 각자 필요한 화면만 열립니다. 권한은 역할별로 정하고, 필요하면 사람별로 조정합니다.</p>
        </div>
        <div className="roles">
          {LANDING_ROLES.map((r) => (
            <article key={r.room} className="role">
              <div className="crop"><Image src={r.image} alt={r.alt} fill sizes="(max-width: 760px) 92vw, (max-width: 1100px) 45vw, 30vw" /></div>
              <div className="in">
                <span className="tag">{r.tag}</span>
                <h3>{r.title}</h3>
                <p>{r.body}</p>
                <div className="foot">
                  <ul>{r.menus.map((m) => <li key={m}>{m}</li>)}</ul>
                  <RoomButton room={r.room} className="go">모형에서 열기 ↑</RoomButton>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function SmallRoomsSection() {
  return (
    <section className="band tight" aria-labelledby="rooms-title">
      <div className="wrap">
        <div className="sec-head">
          <div><p className="kicker">건물 곳곳의 작은 방</p><h2 id="rooms-title">매일 쓰는 일도 빠짐없이.</h2></div>
          <p className="sub">큰 메뉴 말고도 학원을 굴리는 작은 일들이 한 체계 안에 있습니다. 과목·학년·교시·휴일은 학원마다 정합니다.</p>
        </div>
        <div className="rooms">
          {LANDING_SMALL_ROOMS.map((r) => (
            <div key={r.title} className="sroom"><MenuGlyph name={r.icon} size={46} /><div><b>{r.title}</b><span>{r.body}</span></div></div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function AskBand() {
  return (
    <section className="band tight" aria-labelledby="ask-title">
      <div className="wrap">
        <div className="ask-band">
          <div><h2 id="ask-title">{INQUIRY_NOTE}</h2><p>이미 계정이 있다면 바로 로그인해 오늘 업무를 시작하세요.</p></div>
          <Link className="btn light" href="/login">로그인 <span className="arrow" aria-hidden="true">→</span></Link>
        </div>
      </div>
    </section>
  );
}
