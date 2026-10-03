"use client";

import { createContext, useContext, useRef, useState } from "react";
import { toast } from "sonner";
import { DEFAULT_DISPLAY_OPTIONS, type DisplayOptions } from "../display-options";
import { saveDisplayOptions } from "../server/display-options-actions";
import { useSheetT } from "@/features/teacher-view/lang-context";

const Context = createContext<{ options: DisplayOptions; change: (patch: Partial<DisplayOptions>) => void; readonly: boolean }>({ options: DEFAULT_DISPLAY_OPTIONS, change: () => {}, readonly: false });
export const useDisplayOptions = () => useContext(Context);

export const DisplayOptionsProvider = Context;

export function useDisplayOptionsState(initial: DisplayOptions = DEFAULT_DISPLAY_OPTIONS, readonly = false) {
  const [options, setOptions] = useState(initial);
  const latest = useRef(initial);
  const saving = useRef(Promise.resolve());
  const t = useSheetT();
  function change(patch: Partial<DisplayOptions>) {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setOptions(next);
    if (readonly) return;
    // 빠른 연속 변경도 저장 순서를 유지한다. 먼저 보낸 설정이 마지막 설정을 덮지 않게.
    saving.current = saving.current.then(async () => {
      try {
        const result = await saveDisplayOptions(next);
        if (!result.ok) toast.error(t("os.display.saveFail"));
      } catch { toast.error(t("os.display.saveFail")); }
    });
  }
  return { options, change, readonly };
}
