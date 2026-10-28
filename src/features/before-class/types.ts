import type { BeforeClassCheck } from "./items";

/** 비포클래스체크리스트 화면 자료 모양 — 서버(queries)와 클라 화면이 함께 쓴다(server-only 금지, [[#61]]). */
export type ChecklistTarget = { id: string; name: string; teacherName: string };
export type RosterStudent = { id: string; name: string; schoolGrade: string; onHold: boolean; activeDates: string[] };
export type ClassMonth = { dates: string[]; students: RosterStudent[]; checks: Record<string, BeforeClassCheck> };

/** 칸 열쇠 = 학생 id | 수업일. */
export const checkKey = (studentId: string, date: string) => `${studentId}|${date}`;
