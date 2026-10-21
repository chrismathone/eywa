"use client";

import { createContext, useContext } from "react";

/**
 * 영상 id → AI 참고 평점(5점 만점) — 장부 칸이 "2.8/5"를 적는 재료(원장 2026-10-21). 칸 컴포넌트의 props가 이미 상한(10개)이라 장부 맨 위에서
 * 한 번 만들어 컨텍스트로 내린다. 비어 있으면(스위치 꺼짐·분석 전) 칸은 평점 줄을 그리지 않는다. 점수·색 규칙은 video-review/score.ts.
 */
export const ReviewPointsContext = createContext<ReadonlyMap<string, number>>(new Map());
export const useReviewPoints = () => useContext(ReviewPointsContext);
