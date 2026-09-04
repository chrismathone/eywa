"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { StudentSearchToggle } from "@/features/attendance/components/student-search-box";

/**
 * 도움말 검색 상태 — 머리(PageHeader `actions`)의 토글과 본문(HelpBrowser)의 필터가 **한 값**을 본다.
 * 서버가 그리는 PageHeader 안에 클라 토글을 꽂아야 해서 상태를 provider로 올렸다(page.tsx가 둘을 감싼다).
 * 검색은 눌러야 나온다(지시서 §10) — 옛 사진 히어로 안 상시 알약 입력창을 대체. 입력 안 글자 16px(앱 검색 규약).
 */
const HelpQueryContext = createContext<{ query: string; setQuery: (v: string) => void } | null>(null);

export function HelpSearchProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("");
  return <HelpQueryContext.Provider value={{ query, setQuery }}>{children}</HelpQueryContext.Provider>;
}

export function useHelpQuery(): string {
  return useContext(HelpQueryContext)?.query ?? "";
}

export function HelpSearchToggle() {
  const ctx = useContext(HelpQueryContext);
  if (!ctx) return null;
  return (
    <StudentSearchToggle
      value={ctx.query}
      onChange={ctx.setQuery}
      placeholder="출석, 학생 등록, 엑셀 가져오기"
      inputWidth="w-56"
      ariaLabel="도움말 검색"
    />
  );
}
