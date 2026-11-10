import { Ck } from "./check-mark";
import { dupProps } from "./strip-dup";

/** 화면 스트립 카드 뒤 4장. `dup`이면 무한 루프용 두 번째 벌(읽기 도구·움직임 줄이기에선 감춘다). */
export function StripCardsB({ dup = false }: { dup?: boolean }) {
  return (
    <>
      <div className="scard" {...dupProps(dup)}>
        <div className="cap"><b>캘린더</b><p>학원 일정과 입테, 휴원일을 달력 하나에서 봅니다.</p></div>
        <div className="shot"><div className="cal">
          <div className="cal-h"><b>2026년 9월</b><span>월 보기</span></div>
          <div className="cal-g"><i>월</i><i>화</i><i>수</i><i>목</i><i>금</i><i>토</i><i>일</i>
            <s></s><b>1</b><b>2</b><b>3</b><b>4</b><b>5</b><b className="su">6</b>
            <b>7<em className="b">입테 16:20</em></b><b>8</b><b>9</b><b>10</b><b>11</b><b>12</b><b className="su">13</b>
            <b>14</b><b>15</b><b>16</b><b>17<em className="p">학부모 설명회</em></b><b>18</b><b>19</b><b className="su">20</b>
            <b>21</b><b className="td">22<em className="b">입테 16:20</em></b><b>23</b><b className="ho">24<em className="r">추석 휴원</em></b><b className="ho">25<em className="r">추석 휴원</em></b><b className="ho">26<em className="r">추석 휴원</em></b><b className="su">27</b>
            <b>28<em className="g">보강 4</em></b><b>29<em className="g">보강 2</em></b><b>30</b><s></s><s></s><s></s><s></s>
          </div>
        </div></div>
      </div>
      <div className="scard" {...dupProps(dup)}>
        <div className="cap"><b>신규생 관리</b><p>등록 후 7·30·60·90일마다 챙길 항목을 체크리스트로 확인합니다.</p></div>
        <div className="shot"><div className="chk-list">
          <div className="chk-h"><b>한지안 · 초3 · 9/7 등록</b><span>완료 4/6 · 지연 1</span></div>
          <div className="ci on"><i><Ck /></i><span>사전 콜</span><small>9/5 · 데스크</small></div>
          <div className="ci on"><i><Ck /></i><span>첫 수업 교재·교실 안내</span><small>9/7</small></div>
          <div className="ci on"><i><Ck /></i><span>첫 수업 후 상담 콜</span><small>9/8 · 김선생</small></div>
          <div className="ci late"><i>!</i><span>7일 학습 태도 확인</span><small>기한 9/14 · 지연</small></div>
          <div className="ci on"><i><Ck /></i><span>1개월 상담 콜 예약</span><small>10/6 잡힘</small></div>
          <div className="ci"><i></i><span>3개월 만족도 콜</span><small>12/6</small></div>
        </div></div>
      </div>
      <div className="scard" {...dupProps(dup)}>
        <div className="cap"><b>전자결재</b><p>휴가, 품의, 지출 문서를 기안하면 정해진 결재선을 따라 순서대로 결재됩니다.</p></div>
        <div className="shot"><div className="apr">
          <div className="apr-h"><b>휴가 신청서 · 2026-0917</b><span className="pill b">결재 진행</span></div>
          <div className="apr-body"><div><small>기안</small><span>이선생 · 9/21</span></div><div><small>기간</small><span>10/5(월) ~ 10/6(화) · 2일</span></div><div><small>잔여 연차</small><span>11일 → 9일</span></div><div><small>사유</small><span>가족 행사</span></div></div>
          <div className="apr-line"><div className="on"><b>기안</b><span>이선생</span><em>9/21 14:02</em></div><div className="on"><b>검토</b><span>데스크 실장</span><em>9/21 16:40</em></div><div className="now"><b>결재</b><span>원장</span><em>대기</em></div></div>
        </div></div>
      </div>
      <div className="scard" {...dupProps(dup)}>
        <div className="cap"><b>성적관리</b><p>학교 시험 성적을 반·과목별 표에 바로 입력하고, 성적표 받기를 체크합니다.</p></div>
        <div className="shot"><div className="grd">
          <div className="grd-h"><b>2026 · 2학기 · 수학 · 중2 수학 A</b><span>중간고사</span></div>
          <table><tbody><tr><th>이름</th><th>학교</th><th>점수</th><th>1차</th><th>2차</th><th>성적확인</th></tr>
            <tr><td>김하늘</td><td>예시중 A</td><td className="sc">92</td><td><Ck /></td><td></td><td><Ck /></td></tr>
            <tr><td>이준서</td><td>예시중 B</td><td className="sc">85</td><td><Ck /></td><td><Ck /></td><td></td></tr>
            <tr><td>박서윤</td><td>예시중 A</td><td className="sc ed">—</td><td><Ck /></td><td></td><td></td></tr>
            <tr><td>최도윤</td><td>예시중 B</td><td className="sc">78</td><td><Ck /></td><td><Ck /></td><td><Ck /></td></tr>
            <tr><td>정하린</td><td>예시중 A</td><td className="sc">96</td><td><Ck /></td><td></td><td><Ck /></td></tr>
            <tr><td>한지안</td><td>예시중 B</td><td className="sc">88</td><td></td><td></td><td></td></tr>
          </tbody></table>
        </div></div>
      </div>
    </>
  );
}
