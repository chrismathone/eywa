"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type Change = { source: string | null; value: string | null };
type EditorContext = {
  enabled: boolean;
  changes: Record<string, Change>;
  saved: (id: string, source: string | null, value: string | null) => void;
};
const Context = createContext<EditorContext>({
  enabled: false,
  changes: {} as Record<string, Change>,
  saved: () => {},
});

export function EnglishNameProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [changes, setChanges] = useState<Record<string, Change>>({});
  function saved(id: string, source: string | null, value: string | null) {
    setChanges((previous) => ({ ...previous, [id]: { source, value } }));
  }
  return <Context.Provider value={{ enabled, changes, saved }}>{children}</Context.Provider>;
}

export function useStudentEnglishName(id: string, source: string | null) {
  const context = useContext(Context);
  const change = context.changes[id];
  return {
    enabled: context.enabled,
    value: change && (source === change.source || source === change.value) ? change.value : source,
    saved: (value: string | null) => context.saved(id, source, value),
  };
}
