import { sv } from "./style";

/** 고정 장면 A — 스크롤하면 창 네 개(출석부·시간표·콜&상담·수납)가 차례로 겹치지 않게 열린다. */
export function SceneWindows() {
  return (
    <section className="pin" id="scene-win" data-scene="win" data-steps="4" style={sv({"--steps": "4"})} aria-labelledby="win-title">
      <div className="stage">
        <div className="wrap two">
          <div className="caps">
            <p className="kicker">여러 화면을 나란히</p>
            <h2 className="h2" id="win-title">시간표 <mark className="em-mark">옆에</mark> 출석부,<br />그 옆에 상담과 수납.</h2>
            <p className="demo-caption">이름과 숫자는 가상 예시입니다.</p>
            <ol className="steps">
              <li data-i="0"><b>출석부</b><span>한 달 표에 출결을 체크하면 시수는 수업 길이에 맞춰 자동으로 계산됩니다.</span></li>
              <li data-i="1"><b>시간표</b><span>반이나 학생을 드래그하면 학생·강사·강의실이 겹치는 자리는 빗금으로 미리 막아 둡니다. 저장을 눌러야 반영됩니다.</span></li>
              <li data-i="2"><b>콜&amp;상담</b><span>상담 전 › 상담 완료 › 미등록 › 등록 완료. 상담을 마치면 후속 조치를 남기고, 다음 상담일이 다가오면 알림이 옵니다.</span></li>
              <li data-i="3"><b>수납관리</b><span>청구서부터 수납, 회차 확정, 강사 정산까지 차례로 이어집니다. 정산의 수업료는 급여명세서와 같은 방식으로 계산됩니다.</span></li>
            </ol>
            <div className="dots" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
          </div>
          <div className="canvas desk" id="desk" aria-label="창 네 개가 차례로 열리는 작업 공간 예시">
            <div className="win w1" data-i="0">
              <div className="tb"><i className="d"></i><i className="d"></i><i className="d"></i><i className="stk i-clipboardCheck"></i>출석부 <span className="sub">· 중2 수학 A · 9월</span></div>
              <div className="wb">
                <table className="mini" aria-hidden="true"><tbody>
                  <tr><th className="nm">이름</th><th>9/14<br />월</th><th>9/16<br />수</th><th>9/18<br />금</th><th>9/21<br />월</th><th>9/23<br />수</th><th>9/25<br />금</th><th>시수</th></tr>
                  <tr><td className="nm">김하늘</td><td className="g">1</td><td className="g">1</td><td className="g">1</td><td className="g">0.5</td><td></td><td className="we">휴</td><td className="num">3.5</td></tr>
                  <tr><td className="nm">이준서</td><td className="g">1</td><td className="p">보</td><td className="g">1</td><td className="g">1</td><td></td><td className="we">휴</td><td className="num">4</td></tr>
                  <tr><td className="nm">박서윤</td><td className="a">지</td><td className="g">1</td><td className="g">1</td><td className="g">1</td><td></td><td className="we">휴</td><td className="num">4</td></tr>
                  <tr><td className="nm">최도윤</td><td className="g">1</td><td className="g">1</td><td className="r">결</td><td className="g">1</td><td></td><td className="we">휴</td><td className="num">3</td></tr>
                  <tr><td className="nm">정하린</td><td className="g">1</td><td className="g">1</td><td className="g">1</td><td className="g">1</td><td></td><td className="we">휴</td><td className="num">4</td></tr>
                </tbody></table>
              </div>
            </div>
            <div className="win w2" data-i="1">
              <div className="tb"><i className="d"></i><i className="d"></i><i className="d"></i><i className="stk i-weekGrid"></i>시간표 <span className="sub">· 수학 · 기본뷰</span></div>
              <div className="wb">
                <div className="tt" aria-hidden="true">
                  <div className="pr"></div><div className="hd">월</div><div className="hd">화</div><div className="hd">수</div><div className="hd">목</div><div className="hd">금</div>
                  <div className="pr num">16:20</div><div className="cell"><div className="blk m tall">중2 수학 A<small>김선생 · 302</small></div></div><div className="cell ok"></div><div className="cell"><div className="blk m tall">중2 수학 A<small>김선생 · 302</small></div></div><div className="cell no"></div><div className="cell"><div className="blk m tall">중2 수학 A<small>김선생 · 302</small></div></div>
                  <div className="pr num">17:15</div><div className="cell"></div><div className="cell ok"></div><div className="cell"></div><div className="cell no"></div><div className="cell"></div>
                  <div className="pr num">18:20</div><div className="cell"><div className="blk m tall">중3 수학 심화<small>김선생 · 302</small></div></div><div className="cell"><div className="ghost">놓기</div></div><div className="cell"><div className="blk m tall">중3 수학 심화<small>김선생 · 302</small></div></div><div className="cell"><div className="blk e tall">중1 영어 정규<small>이선생 · 203</small></div></div><div className="cell"></div>
                  <div className="pr num">19:15</div><div className="cell"></div><div className="cell"></div><div className="cell"></div><div className="cell"></div><div className="cell"></div>
                  <div className="pr num">20:20</div><div className="cell"></div><div className="cell"><div className="blk m tall">고1 수학<small>김선생 · 303</small></div></div><div className="cell"></div><div className="cell"><div className="blk m tall">고1 수학<small>김선생 · 303</small></div></div><div className="cell"></div>
                  <div className="pr num">21:15</div><div className="cell"></div><div className="cell"></div><div className="cell"></div><div className="cell"></div><div className="cell"></div>
                </div>
              </div>
            </div>
            <div className="win w3" data-i="2">
              <div className="tb"><i className="d"></i><i className="d"></i><i className="d"></i><i className="stk i-messages"></i>콜&amp;상담 <span className="sub">· 9월</span></div>
              <div className="wb">
                <div className="kb" aria-hidden="true">
                  <div className="col"><h5>상담 전 <b>3</b></h5><div className="kc">한지안 <small>초3 · QR 접수</small></div><div className="kc">오예준 <small>중1 · 오늘 접수</small></div><div className="kc">서지우 <small>중2 · 예약 9/23</small></div></div>
                  <div className="col"><h5>상담 완료 <b>4</b></h5><div className="kc">최도윤 <small>초5 · <span className="mic">● 녹음 · AI 요약</span></small></div><div className="kc">유하람 <small>중3 · 입테 9/23</small></div><div className="kc drag">강민서 <small>초6 · 상담 9/19</small></div></div>
                  <div className="col"><h5>미등록 <b>1</b></h5><div className="kc">문가온 <small>중1 · 타학원 결정</small></div></div>
                  <div className="col"><h5>등록 완료 <b>6</b></h5><div className="kc">김하늘 <small>중2 · 반 배정 완료</small></div><div className="kc">박서윤 <small>중2 · 반 배정 완료</small></div><div className="kc">정하린 <small>중2 · 첫 수업 9/28</small></div></div>
                </div>
              </div>
            </div>
            <div className="win w4" data-i="3">
              <div className="tb"><i className="d"></i><i className="d"></i><i className="d"></i><i className="stk i-wallet"></i>수납관리 <span className="sub">· 2026년 9월</span></div>
              <div className="wb">
                <table className="pay" aria-hidden="true"><tbody>
                  <tr><th>학생</th><th>청구</th><th>수납</th><th>상태</th></tr>
                  <tr><td>김하늘 <small className="num">중2</small></td><td className="num">380,000</td><td className="num">380,000</td><td><span className="pill g">수납 완료</span></td></tr>
                  <tr><td>이준서 <small className="num">중2</small></td><td className="num">380,000</td><td className="num">200,000</td><td><span className="pill a">부분 수납</span></td></tr>
                  <tr><td>박서윤 <small className="num">중2</small></td><td className="num">520,000</td><td className="num">520,000</td><td><span className="pill g">수납 완료</span></td></tr>
                  <tr><td>최도윤 <small className="num">초5</small></td><td className="num">300,000</td><td className="num">0</td><td><span className="pill r">미납 · 12일</span></td></tr>
                  </tbody><tfoot><tr><td>9월 합계</td><td className="num">1,580,000</td><td className="num">1,100,000</td><td><span className="pill b">회차 확정 3/4</span></td></tr></tfoot>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
