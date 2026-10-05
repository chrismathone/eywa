import { schoolGradeLabel } from "@/lib/format/school-grade";
import type { MakeupOption } from "../server/read-types";

export function makeupOptionLabel(kind: string, option: MakeupOption): string {
  if (kind === "classes" && option.active === false && !option.name.includes("종료된 반")) return `${option.name} · 종료된 반`;
  if (kind !== "students") return option.name;
  const school = typeof option.school === "string" ? option.school : null;
  const grade = typeof option.grade === "string" ? option.grade : null;
  const classes = Array.isArray(option.class_names)
    ? option.class_names.filter((value): value is string => typeof value === "string").slice(0, 3) : [];
  return [option.name, schoolGradeLabel(school, grade), classes.join(" / ")].filter(Boolean).join(" · ");
}
