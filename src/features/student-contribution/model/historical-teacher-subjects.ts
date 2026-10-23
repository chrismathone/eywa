import { lessonProgramClassifier, type LessonStaff } from "@/features/students/stats/lesson-program";
import { subjectGroupOf, type ProgramSubject } from "@/features/students/enrollment/program";
import type { LessonTeacher } from "./subject-evidence";
import { explicitLessonSubjects } from "@/features/students/stats/lesson-subject-name";

export const isSingleTeacher = (name: string) => /^(?:[가-힣]{2,4}(?:\s*\([A-Za-z .-]+\))?|[A-Za-z]+(?:[ -][A-Za-z]+)*)$/.test(name);
export const teacherKey = (name: string) => name.normalize("NFKC").trim().replace(/\s*\([A-Za-z .-]+\)$/, "").toLowerCase();

/** Retired staff can be identified by two distinct, explicitly named courses; inferred courses never train this map. */
export function historicalTeacherSubjects(rows: readonly LessonTeacher[], subjects: readonly ProgramSubject[], staff: readonly LessonStaff[]) {
  const aliases = new Map<string, Set<string>>();
  const add = (name: string, keys: readonly string[]) => {
    const key = teacherKey(name);
    if (!key) return;
    const found = aliases.get(key) ?? new Set<string>();
    keys.forEach(s => { if (subjects.some(k => k.key === s)) found.add(s); });
    aliases.set(key, found);
  };
  for (const teacher of staff) for (const name of teacher.names) if (name) add(name, teacher.subjects);
  const explicit = lessonProgramClassifier([], subjects, []);
  const observed = new Map<string, Map<string, Set<string>>>();
  for (const row of rows) {
    const name = row.class_name?.trim(), teacher = row.teacher_name?.trim();
    if (!name || !teacher || !isSingleTeacher(teacher) || name.includes("→")) continue;
    const program = explicit(name), group = program === "eie" || program === "injaewon" ? "english" : program;
    const named = explicitLessonSubjects(name, subjects);
    const keys = named.length ? named : subjects.filter(s => subjectGroupOf(s.key, subjects) === group);
    if (keys.length !== 1) continue;
    const key = teacherKey(teacher), courses = observed.get(key) ?? new Map<string, Set<string>>();
    const names = courses.get(keys[0]!.key) ?? new Set<string>();
    names.add(name.normalize("NFKC").replace(/\s+/g, "")); courses.set(keys[0]!.key, names); observed.set(key, courses);
  }
  for (const [key, courses] of observed) {
    const current = aliases.get(key);
    // Even one explicit conflicting course prevents today's staff assignment from rewriting old history.
    if (current?.size) { courses.forEach((_, subject) => current.add(subject)); continue; }
    if (courses.size === 1 && [...courses.values()][0]!.size >= 2) aliases.set(key, new Set(courses.keys()));
  }
  return aliases;
}
