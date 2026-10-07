"use client";

import { useSheetLang, useSheetText } from "./lang-context";
import { classNameFor } from "./class-name";
import { teacherNameFor } from "./teacher-name";
import { useTeacherNames } from "./teacher-names-context";
import { sheetSchoolGrade } from "./school-grade";
import { roomNameFor } from "./room-name";

/** A fixed UI label in a shared or server-rendered view follows the teacher shell's language. */
export function SheetText({ value }: { value: string }) {
  const text = useSheetText();
  return text(value);
}

export function SheetClassName({ value }: { value: string | null | undefined }) {
  return classNameFor(value, useSheetLang());
}

export function SheetTeacherName({ value }: { value: string | null | undefined }) {
  const names = useTeacherNames();
  return teacherNameFor(value, names, useSheetLang());
}

export function SheetSchoolGrade({ school, grade }: { school?: string | null; grade?: string | null }) {
  return sheetSchoolGrade(school, grade, useSheetLang());
}

export function SheetRoomName({ value }: { value: string | null | undefined }) {
  return roomNameFor(value, useSheetLang());
}
