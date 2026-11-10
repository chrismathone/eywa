"use client";

import { useState } from "react";

/**
 * 화면 스트립 흐름 멈춤 — 마우스를 올리면 멈추는 것(CSS)만으로는 터치·키보드 사용자가 멈출 길이 없다.
 * `#marq`에 `paused` 클래스만 붙였다 뗀다(흐름 자체는 CSS 애니메이션). 움직임 줄이기·JS 전에는 CSS가 단추를 감춘다.
 * 글자는 고정하고 상태는 `aria-pressed`로만 — 글자까지 바꾸면 화면낭독기가 상태를 두 번 읽는다.
 */
export function StripToggle() {
  const [paused, setPaused] = useState(false);
  const toggle = () => {
    const next = !paused;
    document.getElementById("marq")?.classList.toggle("paused", next);
    setPaused(next);
  };
  return (
    <button type="button" className="strip-toggle" aria-controls="marq" aria-pressed={paused} onClick={toggle}>
      흐름 멈춤
    </button>
  );
}
