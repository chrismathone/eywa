"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * 좌석표가 **지금 고칠 수 있는 화면인가** — 보드 단위 사실 하나를 칸까지 내린다.
 *
 * 🔴 이 값은 `getLiveBoard`가 이미 계산해 둔 `board.canEdit`이다(역할 full · 또는 강사(scoped)이면서
 *    7일 편집창 안). 상단 띠(`today-strip.tsx`)는 그걸 읽어 스스로를 감추는데, **좌석표 칸만 안 읽고
 *    있었다** — 그래서 읽기 전용 역할·8일 전 날짜·'다른 강사 뷰'에서도 알약이 눌리는 것처럼 보이고,
 *    서버만 조용히 거절했다([[#103]] 계열: 눌렀는데 아무 일도 안 나는 것처럼 보이는 고장).
 *
 * 🔑 게이트가 아니라 **어포던스**다 — 진짜 차단은 서버(`setAttendanceCell` 역할·편집창 재검사)가 한다
 *    ([[#77]] 화면 조건은 게이트가 아니다). 여기서 하는 일은 "서버가 거절할 버튼을 내밀지 않는 것"뿐.
 *
 * 프롭 4단(차트→띠→방→칸)을 타지 않고 컨텍스트로 내리는 이유는 값이 **보드당 하나**여서다.
 * 기본값은 종전 동작(`true`)이라 Provider를 안 감싼 곳이 있어도 화면이 잠기지 않는다.
 */
const SeatingEditCtx = createContext(true);

export function SeatingEditProvider({
  canEdit,
  children,
}: {
  canEdit: boolean;
  children: ReactNode;
}) {
  return <SeatingEditCtx.Provider value={canEdit}>{children}</SeatingEditCtx.Provider>;
}

export function useSeatingCanEdit(): boolean {
  return useContext(SeatingEditCtx);
}
