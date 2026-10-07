"use client";
import { useTimetableDisplay } from "./use-timetable-display";
import { useTimetableText } from "./use-timetable-text";

export function TimetableLabel({ value, kind = "text" }: { value: string; kind?: "text" | "teacher" | "day" }) {
  const display = useTimetableDisplay();
  const tt = useTimetableText();
  return kind === "teacher" ? display.teacher(value) : kind === "day" ? display.dow(value) : tt(value);
}

export function TimetableTeacherName({ name, nickname }: { name: string; nickname?: string }) {
  const display = useTimetableDisplay();
  return <>{display.teacher(name)}{display.lang === "ko" && nickname ? <span className="text-xs font-bold opacity-85">({nickname})</span> : null}</>;
}
