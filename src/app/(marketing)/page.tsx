import Link from "next/link";
import { redirect } from "next/navigation";
import { MenuGlyph } from "@/components/icons/menu-glyph";
import { INQUIRY_NOTE } from "@/data/marketing";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getPermMatrix } from "@/lib/auth/perm-matrix";
import { landingPath } from "@/lib/auth/teacher-home";
import { Desk } from "./_desk/desk";
import { RoomButton } from "./_desk/room-button";
import { AskBand, RolesSection, SmallRoomsSection } from "./_parts/landing-sections";

/**
 * 공개 랜딩 = '모형 속 작업 공간'(원장 선택 2026-09-22, 시안 섞기 3+5). 학원 모형이 바탕화면이고 방을 누르면 AYWA 창이
 * 뜬다. 되돌리는 방법 = docs/landing-rollback.md.
 */
export default async function LandingPage() {
  // 로그인 상태면 랜딩 대신 역할 홈으로(강사=원스크린 or ECS, 학생=/my-learning, 그 외=/dashboard) — landingPath 단일 소스.
  // 권한 override로 홈이 '/'가 되는 엣지에선 리다이렉트를 건너뛰어 무한루프를 막는다.
  const user = await getCurrentUser();
  if (user) {
    const home = await landingPath(user.systemRole, await getPermMatrix());
    if (home !== "/") redirect(home);
  }

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="wrap">
          <div className="hero-head">
            <div>
              <p className="eyebrow"><i aria-hidden="true" />학원 한 채가 그대로 바탕화면이 되는 업무 공간</p>
              <h1 id="hero-title">
                <span className="ln">
                  <span className="nw"><RoomButton room="desk" className="hchip"><MenuGlyph name="userPlus" size={48} />데스크</RoomButton>부터</span>{" "}
                  <span className="nw"><RoomButton room="office" className="hchip"><MenuGlyph name="layoutGrid" size={48} />원장실</RoomButton>까지,</span>
                </span>
                <span className="ln">방을 누르면 <em>창이 열립니다.</em></span>
              </h1>
            </div>
            <div>
              <p className="lede">AYWA는 학원 일을 한곳에서 하는 업무 공간입니다. 모형의 점이나 건물 안내판을 누르면 그 방에서 쓰는 화면이 창으로 떠오릅니다. 창은 끌어 옮기고, 가장자리에 붙이고, 접어 둘 수 있습니다.</p>
              <div className="cta">
                <Link className="btn" href="/login">로그인 <span className="arrow" aria-hidden="true">→</span></Link>
                <p className="ask">{INQUIRY_NOTE}</p>
              </div>
            </div>
          </div>
          <div className="ws-shell"><Desk /></div>
        </div>
      </section>
      <RolesSection />
      <SmallRoomsSection />
      <AskBand />
    </>
  );
}
