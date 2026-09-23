import { sv } from "./style";

/** 매일 쓰는 메뉴 12칸 + 교실 사진 띠. `.rv`는 화면에 들어올 때 떠오른다. */
export function MenuGrid() {
  return (
    <>
      <section className="sec alt" id="menus" aria-labelledby="menus-title">
        <div className="wrap">
          <div className="head">
            <p className="kicker rv">학원에서 매일 쓰는 메뉴</p>
            <h2 className="h2 rv" id="menus-title" style={sv({"--d": ".06s"})}>필요한 것만<br />골라 담았습니다.</h2>
            <p className="lead rv" style={sv({"--d": ".12s"})}>마케팅·자료실·학부모 포털은 넣지 않았습니다. 대신 출석부와 시간표처럼 늘 쓰는 화면을 계속 다듬고 있습니다.</p>
          </div>
          <div className="grid">
            <div className="tile rv" style={sv({"--d": "0s"})}><i className="stk i-layoutGrid"></i><b>대시보드</b><p>지표 7개와 재원·출결·수납 현황, 진행 중 수업, 상담 진행 단계를 한 화면에서 봅니다.</p></div>
            <div className="tile rv" style={sv({"--d": ".05s"})}><i className="stk i-weekGrid"></i><b>시간표</b><p>반과 학생을 드래그로 옮긴 뒤 저장을 눌러 반영합니다. 교시표는 지점 설정을 따릅니다.</p></div>
            <div className="tile rv" style={sv({"--d": ".1s"})}><i className="stk i-clipboardCheck"></i><b>출석부</b><p>한 달을 표 하나에 놓고 스프레드시트처럼 입력합니다. 강사에게는 자기 수업이 있는 날만 보입니다.</p></div>
            <div className="tile rv" style={sv({"--d": ".15s"})}><i className="stk i-book"></i><b>수업목록</b><p>반 이름, 담임, 요일, 과목이 한 표에 나옵니다. 열 제목을 누르면 그 자리에서 필터가 열립니다.</p></div>
            <div className="tile rv" style={sv({"--d": "0s"})}><i className="stk i-users"></i><b>원생목록</b><p>재원·휴원·퇴원 상태와 수강 과목을 관리하고, 엑셀로 내보내거나 가져올 수 있습니다.</p></div>
            <div className="tile rv" style={sv({"--d": ".05s"})}><i className="stk i-messages"></i><b>콜&amp;상담</b><p>상담 전부터 등록 완료까지 4단계 칸반으로 봅니다. 녹음하면 전사와 AI 요약이 따라옵니다.</p></div>
            <div className="tile rv" style={sv({"--d": ".1s"})}><i className="stk i-userCheck"></i><b>원생상담</b><p>재원생 상담 내용과 후속 조치를 적어 둡니다. 기한이 되면 알림으로 알려 줍니다.</p></div>
            <div className="tile rv" style={sv({"--d": ".15s"})}><i className="stk i-userMinus"></i><b>퇴원관리</b><p>한 과목만 그만두는 경우도 처리할 수 있습니다. 퇴원 사유와 시점이 기록으로 남습니다.</p></div>
            <div className="tile rv" style={sv({"--d": "0s"})}><i className="stk i-userSettings"></i><b>직원관리</b><p>이력서, 근무 설정, 계정을 함께 챙깁니다. 권한은 역할별로 정하고 필요하면 개인별로 조정합니다.</p></div>
            <div className="tile rv" style={sv({"--d": ".05s"})}><i className="stk i-wallet"></i><b>수납관리</b><p>청구·수납·회차 확정을 거쳐 강사 정산까지 이어집니다.</p></div>
            <div className="tile rv" style={sv({"--d": ".1s"})}><i className="stk i-note"></i><b>회의록</b><p>회의를 녹음하면 전사한 뒤 안건, 결정 사항, 할 일로 정리됩니다. 발언자를 직원과 연결합니다.</p></div>
            <div className="tile rv" style={sv({"--d": ".15s"})}><i className="stk i-sheetColumns"></i><b>강사 시트</b><p>영어·수학 반마다 계획과 진도, 과제를 기록합니다. 영어는 월간 계획을 가져와 실제 나간 진도와 대조합니다.</p></div>
          </div>
        </div>
      </section>

      <section className="band rv" aria-label="수업 전 교실">
        <div className="ph ph-class" aria-hidden="true"></div>
        <div className="wrap"><p className="kicker" style={sv({"color": "#9ec0ff"})}>수업 시작 10분 전</p><h2 className="h2">먼저 출석부를 엽니다.</h2><p className="lead">오늘 수업이 있는 반만 보이고, 날짜 칸에서 바로 출석을 체크합니다.</p></div>
      </section>
    </>
  );
}
