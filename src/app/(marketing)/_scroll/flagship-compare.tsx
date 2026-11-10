"use client";

import { useState, type CSSProperties } from "react";

/**
 * 운영 현황 예시 — 손잡이로 '메뉴마다 따로 확인'과 '대시보드에서 바로'를 견준다. 수치나 성과를 나타내지 않는다.
 * (2026-11 개편: '도입 전후 비교 · 따로 보던 업무. 하나로 보는 운영.'은 도입 전 학원의 일하는 방식을 단정하는 짝 문장이라 걷었다.)
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
        <div className="flag-compare-before">
          <b>메뉴마다 따로 확인</b>
          <div><span>출결 기록</span><span>상담 내역</span><span>수납 현황</span></div>
          <p>출석부, 콜&amp;상담, 수납관리를 차례로 엽니다</p>
        </div>
        <div className="flag-compare-after">
          <b>대시보드에서 바로</b>
          <div><strong>학원 전체 현황</strong><span>재원 · 출결 · 수납 · 상담</span></div>
          <p>첫 화면에서 오늘 숫자를 확인합니다</p>
        </div>
        <div className="flag-compare-handle" aria-hidden="true">↔</div>
        <input type="range" min="3" max="97" value={split} onChange={(event) => setSplit(Number(event.target.value))} aria-label="운영 현황 예시 비교" aria-valuetext={`대시보드 쪽 ${split}%`} aria-describedby="flag-compare-note" />
      </div>
      <p className="flag-compare-note" id="flag-compare-note">화면 이해를 돕는 예시이며, 도입 성과를 나타내지 않습니다.</p>
    </div>
  </section>;
}
