"use client";

/**
 * **강사 이름 표(표시 이름 → 영어 이름)** 를 클라 컴포넌트에 흘리는 provider.
 *
 * 왜 context인가: 이 이름은 시간표 칸·시트 머리·오늘 카드 등 **깊은 곳 여러 자리**에 나오는데,
 * 그때마다 부모가 prop을 내려보내면 한 곳만 빠져도 그 자리만 한국어로 남는다(과목 맵을
 * [`OperationsProvider`](@/features/owner/operations-context)로 흘리는 것과 같은 이유).
 *
 * 🔴 provider는 **셸 레이아웃 한 곳**에만 단다(언어 provider와 같은 자리) — 화면마다 새로 달지 말 것.
 * ⚠️ provider가 없으면 **빈 표**다 = 한국어 이름 그대로(관리자 풀셸이 그렇다). 안전한 기본값이다.
 */
import { createContext, useContext, type ReactNode } from "react";
import type { TeacherEnglishNames } from "./teacher-name";

const Ctx = createContext<TeacherEnglishNames>({});

export function TeacherNamesProvider({
  names,
  children,
}: {
  names: TeacherEnglishNames;
  children: ReactNode;
}) {
  return <Ctx.Provider value={names}>{children}</Ctx.Provider>;
}

/** 표시 이름 → 영어 이름. 없으면 빈 표(호출부가 한국어 이름을 그대로 쓴다). */
export function useTeacherNames(): TeacherEnglishNames {
  return useContext(Ctx);
}
