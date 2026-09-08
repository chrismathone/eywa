"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import {
  buildClassMoveLookup,
  type ClassMoveIndex,
  type ClassMoveLookup,
} from "@/features/timetable/lib/class-move";

/**
 * 반 블록 이동 판정 재료(서버가 접어 준 색인) — 격자 칸이 "여기로 갈 수 있나"를 물을 때 읽는다.
 *
 * 🔴 재료는 **서버에서 한 번** 접는다(`buildClassMoveIndex`) — 칸마다·집을 때마다 서버에 물으면 왕복이 폭발한다(B4).
 * ⚠️ 색인이 없으면(권한 없음·기본뷰 아님) 반 드래그 자체가 없다 — 이 컨텍스트가 null이면 칸은 드롭존을 안 만든다.
 */
const Ctx = createContext<ClassMoveLookup | null>(null);

export function ClassMoveProvider({
  index,
  children,
}: {
  index: ClassMoveIndex | null;
  children: ReactNode;
}) {
  // 요일별로 나눈 조회용 색인 — 칸마다 전 슬롯을 훑지 않게 **한 번만** 만든다(class-move.ts `buildClassMoveLookup`).
  const lookup = useMemo(() => (index ? buildClassMoveLookup(index) : null), [index]);
  return <Ctx.Provider value={lookup}>{children}</Ctx.Provider>;
}

export function useClassMoveIndex(): ClassMoveLookup | null {
  return useContext(Ctx);
}
