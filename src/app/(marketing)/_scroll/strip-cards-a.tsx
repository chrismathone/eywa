import { sv } from "./style";
import { Ck } from "./check-mark";
import { dupProps } from "./strip-dup";

/** 화면 스트립 카드 앞 4장. `dup`이면 무한 루프용 두 번째 벌(읽기 도구·움직임 줄이기에선 감춘다). */
export function StripCardsA({ dup = false }: { dup?: boolean }) {
  return (
    <>
      <div className="scard" {...dupProps(dup)}>
        <div className="cap"><b>원스크린</b><p>수학 수업보고서 화면입니다. 진도, 과제, 테스트만 적으면 학부모 멘트가 자동 작성되고, 선생님이 고쳐 보낸 글에서 말투를 배웁니다.</p></div>
        <div className="shot"><div className="os">
          <div className="row"><small>학생</small><div className="fld">최도윤 · 중2 수학 A · 9/22(화)</div></div>
          <div className="row"><small>진도</small><div className="fld">이차방정식 — 근의 공식 ②, 유형 12~17</div></div>
          <div className="row"><small>과제</small><div className="fld">쎈 84~89p, 오답 노트 3문제</div></div>
          <div className="row"><small>테스트</small><div className="fld">일일 22문제 중 19개 맞음</div></div>
          <div className="row"><small>멘트</small><div className="fld ta">오늘은 근의 공식 유형 문제를 끝까지 풀었습니다. 중간에 계산 실수가 두 번 나왔는데 스스로 찾아서 고쳤어요. 다음 시간에는 판별식으로 넘어갈 예정입니다.</div></div>
          <div className="ai"><span className="btn ghost">다시 쓰기</span><span className="btn">저장 · 발송</span></div>
        </div></div>
      </div>
      <div className="scard" {...dupProps(dup)}>
        <div className="cap"><b>영어 강사 시트</b><p>반별 주간 계획과 진도, 과제를 적습니다. 월간 계획을 가져와 실제 나간 진도에 맞춰 고칩니다.</p></div>
        <div className="shot"><div className="sheet"><table><tbody>
          <tr><th style={sv({"width": "22%"})}>구분</th><th>9/21 월</th><th>9/23 수</th></tr>
          <tr><td>Vocab</td><td>Word Master 2 · Day 14</td><td>Day 15</td></tr>
          <tr><td>Grammar</td><td>그래머 인사이드 2 · Ch.6 관계대명사</td><td className="ed">Ch.6 복습 + 퀴즈</td></tr>
          <tr><td>Reading</td><td>리딩 튜터 · U7</td><td>U8</td></tr>
          <tr><td>Listening</td><td>듣기 모의 3회</td><td>듣기 모의 4회</td></tr>
          <tr><td>과제</td><td>Day 14 암기 · 워크북 42~45p</td><td>Day 15 암기 · 워크북 46~49p</td></tr>
          <tr><td>특이사항</td><td>박서윤 단어 시험 재응시</td><td>추석 전 마지막 수업</td></tr>
        </tbody></table></div></div>
      </div>
      <div className="scard" {...dupProps(dup)}>
        <div className="cap"><b>학부모 알림장</b><p>수업보고서가 링크로 발송됩니다. 학부모가 언제 열어 봤는지도 남습니다.</p></div>
        <div className="shot"><div className="rcard"><div className="phone">
          <div className="ph-h">최도윤 · 수학 수업보고서<small>2026.09.22 화 · 김선생</small></div>
          <div className="kv"><b>진도</b><span>이차방정식 근의 공식 ②</span><b>과제</b><span>쎈 84~89p, 오답 3문제</span><b>테스트</b><span>22문제 중 19개 맞음</span><b>출결</b><span>출석 · 16:20~18:10</span></div>
          <div className="ment">오늘은 근의 공식 유형 문제를 끝까지 풀었습니다. 중간에 계산 실수가 두 번 나왔는데 스스로 찾아서 고쳤어요. 다음 시간에는 판별식으로 넘어갈 예정입니다.</div>
          <div className="foot"><span>발송 18:24</span><b>학부모 열람 18:31</b></div>
        </div></div></div>
      </div>
      <div className="scard" {...dupProps(dup)}>
        <div className="cap"><b>셔틀 · 오늘 등하원</b><p>정류장별 명단에서 승차를 체크합니다. 미탑승으로 표시해도 수업 출결은 바뀌지 않습니다.</p></div>
        <div className="shot photo ph-shuttle"><div className="ov"><b>1호차 · 하원 18:20 · 3정류장</b><div><span>정하린 · 예시 정류장 A</span><span className="chk"><Ck /></span></div><div><span>한지안 · 예시 정류장 A</span><span className="chk"><Ck /></span></div><div><span>이준서 · 예시 정류장 B</span><span className="chk no"><Ck /></span></div></div></div>
      </div>
    </>
  );
}
