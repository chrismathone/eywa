import { programSubjectsOf, subjectGroupOf } from "@/features/students/enrollment/program";
import { subjectChoices } from "./preview";

/** URL의 선택값은 권한이 아니다. 배정된 과목 묶음 중에서만 화면을 고른다. */
export function selectSubjectView(labels: Readonly<Record<string, string>>, assigned: readonly string[], requested?: string) {
  const programs = programSubjectsOf(labels);
  const groups = new Set(assigned.map((s) => subjectGroupOf(s, programs)).filter(Boolean));
  const choices = subjectChoices(labels).filter((s) => groups.has(subjectGroupOf(s.key, programs)));
  const active = choices.find((s) => s.key === requested) ?? choices[0];
  return { choices, active, subjects: active ? assigned.filter((s) => subjectGroupOf(s, programs) === subjectGroupOf(active.key, programs)) : [] };
}
