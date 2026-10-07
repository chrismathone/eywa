"use client";
import { useCallback } from "react";
import { useSheetLang } from "./lang-context";
import { timetableText } from "./timetable-labels";

export function useTimetableText() {
  const lang = useSheetLang();
  return useCallback((text: string) => timetableText(lang, text), [lang]);
}
