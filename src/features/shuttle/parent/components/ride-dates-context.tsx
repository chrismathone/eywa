"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * 월별 달력에서 **여러 날**을 골라 연 상세(사용자 2026-10-01) — 그 안의 [수정하기]·[타지 않기]·[결석]이
 * 고른 날짜 전부에 같은 내용을 적용하도록 날짜 묶음을 내려준다. 감싸지 않은 곳(요일별 화면)은 undefined = 그날 하루.
 */
const RideDatesContext = createContext<string[] | undefined>(undefined);

export function RideDatesProvider({ dates, children }: { dates: string[]; children: ReactNode }) {
  return <RideDatesContext.Provider value={dates.length > 1 ? dates : undefined}>{children}</RideDatesContext.Provider>;
}

export const useRideDates = () => useContext(RideDatesContext);
