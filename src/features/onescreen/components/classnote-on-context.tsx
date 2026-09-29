"use client";

import { createContext, useContext } from "react";

/**
 * 이 학원에 ClassNote 기능(모듈)이 켜져 있나 — 원스크린 안쪽 부품(보고서 카드·표 행·표 툴바)이 prop 배선 없이 읽는다.
 * 꺼진 학원엔 'ClassNote 발송' 버튼·발송 상태·읽음 표시가 아예 없다(원장 2026-09-30 "꺼지면 있었는지조차 모르게").
 * 기본값 true = 공급자 밖(다른 화면이 부품을 빌려 쓸 때)은 종전 그대로.
 */
const ClassnoteOnContext = createContext(true);

export const ClassnoteOnProvider = ClassnoteOnContext.Provider;

export function useClassnoteOn(): boolean {
  return useContext(ClassnoteOnContext);
}
