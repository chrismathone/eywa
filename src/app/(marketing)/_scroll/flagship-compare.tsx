"use client";

import { useState, type CSSProperties } from "react";

/**
 * 운영 현황 예시 — 손잡이로 '대시보드에서 바로'(왼쪽 · 라임)와 '메뉴마다 따로'(오른쪽 · 세이지)를 견준다. 수치나 성과를 나타내지 않는다.
 * 2026-11-10 원장 *"화살표가 한쪽으로 몰려있네"* · *"뭔가 멋이없네"* → Codex 협의: 손잡이는 선과 분리해 정중앙(translate -50%) ·
 * 왼쪽 = 대표 숫자 둘 + 작은 추이(최신 대시보드 색) · 오른쪽 = 제목이 읽히는 창 셋이 어긋나 겹친 모양 · 자동 흔들림 같은 장식은 넣지 않는다.
 * (옛 판의 '도입 전후 비교 · 따로 보던 업무. 하나로 보는 운영.'은 도입 전 방식을 단정하는 짝 문장이라 걷었다.)
 */
export function FlagshipCompare() {
  const [split, setSplit] = useState(50);
  const style = { "--flag-split": `${split}%` } as CSSProperties;
  return <section className="flag-compare" id="compare" aria-labelledby="compare-title">
    <div className="flag-compare-copy">
      <p>운영 현황</p><h2 id="compare-title">매일 보는 숫자는<br /><mark className="em-mark">대시보드 첫 화면</mark>에.</h2>
      <p>재원·출결·수납·상담 현황을 메뉴를 오가지 않고 대시보드에서 확인합니다. 손잡이를 움직여 견줘 보세요.</p>
    </div>
    <div>
      <div className="flag-comparison" style={style}>
        {/* 양쪽 내용은 각자 '보이는 면'의 가운데를 따라 움직인다(손잡이를 끝으로 옮겨도 반대쪽에 빈 면이 남지 않게 — Codex 4차) */}
        <div className="flag-compare-before">
          <div className="cmp-pane">
            <b className="cmp-tag">메뉴마다 따로</b>
            <div className="cmp-wins" aria-hidden="true">
              <div className="cmp-win"><i>출석부</i><span /><span /></div>
              <div className="cmp-win"><i>콜&amp;상담</i><span /><span /></div>
              <div className="cmp-win"><i>수납관리</i><span /><span /></div>
            </div>
            <p>출석부, 콜&amp;상담, 수납관리를 차례로 엽니다</p>
          </div>
        </div>
        <div className="flag-compare-after">
          <div className="cmp-pane">
            <b className="cmp-tag">대시보드에서 바로</b>
            <div className="cmp-dash" aria-hidden="true">
              <small>학원 전체 현황</small>
              <div className="cmp-nums"><div><span>재원생</span><b>168<em>명</em></b></div><div><span>이달 수납</span><b>84<em>%</em></b></div></div>
              <div className="cmp-trend"><i /><s /></div>
            </div>
            <p>첫 화면에서 오늘 숫자를 확인합니다</p>
          </div>
        </div>
        <div className="flag-compare-line" aria-hidden="true" />
        <div className="flag-compare-knob" aria-hidden="true" />
        <input type="range" min="8" max="92" value={split} onChange={(event) => setSplit(Number(event.target.value))} aria-label="운영 현황 예시 비교" aria-valuetext={`대시보드 쪽 ${split}%`} aria-describedby="flag-compare-note" />
      </div>
      <p className="flag-compare-note" id="flag-compare-note">화면 이해를 돕는 예시이며, 도입 성과를 나타내지 않습니다. 숫자는 가상입니다.</p>
    </div>
  </section>;
}
