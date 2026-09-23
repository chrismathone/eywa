"use client";

import { useMemo } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";

type Student = { id: string; school: string | null; grade: string | null };

/**
 * 내신 명단의 **학교·학년** 고르기(원장 2026-09-24 *"내신을 고르면 반 말고 학교 및 학년 선택해서 불러올 수 있게"*).
 * 학교 시험이라 성적의 주인은 반이 아니라 학교·학년이다. 선택지는 그 과목 반을 다니는 학생의 저장값에서 뽑는다
 * — 서버가 같은 값으로 명단을 거르므로 글자까지 같아야 한다(표기를 여기서 바꾸지 말 것).
 */
export function SchoolGradeFields({ students, school, grade, onSchool, onGrade, fieldClass, labelClass }: {
  students: Student[]; school: string; grade: string;
  onSchool: (v: string) => void; onGrade: (v: string) => void; fieldClass: string; labelClass: string;
}) {
  const schools = useMemo(() => {
    const count = new Map<string, number>();
    for (const s of students) if (s.school) count.set(s.school, (count.get(s.school) ?? 0) + 1);
    return [...count].sort((a, b) => a[0].localeCompare(b[0], "ko")).map(([v, n]) => ({ value: v, label: v, hint: `${n}명` }));
  }, [students]);
  const grades = useMemo(() => {
    const set = new Set<string>();
    for (const s of students) if (s.grade && (!school || s.school === school)) set.add(s.grade);
    return [...set].sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
  }, [students, school]);
  return <>
    <div className={labelClass}>학교<SearchableSelect value={school} placeholder="전체" searchPlaceholder="학교 이름" cap={50} ariaLabel="학교"
      className="w-52" triggerClassName={fieldClass} onValueChange={onSchool}
      options={[{ value: "", label: "전체" }, ...schools]} /></div>
    <label className={labelClass}>학년<select value={grades.includes(grade) ? grade : ""} onChange={(e) => onGrade(e.target.value)} className={fieldClass}>
      <option value="">전체</option>{grades.map((g) => <option key={g} value={g}>{g}</option>)}</select></label>
  </>;
}
