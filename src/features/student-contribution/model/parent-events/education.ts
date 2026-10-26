import { eventName } from "./family";
import { validEventDate } from "./attendance";
import { normalizeSchoolName } from "@/features/schools/school-name";
import type { EventIdentity, EventReason, EventStudent } from "./types";

const school = (s: string | null) => normalizeSchoolName(s);
const year = (s: string) => Number(s.slice(0, 4)) - (Number(s.slice(5, 7)) < 3 ? 1 : 0);
const level = (n: number) => n <= 6 ? "초" : n <= 9 ? "중" : "고";
function grade(s: string | null) {
  const match = /^(?:예비)?(초|중|고)([1-6])(?:학년)?$/.exec(eventName(s));
  if (!match || (match[1] !== "초" && Number(match[2]) > 3)) return null;
  return ({ 초: 0, 중: 6, 고: 9 }[match[1]!] ?? 0) + Number(match[2]);
}
export function eventEducationConflicts(input: EventIdentity, student: EventStudent, today: string): EventReason[] {
  const reasons: EventReason[] = [];
  const then = grade(input.grade), now = grade(student.grade);
  const next = input.gradeReference === "next" || eventName(input.grade).startsWith("예비");
  const observed = then === null ? null : then - (next ? 1 : 0);
  let progressionVerified = false;
  if (observed !== null && now !== null) {
    const asOf = input.gradeAsOf ?? input.eventDate;
    if (!validEventDate(asOf) || !student.schoolAsOf || !validEventDate(student.schoolAsOf) || student.schoolAsOf > today) reasons.push("school_date_unknown");
    else {
      progressionVerified = now - observed === year(student.schoolAsOf) - year(asOf);
      if (!progressionVerified) reasons.push("grade_conflict");
    }
  }
  const beforeSchool = school(input.school), currentSchool = school(student.school);
  // A verified elementary→middle/high progression does not require the same school name.
  const changedLevel = progressionVerified && observed !== null && now !== null && level(observed) !== level(now);
  if (beforeSchool && currentSchool && beforeSchool !== currentSchool && !changedLevel) reasons.push("school_conflict");
  return reasons;
}
