"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { MenuKey } from "@/lib/permissions";
import { writeLockedPlaceholder } from "@/lib/write-lock";

/**
 * 설정 면의 **쓰기 잠금** — 읽기 권한인 사람에게 추가·삭제 단추를 그리지 않고, 빈 칸의 placeholder를 권한 안내로 바꾼다
 * (원장 2026-11-05 — 공통 규칙은 `src/lib/write-lock.ts`). 잠금 여부는 서버가 저장 액션과 같은 판정으로 정해
 * `SectionForm readOnly`로 내려보내고, 폼이 이 문맥을 세운다. 목록 편집기·설정 칸 부품은 prop 배선 없이 여기서 읽는다.
 * ⚠️ 기본값은 '잠기지 않음' — 문맥 밖(다른 화면)에서 같은 부품을 써도 종전과 같다.
 */
type WriteLock = { locked: boolean; menu?: MenuKey };

const WriteLockContext = createContext<WriteLock>({ locked: false });

export function WriteLockProvider({ locked, menu, children }: WriteLock & { children: ReactNode }) {
  return <WriteLockContext.Provider value={{ locked, menu }}>{children}</WriteLockContext.Provider>;
}

export function useWriteLock(): WriteLock {
  return useContext(WriteLockContext);
}

/** 잠겼으면 권한 안내, 아니면 원래 placeholder를 돌려주는 함수 — 한 부품에 칸이 여럿이어도 한 번만 부른다. */
export function useLockedPlaceholder(): (placeholder?: string) => string | undefined {
  const { locked, menu } = useWriteLock();
  return (placeholder) => (locked ? writeLockedPlaceholder(menu) : placeholder);
}
