import { getGradeLevel, isPreschoolGrade } from "@/lib/format/school-grade";
import { subjectMixOf, type GradeSplitRow, type StudentPrograms } from "@/features/students/enrollment/enrolled-composition";
import { STUDENT_LEVELS, levelLabel, studentLevelOf } from "@/features/students/list-filter-values";

export type LevelSubjectSplit = { rows: (GradeSplitRow & { neither: number; total: number })[] };

/** Same students and program map as the grade chart; no additional data fetch or double counting. */
export function levelSubjectSplit(students: readonly { id: string; grade: string | null }[], programs: StudentPrograms): LevelSubjectSplit {
  // 줄 순서·라벨 = STUDENT_LEVELS(초등·중등·고등·미취학·기타·미입력). 원생목록 `level=`이 같은 분류(studentLevelOf)로 거른다.
  const rows = new Map<string, LevelSubjectSplit["rows"][number]>(STUDENT_LEVELS.map(({ label }) => [label, { label, englishOnly: 0, both: 0, mathOnly: 0, neither: 0, total: 0 }]));
  const seen = new Set<string>();
  for (const student of students) {
    if (seen.has(student.id)) continue;
    seen.add(student.id);
    const label = levelLabel(studentLevelOf(student.grade));
    const row = rows.get(label)!;
    row[subjectMixOf(programs.get(student.id))] += 1;
    row.total += 1;
  }
  return { rows: [...rows.values()].filter((row, i) => i < 3 || row.total > 0) };
}

export type SchoolGroup = {
  label: string;
  total: number;
  schools: SubjectDistributionRow[];
};

export type SubjectDistributionRow = {
  label: string;
  value: number;
  /** Optional only for snapshots retained before subject composition was added. */
  subjects?: StudentSubjectSplit;
};

export type StudentSubjectSplit = {
  englishOnly: number;
  both: number;
  mathOnly: number;
  otherOnly: number;
  noEnrollment: number;
};

export function schoolsByLevel(
  rows: readonly { id?: string; grade: string | null; school: string | null }[],
  programs?: StudentPrograms,
  active?: ReadonlySet<string>,
): SchoolGroup[] {
  // Legacy callers can still request totals without providing subject data.
  type School = SubjectDistributionRow;
  const groups = new Map<string, Map<string, School>>([
    ["초등", new Map()],
    ["중등", new Map()],
    ["고등", new Map()],
  ]);
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.id && seen.has(row.id)) continue;
    if (row.id) seen.add(row.id);
    const school = row.school?.trim() ?? "";
    const level =
      getGradeLevel(row.grade?.trim()) ||
      (/초(?:등학교)?$/.test(school)
        ? "초"
        : /중(?:학교)?$/.test(school)
          ? "중"
          : /고(?:등학교)?$/.test(school)
            ? "고"
            : "");
    const label = isPreschoolGrade(row.grade)
      ? "미취학"
      : ({ 초: "초등", 중: "중등", 고: "고등" }[level] ?? "기타·미입력");
    const schools = groups.get(label) ?? new Map<string, School>();
    const schoolName = school || "미입력";
    const entry: School = schools.get(schoolName) ?? {
      label: schoolName,
      value: 0,
      ...(programs && active && row.id ? { subjects: { englishOnly: 0, both: 0, mathOnly: 0, otherOnly: 0, noEnrollment: 0 } } : {}),
    };
    if (entry.subjects && programs && active && row.id) {
      const mix = subjectMixOf(programs.get(row.id));
      const category = mix === "neither" ? (active.has(row.id) ? "otherOnly" : "noEnrollment") : mix;
      entry.subjects[category] += 1;
    }
    entry.value += 1;
    schools.set(schoolName, entry);
    groups.set(label, schools);
  }
  return [...groups].map(([label, schools]) => ({
    label,
    total: [...schools.values()].reduce((sum, school) => sum + school.value, 0),
    schools: [...schools.values()].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "ko")),
  }));
}
