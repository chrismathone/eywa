"use client";
import { useSheetLang } from "./lang-context";
import { useTeacherNames } from "./teacher-names-context";
import { teacherNameFor } from "./teacher-name";
import { classNameFor } from "./class-name";
import { roomNameFor } from "./room-name";
import { studentNameParts } from "./student-name";
import { sheetSchoolGrade } from "./school-grade";
import { sheetDowLabel } from "./i18n";
import { timetableGeneratedNote } from "./timetable-labels";

export function useTimetableDisplay() {
  const lang = useSheetLang();
  const names = useTeacherNames();
  return {
    lang,
    note: (text: string) => timetableGeneratedNote(lang, text),
    teacher: (name: string | null | undefined) => teacherNameFor(name, names, lang),
    className: (name: string) => classNameFor(name, lang),
    student: (name: string, english?: string | null) => studentNameParts(name, english, lang).primary,
    school: (school?: string | null, grade?: string | null) => sheetSchoolGrade(school, grade, lang),
    dow: (day: string) => sheetDowLabel(day, lang),
    room: (name: string) => {
      const label = roomNameFor(name, lang) ?? name;
      return lang === "en" ? label.replace(/[월화수목금토일]+(?=\s*\d)/g, (days) => [...days].map((day) =>
        ({ 월: "Mon", 화: "Tue", 수: "Wed", 목: "Thu", 금: "Fri", 토: "Sat", 일: "Sun" })[day as "월"]).join("/")) : label;
    },
  };
}
