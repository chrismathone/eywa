import { getGradeLevel, isPreschoolGrade } from "@/lib/format/school-grade";
import { distribution } from "./model";

export type SchoolGroup = {
  label: string;
  total: number;
  schools: { label: string; value: number }[];
};

export function schoolsByLevel(
  rows: { grade: string | null; school: string | null }[],
): SchoolGroup[] {
  const groups = new Map<string, (string | null)[]>([
    ["초등", []],
    ["중등", []],
    ["고등", []],
  ]);
  for (const row of rows) {
    const school = row.school?.trim() ?? "";
    const level =
      getGradeLevel(row.grade) ||
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
    const schools = groups.get(label) ?? [];
    schools.push(school || null);
    groups.set(label, schools);
  }
  return [...groups].map(([label, schools]) => ({
    label,
    total: schools.length,
    schools: distribution(schools),
  }));
}
