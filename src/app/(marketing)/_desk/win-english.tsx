"use client";

import { DATES, HOLIDAYS } from "./data";
import { FootNote, Pill, useDesk } from "./bits";

/** 2F 영어 교실 — 원스크린(멘트 자동작성 → 알림장 발송)·영어 강사 시트. */
export function OsWin() {
  const { data, act } = useDesk();
  const { text, typing, sent } = data.os;
  const [tone, label] = sent ? ["p-green", "발송 완료 · 16:41"] : text && !typing ? ["p-neutral", "발송 전"] : ["p-blue", "작성 중"];
  return (
    <>
      <div className="os-tabs"><span className="on">정하린</span><span className="ok">노은채</span></div>
      <dl style={{ margin: 0 }}>
        <div className="fld"><dt>진도</dt><dd>Unit 5 본문 · 42–45p</dd></div>
        <div className="fld"><dt>과제</dt><dd>워크북 20p</dd></div>
        <div className="fld"><dt>테스트</dt><dd>단어 테스트 <b>20문제 중 18개 맞음</b></dd></div>
        <div className="fld"><dt>태도</dt><dd><Pill tone="p-green">집중 좋음</Pill></dd></div>
      </dl>
      <div className="ment">
        <div className="mh">
          <span>선생님 멘트</span>
          <button type="button" className="sbtn navy" disabled={typing} onClick={act.osGenerate}>{text ? "다시 쓰기" : "AI 자동작성"}</button>
        </div>
        <p className={text ? "" : "muted"} aria-live="polite">
          {text || "버튼을 누르면 위 칸의 내용으로 멘트를 씁니다. 적은 칸의 사실만 씁니다."}
          {typing ? <span className="caret" /> : null}
        </p>
      </div>
      <div className="send-row">
        <Pill tone={tone}>{label}</Pill>
        <button type="button" className="sbtn" disabled={!text || typing || sent} onClick={act.osSend}>알림장 발송</button>
      </div>
      <FootNote left="강사별 말투로 초안을 씁니다" right={`보고서 ${sent ? 2 : 1}/2`} />
    </>
  );
}

export function SheetWin() {
  return (
    <>
      <div className="goal"><Pill tone="p-navy">9월 목표</Pill><span>문법 3권 · Unit 4–6</span><Pill tone="p-blue">작성 2/2</Pill></div>
      <div style={{ overflowX: "auto" }}>
        <table className="sheet">
          <thead><tr><th style={{ width: 58 }}>교시</th><th>월 {DATES[0]}</th><th>수 {DATES[2]}</th><th className="hol">금 {DATES[4]} {HOLIDAYS[4]}</th></tr></thead>
          <tbody>
            <tr>
              <td className="per">18:10<br />~20:00</td>
              <td><span className="ln"><b>문법 3권</b></span><span className="ln">Unit 4 · 12–15p</span><span className="ln"><small>단어 Day 14 · 과제 WB 8p</small></span></td>
              <td className="off"><span className="ln"><b>독해 2권</b> <Pill tone="p-amber">목표 밖</Pill></span><span className="ln">Ch.3</span><span className="ln"><small>단어 Day 15</small></span></td>
              <td className="hol">휴</td>
            </tr>
          </tbody>
        </table>
      </div>
      <FootNote left="목표와 다른 교재는 칸에 표시합니다" right="휴일은 작성률에서 빠집니다" />
    </>
  );
}
