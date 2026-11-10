import { Ck } from "./check-mark";
import { sv } from "./style";
import { dupProps } from "./strip-dup";

/**
 * 화면 스트립 카드 셋째 벌(2026-11 새로 들어온 기능) — 내 할 일 · 숙제 영상 · 통계 · 퇴원보고서 · 연결 탐색.
 * 문구는 실제 동작 그대로(docs/decisions/*.md): 할 일은 원래 기록의 사실로 닫힌다 · 숙제 영상은 주소 하나(`/v`)에서
 * 휴대폰 뒷 4자리 + 이름 · 통계는 대시보드 카드 '상세' · 퇴원은 담임의 퇴원보고서 → 관리자 승인 → 환불 처리 뒤 한 번에.
 * 그림은 인라인 SVG 없이 CSS로만 그린다(아이콘 가드). `dup`이면 무한 루프용 두 번째 벌.
 */
export function StripCardsC({ dup = false }: { dup?: boolean }) {
  return (
    <>
      <div className="scard" {...dupProps(dup)}>
        <div className="cap"><b>내 할 일</b><p>발송 실패, 상담 후속 조치, 결재 차례처럼 손이 필요한 일이 알림 벨의 &lsquo;내 할 일&rsquo;에 모입니다. 처리하면 기록을 보고 저절로 닫힙니다.</p></div>
        <div className="shot"><div className="todo">
          <div className="todo-h"><b>내 할 일</b><span>열린 일 3</span></div>
          <div className="ti"><em className="r">발송 실패</em><span>최도윤 수학 보고서</span><small>오늘</small></div>
          <div className="ti"><em className="a">후속 조치</em><span>오예준 다음 상담</span><small>내일</small></div>
          <div className="ti"><em className="p">결재</em><span>휴가 신청서 · 내 차례</span><small>9/23</small></div>
          <div className="ti done"><em className="g">결석 확인</em><span>이준서 결석 연락</span><small><Ck /> 처리됨</small></div>
        </div></div>
      </div>
      <div className="scard" {...dupProps(dup)}>
        <div className="cap"><b>숙제 영상 제출</b><p>학생은 주소 하나에서 휴대폰 뒷 네 자리와 이름을 넣고, 선생님이 낸 영상 숙제를 골라 올립니다. 영상은 그 숙제 칸에 바로 붙습니다.</p></div>
        <div className="shot"><div className="rcard"><div className="phone vid">
          <div className="ph-h">숙제 영상 올리기<small>최도윤 · 휴대폰 뒷자리 확인됨</small></div>
          <div className="vid-pick on"><b>중2 수학 A · 9/22 숙제</b><small>마감 9/29 · 근의 공식 풀이 설명</small></div>
          <div className="vid-pick"><b>중2 수학 A · 9/18 숙제</b><small>제출 완료 · 영상 1개</small></div>
          <span className="vid-btn">영상 고르기</span>
        </div></div></div>
      </div>
      <div className="scard" {...dupProps(dup)}>
        <div className="cap"><b>통계</b><p>원생·출결·수납·상담·보고서 메뉴마다 통계 화면이 있어, 달마다 이어진 추이를 한눈에 봅니다.</p></div>
        <div className="shot"><div className="stat">
          <div className="stat-h"><b>재원생 추이</b><span>최근 6개월</span></div>
          <div className="stat-k"><div><small>재원생</small><b>168</b></div><div><small>등원율</small><b>94%</b></div><div><small>신규</small><b>8</b></div></div>
          <div className="stat-bars" aria-hidden="true">
            {[".62", ".66", ".7", ".68", ".78", ".84"].map((v, i) => <span key={i} style={sv({"--v": v})} className={i === 5 ? "now" : undefined}></span>)}
          </div>
          <div className="stat-x"><i>4월</i><i>5월</i><i>6월</i><i>7월</i><i>8월</i><i>9월</i></div>
        </div></div>
      </div>
      <div className="scard" {...dupProps(dup)}>
        <div className="cap"><b>퇴원보고서</b><p>퇴원은 담임 선생님의 퇴원보고서로 시작합니다. 관리자 승인과, 환불을 요청했다면 환불 처리까지 끝나야 퇴원과 수강 종료가 한 번에 처리됩니다.</p></div>
        <div className="shot"><div className="wdr">
          <div className="wdr-h"><b>박서윤 · 중2 수학 A</b><span>퇴원 사유 · 이사</span></div>
          <div className="wdr-steps"><div className="on"><b>보고서 작성</b><small>담임 · 9/20</small></div><div className="on"><b>관리자 승인</b><small>9/21</small></div><div className="now"><b>환불 처리</b><small>데스크 · 대기</small></div></div>
          <div className="wdr-b"><span>마지막 수업일</span><b>9/25(금)</b><span>환불 요청</span><b>있음</b></div>
          <p className="wdr-n">세 단계가 끝나면 퇴원·수강 종료가 같이 기록됩니다.</p>
        </div></div>
      </div>
      <div className="scard" {...dupProps(dup)}>
        <div className="cap"><b>연결 탐색</b><p>원생·수업·강사·강의실 하나를 가운데 두고 이어진 수업·출결·상담 기록을 둘러봅니다. 원생은 AI 흐름 분석으로 최근 변화도 함께 봅니다.</p></div>
        <div className="shot"><div className="exp">
          <div className="exp-ring" aria-hidden="true"><div><b>최도윤</b><small>중2 · 재원</small></div></div>
          <ul className="exp-l"><li><i className="c1"></i>수업 2</li><li><i className="c2"></i>출결 46</li><li><i className="c3"></i>상담 5</li><li><i className="c4"></i>보고서 38</li></ul>
        </div></div>
      </div>
    </>
  );
}
