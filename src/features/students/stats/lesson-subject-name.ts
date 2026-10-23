import type { ProgramSubject } from "@/features/students/enrollment/program";
const NOT_SUBJECT = ["중국어", "외국어", "한국어", "과학고", "수학여행"];
export function subjectNameText(name: string, configuredLabels: readonly string[] = []) {
  let text = name.normalize("NFKC").toLowerCase();
  // A configured subject such as 중국어 must survive, while an unrelated 중국어 must not become 국어.
  const protectedLabels = [...new Set(configuredLabels.map(label => label.normalize("NFKC").trim().toLowerCase()))]
    .filter(label => NOT_SUBJECT.some(word => label.includes(word))).sort((a, b) => b.length - a.length);
  protectedLabels.forEach((label, index) => { text = text.split(label).join(`\uE000${index}\uE001`); });
  for (const word of NOT_SUBJECT) text = text.split(word).join(" ");
  return text.replace(/\uE000(\d+)\uE001/g, (token, index: string) => protectedLabels[Number(index)] ?? token);
}
/** Prefer the most specific explicit label, while preserving genuinely mixed subjects. */
export function explicitLessonSubjects(name: string, subjects: readonly ProgramSubject[]) {
  let text = subjectNameText(name, subjects.map(s => s.label));
  const matches: ProgramSubject[] = [];
  for (const s of [...subjects].sort((a, b) => b.label.length - a.label.length)) {
    const label = s.label.normalize("NFKC").trim().toLowerCase();
    if (!label) continue;
    const re = new RegExp(`${/^[a-z0-9 ]+$/.test(label) ? "(?<![a-z])" : ""}${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${/^[a-z0-9 ]+$/.test(label) ? "(?![a-z])" : ""}`, "g");
    if (!re.test(text)) continue;
    matches.push(s);
    text = text.replace(re, " ");
  }
  return matches;
}
