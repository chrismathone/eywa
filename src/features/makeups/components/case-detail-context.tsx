"use client";

import { createContext, useContext } from "react";

/** Commands inside the case detail view reload the case data instead of re-rendering the page (see CommandForm). */
export type CaseDetailReload = { reload: () => Promise<boolean>; version?: number };

export const CaseDetailReloadContext = createContext<CaseDetailReload | null>(null);

export function useCaseDetailReload(): CaseDetailReload | null {
  return useContext(CaseDetailReloadContext);
}
