import { AttendanceTable } from "./attendance-table";
import { sv } from "./style";

/** 고정 장면 C — 스크롤하면 한 달 출석부 칸이 차례로 채워지고 시수 합계가 올라간다. */
export function SceneAttendance() {
  return (
    <section className="pin" id="scene-att" data-scene="att" data-steps="4" style={sv({"--steps": "4"})} aria-labelledby="att-title">
      <div className="stage">
        <div className="wrap stack">
          <div className="top">
          <div className="caps">
            <p className="kicker">스프레드시트처럼 쓰는 출석부</p>
            <h2 className="h2" id="att-title">출결을 체크하면<br />시수는 <mark className="em-mark">저절로</mark> 계산됩니다.</h2>
            <p className="demo-caption">이름과 기록은 가상 예시입니다.</p>
          </div>
          <div className="caps">
            <ol className="steps">
              <li data-i="0"><b>출결 체크</b><span>칸마다 출석·지각·결석을 표시합니다. 강사 화면에는 자기 수업 날만 나옵니다.</span></li>
              <li data-i="1"><b>시수 자동 계산</b><span>수업 시간에 따라 한 교시는 0.5, 두 교시는 1로 계산합니다. 직접 고친 값은 그대로 둡니다.</span></li>
              <li data-i="2"><b>보강 예약</b><span>결석 칸에 보강을 예약하면 메모가 자동으로 적히고, 보강일에 출결이 찍히면 이행 처리됩니다.</span></li>
              <li data-i="3"><b>정산까지 연결</b><span>휴일은 회색으로만 표시되고, 출결은 그날도 입력할 수 있습니다. 월 시수 합계는 강사 정산에 바로 쓰입니다.</span></li>
            </ol>
            <div className="dots" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
          </div>
          </div>
          <div className="canvas">
            <div className="att" id="att" role="img" aria-label="월별 출석부 예시 — 칸이 차례로 채워집니다">
              <div className="tb"><i className="d"></i><i className="d"></i><i className="d"></i><i className="stk i-clipboardCheck"></i>출석부 <span className="sub">· 중2 수학 A · 월·수·금 · 2026년 9월</span></div>
              <div className="legend"><span><i style={sv({"background": "var(--green-s)"})}></i>출석(시수)</span><span><i style={sv({"background": "var(--amber-s)"})}></i>지각</span><span><i style={sv({"background": "var(--red-s)"})}></i>결석</span><span><i style={sv({"background": "var(--purple-s)"})}></i>보강</span><span><i style={sv({"background": "#f1f1f4"})}></i>휴원</span></div>
              <AttendanceTable />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
