import { lessonProgramClassifier, type LessonName, type LessonStaff } from "@/features/students/stats/lesson-program";
import { subjectGroupOf, type ProgramSubject } from "@/features/students/enrollment/program";
import { lessonKey, type SubjectEvidence } from "./subject-evidence";
import { explicitLessonSubjects } from "@/features/students/stats/lesson-subject-name";

/** 명시 과목·반 연결이 우선. 옛 청구 수업명 판정은 기존 분류기를 쓰되 설정 과목 하나로 해석될 때만 인정한다. */
export function contributionSubjectOf(input: { subjects: readonly ProgramSubject[]; classes: readonly { id: string; subject: string }[];
  names: readonly LessonName[]; staff: readonly LessonStaff[]; evidence?: readonly SubjectEvidence[] }) {
  const keys = new Set(input.subjects.map((s) => s.key));
  const classSubject = new Map(input.classes.map((c) => [c.id, c.subject]));
  const classify = lessonProgramClassifier(input.names, input.subjects, input.staff);
  const byName = new Map<string, Set<string>>();
  for (const e of input.evidence ?? []) if (keys.has(e.subject)) {
    const key = lessonKey(e.name), found = byName.get(key) ?? new Set<string>();
    found.add(e.subject); byName.set(key, found);
  }
  return (item: Record<string, unknown>): string | null => {
    if (typeof item.subject === "string" && keys.has(item.subject)) return item.subject;
    const classId = item.class_id ?? item.classId;
    const fromClass = typeof classId === "string" ? classSubject.get(classId) : null;
    if (fromClass && keys.has(fromClass)) return fromClass;
    const name = String(item.description ?? item.label ?? item.name ?? "");
    const explicit = explicitLessonSubjects(name, input.subjects);
    if (explicit.length === 1) return explicit[0]!.key;
    if (explicit.length > 1) return null;
    const program = classify(name);
    const group = program === "eie" || program === "injaewon" ? "english" : program;
    const evidence = byName.get(lessonKey(name));
    if (evidence && evidence.size > 1) return null;
    if (evidence?.size === 1) {
      const subject = [...evidence][0]!;
      return group && subjectGroupOf(subject, input.subjects) !== group ? null : subject;
    }
    const matches = input.subjects.filter((s) => subjectGroupOf(s.key, input.subjects) === group);
    if (matches.length === 1) return matches[0]!.key;
    return null;
  };
}
