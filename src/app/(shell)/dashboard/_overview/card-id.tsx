"use client";

import { createContext, useContext, type ReactNode } from "react";

// DOM 상자를 추가하지 않고 실제 카드에 편집기의 식별자를 전달한다.
const CardId = createContext<string | undefined>(undefined);
export const useDashboardCardId = () => useContext(CardId);
export function identifyCard(id: string, node: ReactNode): ReactNode {
  return <CardId.Provider value={id}>{node}</CardId.Provider>;
}
