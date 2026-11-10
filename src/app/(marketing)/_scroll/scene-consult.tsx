import { Fragment } from "react";
import { sv } from "./style";

/** 선언문 — `KEY`는 한 덩어리 낱말로 밑줄 강조(낱말 사이 빈칸은 span 밖에 둬 밑줄이 빈칸까지 늘지 않게). */
const BEFORE = "원장과 강사가 하루에도 수십 번 여는 화면이라, 에이와는";
const KEY = "반응 속도를";
const AFTER = "먼저 맞췄습니다. 시간이 걸리는 작업은 뒤에서 처리하고, 지금 봐야 할 화면부터 먼저 띄웁니다.";
const WORDS: [string, boolean][] = [...BEFORE.split(" ").map((w): [string, boolean] => [w, false]), [KEY, true], ...AFTER.split(" ").map((w): [string, boolean] => [w, false])];

/**
 * 선언문(스크롤하면 낱말이 차례로 진해진다) + 고정 장면 B(콜&상담 녹음 → AI 정리, 어두운 면).
 * ⚠️ 처음 시안의 '아침 7시 브리핑' 장면은 뺐다 — 운영실이 2026-09-11 '학원 전체 현황'으로 바뀌며 브리핑 카드가 화면에서
 *    빠졌고 브리핑 알림도 생성이 멈췄다(없는 기능을 소개하면 안 된다). 카드 항목은 실제 상담 분석 항목(요약·요청·주의 신호·
 *    자동 입력·후속 조치, `consultation-analysis.ts`)에서 골랐다.
 */
export function SceneConsult() {
  return (
    <>
      <section className="pin state" data-scene="words" data-steps="2" style={sv({"--steps": "2"})} aria-label="반응 속도 원칙">
        <div className="stage">
          <p className="words" id="words">{WORDS.map(([w, key], i) => <Fragment key={i}><span className={key ? "em-rule" : undefined}>{w}</span>{" "}</Fragment>)}</p>
        </div>
      </section>
      <section className="pin dark" id="scene-consult" data-scene="consult" data-steps="4" style={sv({"--steps": "4"})} aria-labelledby="consult-title">
        <div className="ph ph-office" aria-hidden="true"></div>
        <div className="stage">
          <div className="wrap two half">
            <div className="caps light">
              <p className="kicker">상담 녹음은 AI가 정리</p>
              <h2 className="h2" id="consult-title">상담이 끝나면<br /><span className="em-rule">요약과 주의할 점</span>이 남습니다.</h2>
              <p className="demo-caption">상담 내용과 인물은 가상 예시입니다.</p>
              <ol className="steps">
                <li data-i="0"><b>녹음하면 글로</b><span>상담을 녹음하면 대화 내용이 글로 옮겨집니다.</span></li>
                <li data-i="1"><b>요약과 주의 신호</b><span>요약, 학부모 요청, 주의해서 볼 점이 항목별로 정리됩니다.</span></li>
                <li data-i="2"><b>상담 카드 자동 입력</b><span>학교·학년·학부모 연락처처럼 비어 있는 칸만 녹음에 나온 값으로 채웁니다. 직접 적은 값은 그대로 둡니다.</span></li>
                <li data-i="3"><b>필요할 때만 분석</b><span>AI 재분석은 버튼을 눌렀을 때만 실행됩니다. 페이지를 열면 마지막 결과가 그대로 보입니다.</span></li>
              </ol>
              <div className="dots" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
            </div>
            <div className="canvas">
              <div className="ai-card" id="consult">
                <div className="bh"><i className="stk i-messages"></i>콜&amp;상담 · 상담 분석<time dateTime="2026-09-22T17:40">9/22 17:40 · 녹음 12분</time></div>
                <div className="ln" data-i="0"><span className="tag n">전사</span><div>12분 대화가 글로 저장됐습니다. 상담사와 학부모 발화가 나뉘어 있습니다.</div></div>
                <div className="ln" data-i="1"><span className="tag b">요약</span><div>최도윤(초5)은 수학 선행을 원해 상담을 왔고, <b>9/28(월)</b>에 입테를 보기로 했습니다.</div></div>
                <div className="ln" data-i="1"><span className="tag p">요청</span><div>평일 저녁, 주 2회 수업을 원합니다.<span className="warn">주의 · 학원을 옮긴 이유는 아직 듣지 못했습니다.</span></div></div>
                <div className="ln" data-i="2"><span className="tag g">자동 입력</span><div>학교 · 학년 · 학부모 연락처 <b>3칸</b>을 채웠습니다. 등록 여부는 상담 담당이 정합니다.</div></div>
                <div className="ln" data-i="3"><span className="tag a">후속 조치</span><div>입테 결과가 나오면 상담 담당이 학부모에게 연락합니다.</div></div>
                <div className="bf"><span>분석 17:42</span><span className="btn">다시 분석</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
