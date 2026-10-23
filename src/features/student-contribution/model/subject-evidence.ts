import { lessonNameWeights, type HistoryInvoice } from "@/features/students/stats/history-aywa";
import { lessonProgramClassifier, type LessonName, type LessonStaff } from "@/features/students/stats/lesson-program";
import { subjectGroupOf, type ProgramSubject } from "@/features/students/enrollment/program";
import { isOtherContributionItem } from "./other-items";
import { historicalTeacherSubjects, isSingleTeacher, teacherKey } from "./historical-teacher-subjects";

export type SubjectEvidence = { name: string; subject: string; basis: "class" | "historical_teacher"; reference: string };
export type LessonTeacher = { class_name: string | null; teacher_name: string | null };
export const lessonKey = (name: string) => name.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
function trailingAlias(name: string) {
  if (!name.endsWith(")")) return "";
  let depth = 0;
  for (let i = name.length - 1; i >= 0; i--) {
    if (name[i] === ")") depth++;
    if (name[i] === "(" && --depth === 0) return name.slice(i + 1, -1);
  }
  return "";
}

/** Count distinct names and source rows, never tuition amounts as supporting votes. */
export function contributionLessonNames(invoices: readonly HistoryInvoice[], history: readonly { item_name: string | null }[]): LessonName[] {
  const counts = new Map(lessonNameWeights(invoices).map(n => [n.name, n.weight]));
  for (const row of history) if (row.item_name?.trim()) counts.set(row.item_name.trim(), (counts.get(row.item_name.trim()) ?? 0) + 1);
  return [...counts].filter(([name]) => !isOtherContributionItem(name)).map(([name, weight]) => ({ name, weight }));
}

/** Same course → recorded teacher → one subject. Never split concatenated event rows or transfers. */
export function contributionSubjectEvidence(input: { names: readonly LessonName[]; subjects: readonly ProgramSubject[];
  staff: readonly LessonStaff[]; classes: readonly { class_name?: string; subject: string }[]; teachers: readonly LessonTeacher[] }): SubjectEvidence[] {
  const knownKeys = new Set(input.subjects.map(s => s.key));
  const aliases = historicalTeacherSubjects(input.teachers, input.subjects, input.staff);
  const classify = lessonProgramClassifier(input.names, input.subjects, input.staff);
  const courseNames = new Map(input.names.map(n => [lessonKey(n.name), n.name]));
  const output: SubjectEvidence[] = input.classes.flatMap(c => c.class_name && knownKeys.has(c.subject)
    ? [{ name: c.class_name.replace(/\s*\(~\d{2}\.\d{2}\.\d{2}\)$/, ""), subject: c.subject, basis: "class" as const, reference: c.class_name }] : []);
  for (const row of input.teachers) {
    const name = row.class_name?.trim(), teacher = row.teacher_name?.trim();
    if (!name || !teacher || name.includes("→") || !isSingleTeacher(teacher)) continue;
    const own = aliases.get(teacherKey(teacher));
    if (!own || own.size !== 1) continue;
    const subject = [...own][0]!, program = classify(name);
    const group = program === "eie" || program === "injaewon" ? "english" : program;
    // A present course subject outranks today's teacher assignment; conflicting evidence stays unresolved.
    if (group && group !== subjectGroupOf(subject, input.subjects)) continue;
    const courseAliases = [courseNames.get(lessonKey(name)), courseNames.get(lessonKey(trailingAlias(name)))];
    for (const alias of new Set(courseAliases)) if (alias) output.push({ name: alias, subject, basis: "historical_teacher", reference: teacher });
  }
  return output;
}
