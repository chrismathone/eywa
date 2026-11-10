import { ScenePlayer } from "./scene-player";
import { sv } from "./style";

/**
 * 자동 재생 장면 D(`data-play` · `ScenePlayer` — 원장 11-10 *"알아서 천천히 재생되는게 낫겠어 스크롤보다"*) — 학원 비서(원장이 말로 물으면 그 학원 기록을 찾아 보고서 + 비서 의견으로 답한다, 2026-11-06~).
 * 단계 = 실제 기능 순서(docs/features/academy-assistant.md): 묻기 → 기록 조회·보고서(표·차트) → 비서 의견(할 일·근거·언제·누가)
 * → 처리한 의견은 며칠 뒤 같은 지표를 다시 잰다(재측정 크론). 원장 계정 · AI 사용을 켠 학원에서만 열린다 — 문구에 그대로 적는다.
 * 스크롤 연출은 `LandingMotion`의 공용 `.pin`/`.ln` 규칙을 그대로 쓴다(새 스크립트 없음). 화면 속 숫자는 모두 예시다.
 */
export function SceneAssistant() {
  return (
    <section className="pin asst-scene" id="assistant" data-scene="assistant" data-steps="4" data-play="" aria-labelledby="asst-title">
      <div className="stage">
        <div className="wrap two rev">
          <div className="caps">
            <p className="kicker">원장 전용 학원 비서</p>
            <h2 className="h2" id="asst-title">원장이 물으면<br />비서가 <span className="em-rule">기록부터</span> 찾습니다.</h2>
            <p className="demo-caption">원장 계정에서, AI 사용을 켠 학원에서 씁니다. 질문과 숫자는 가상 예시입니다.</p>
            <ol className="steps">
              <li data-i="0"><b>질문하기</b><span>궁금한 것을 평소 쓰는 말로 적어 묻습니다. 어느 화면에서나 바로 열 수 있습니다.</span></li>
              <li data-i="1"><b>기록을 찾아 보고서로</b><span>출결·수업·상담·수납 기록을 직접 찾아 표와 차트로 정리합니다. 확인하지 못한 것은 못 했다고 밝힙니다.</span></li>
              <li data-i="2"><b>비서 의견</b><span>보고서마다 무엇을, 누가, 언제 하면 좋을지 근거와 함께 의견이 붙습니다.</span></li>
              <li data-i="3"><b>다시 재 보기</b><span>확인할 지표가 있는 의견은 처리해 두면 정해진 날 다시 재서 달라졌는지 보여 줍니다.</span></li>
            </ol>
            <div className="play-ctl"><div className="dots" aria-hidden="true"><i></i><i></i><i></i><i></i></div><ScenePlayer target="assistant" /></div>
          </div>
          <div className="canvas">
            <div className="asst" role="img" aria-label="학원 비서에게 묻고 보고서와 의견을 받는 화면 예시">
              <div className="asst-h"><b>학원 비서</b><em>원장 전용</em><span>AI 사용 학원 · 예시 화면</span></div>
              <p className="asst-q">9월에 결석이 늘어난 반이 있나요? 이유도 같이 봐 주세요.</p>
              <div className="ln" data-i="0"><span className="asst-tag">조회</span><div>출결 · 시간표 · 상담 기록을 차례로 확인했습니다.</div></div>
              <div className="ln" data-i="1"><span className="asst-tag">보고서</span><div>
                <div className="asst-bars" aria-hidden="true">
                  <div><span style={sv({"--v": ".33"})}>2</span><span className="up" style={sv({"--v": "1"})}>6</span><em>중2 수학 A</em></div>
                  <div><span style={sv({"--v": ".5"})}>3</span><span style={sv({"--v": ".5"})}>3</span><em>다른 반 평균</em></div>
                  <p><i></i>8월 <i className="up"></i>9월 결석</p>
                </div>
                <p><b>중2 수학 A</b> 결석이 2회에서 6회로 늘었고, 그중 4회가 금요일입니다. 다른 반은 비슷합니다.</p>
              </div></div>
              <div className="ln" data-i="2"><span className="asst-tag op">의견</span><div><b>이번 주 안에 담임 선생님이</b> 금요일에 빠진 학생 3명의 학부모와 상담해 보세요.<small>근거 · 9월 출결, 최근 상담 기록</small></div></div>
              <div className="ln" data-i="3"><span className="asst-tag">결과</span><div>처리한 의견은 정해진 날 같은 지표를 다시 잽니다.<small>다시 잰 값 · 금요일 결석 4회 → 1회(예시)</small></div></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
