import type { BeforeClassCheck, ReportLevel } from "./items";

/** 비포클래스체크리스트 화면 자료 모양 — 서버(queries)와 클라 화면이 함께 쓴다(server-only 금지, [[#61]]). */
export type ChecklistTarget = { id: string; name: string; teacherName: string };
export type RosterStudent = { id: string; name: string; schoolGrade: string; onHold: boolean; activeDates: string[] };
/** 그날 수업보고서의 수업 평가 값(보고서 시안 전용) — 없으면 null. */
export type ReportDayLevels = { attitude: ReportLevel | null; understanding: ReportLevel | null };
export type ClassMonth = {
  dates: string[];
  students: RosterStudent[];
  checks: Record<string, BeforeClassCheck>;
  reportLevels: Record<string, ReportDayLevels>;
  /** 이 반 체크 추적 시작일(첫 체크) — 없으면 null. */
  trackingStart: string | null;
  /** '지난 수업 결석'이라 자동 제외인 칸(열쇠 = checkKey) — 저장하지 않은 판정(excuse.ts). */
  autoExcused: string[];
};

/** 칸 열쇠 = 학생 id | 수업일. */
export const checkKey = (studentId: string, date: string) => `${studentId}|${date}`;
