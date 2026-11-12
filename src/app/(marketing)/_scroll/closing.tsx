import Link from "next/link";
import { INQUIRY_TITLE_LINES } from "@/data/marketing";
import { ScreenStrip } from "./screen-strip";
import { sv } from "./style";

/** 강사 사진 띠 → 화면 스트립 → 운영 원칙 3열 → 문의 띠. */
export function LandingClosing() {
  return (
    <>
      <section className="band rv" id="teachers" aria-label="강사 화면 소개">
        <div className="ph ph-teacher" aria-hidden="true"></div>
        <div className="wrap"><p className="kicker">강사 전용 화면</p><h2 className="h2">사이드바 없이<br /><span className="em-rule">오늘 수업</span>만 보입니다.</h2><p className="lead">수업이 끝나면 수업보고서를 저장합니다. 출결이 같이 찍히고, 보고서는 학부모 알림장으로 나갑니다.</p></div>
      </section>
      <ScreenStrip />
      <section className="sec trio-sec" aria-label="운영 원칙">
        <div className="wrap trio">
          <div className="rv"><i className="stk i-users" style={sv({"width": "44px", "height": "44px"})}></i><h3 className="h3">여러 지점, 하나의 주소</h3><p>지점이 여러 곳이어도 같은 주소로 접속합니다. 로그인하면 자기 지점의 원생과 수업만 보입니다.</p></div>
          <div className="rv" style={sv({"--d": ".08s"})}><i className="stk i-report" style={sv({"width": "44px", "height": "44px"})}></i><h3 className="h3">바꾼 기록이 남습니다</h3><p>누가 언제 무엇을 바꿨는지 감사 로그에 남습니다. 퇴원이나 수강 종료처럼 되돌리기 어려운 일은 강사 계정으로는 할 수 없습니다.</p></div>
          <div className="rv" style={sv({"--d": ".16s"})}><i className="stk i-calendar" style={sv({"width": "44px", "height": "44px"})}></i><h3 className="h3">설정은 학원에 맞게</h3><p>과목, 학년, 교시, 휴일은 학원마다 따로 정합니다. 화면의 선택지와 색상은 모두 이 설정을 따릅니다.</p></div>
        </div>
      </section>

      <section className="ask" id="ask" aria-labelledby="ask-title">
        <div className="wrap">
          <p className="kicker rv">도입 안내</p>
          <h2 className="h2 rv" id="ask-title" style={sv({"--d": ".06s"})}>{INQUIRY_TITLE_LINES[0]}<br /><span className="em-rule">{INQUIRY_TITLE_LINES[1]}</span></h2>
          <p className="lead rv" style={sv({"--d": ".12s"})}>이미 계정이 있는 직원과 강사는 로그인 후 바로 이용할 수 있습니다. 계정은 소속 학원에서 발급합니다.</p>
          <Link className="btn rv" style={sv({"--d": ".18s"})} href="/login">로그인</Link>
        </div>
      </section>
    </>
  );
}
