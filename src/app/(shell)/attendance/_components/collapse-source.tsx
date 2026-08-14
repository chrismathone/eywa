"use client";

import { createContext, useContext, type ReactNode } from "react";

/** 반 접기 API — GridProvider(출석부 입력)와 자리 월간이 같은 ClassGroupBody를 쓰게 한다. */
export type CollapseSource = {
  collapsed: ReadonlySet<string>;
  toggleCollapsed: (classId: string) => void;
  setAllCollapsed: (collapse: boolean) => void;
};

const Ctx = createContext<CollapseSource | null>(null);

export function CollapseSourceProvider({ value, children }: { value: CollapseSource; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOptionalCollapse(): CollapseSource | null {
  return useContext(Ctx);
}
