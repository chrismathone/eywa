import { lessonProgramClassifier, type LessonName, type LessonStaff } from "@/features/students/stats/lesson-program";
import { subjectGroupOf, type ProgramSubject } from "@/features/students/enrollment/program";

/** 명시 과목·반 연결이 우선. 옛 청구 수업명 판정은 기존 분류기를 쓰되 설정 과목 하나로 해석될 때만 인정한다. */
export function contributionSubjectOf(input: { subjects: readonly ProgramSubject[]; classes: readonly { id: string; subject: string }[];
  names: readonly LessonName[]; staff: readonly LessonStaff[] }) {
  const keys = new Set(input.subjects.map((s) => s.key));
  const classSubject = new Map(input.classes.map((c) => [c.id, c.subject]));
  const classify = lessonProgramClassifier(input.names, input.subjects, input.staff);
  return (item: Record<string, unknown>): string | null => {
    if (typeof item.subject === "string" && keys.has(item.subject)) return item.subject;
    const classId = item.class_id ?? item.classId;
    const fromClass = typeof classId === "string" ? classSubject.get(classId) : null;
    if (fromClass && keys.has(fromClass)) return fromClass;
    const name = String(item.description ?? item.label ?? item.name ?? "");
    const explicit = input.subjects.filter((s) => s.label && name.includes(s.label)).sort((a, b) => b.label.length - a.label.length);
    if (explicit.length && explicit.every((s) => explicit[0]!.label.includes(s.label))) return explicit[0]!.key;
    const program = classify(name);
    const group = program === "eie" || program === "injaewon" ? "english" : program;
    const matches = input.subjects.filter((s) => subjectGroupOf(s.key, input.subjects) === group);
    return matches.length === 1 ? matches[0]!.key : null;
  };
}
