/** 보강 추가 흐름 훅들(use-makeup-flow·ask·apply·resolve·row)이 함께 쓰는 모양. */
import type { OneScreenStudent } from "../types";
import type { AttendanceSelection } from "./attendance-pills";
import type { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";

/** 화면의 출결 함수 — 보강 합침·추가가 그 반 칸을 고친다(알약과 같은 함수). */
export type MakeupAttendanceDeps = {
  setAttendanceFor: (
    studentId: string,
    classId: string,
    status: AttendanceSelection | "early_leave",
    extra?: { note?: string | null; units?: string },
    opts?: { overwrite?: boolean },
  ) => Promise<unknown>;
  applyAttendanceLocal: (
    studentId: string,
    classId: string,
    raw: string | null,
    extra?: { note?: string | null; units?: number | null },
  ) => void;
  withMark: (s: OneScreenStudent) => OneScreenStudent;
};

export type MakeupI18n = { t: ReturnType<typeof useSheetT>; tf: ReturnType<typeof useSheetTf> };
export type PatchStudent = (id: string, fn: (s: OneScreenStudent) => OneScreenStudent) => void;
