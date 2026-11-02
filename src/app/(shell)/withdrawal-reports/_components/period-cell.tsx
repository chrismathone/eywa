import { specialCourseLabel, type CoursePeriod, type SubjectPeriodGroup } from "@/features/withdrawal-reports/course-period";
import { SpecialCourses } from "./special-courses";

function ClassRow({ course: c }: { course: CoursePeriod }) {
  return <div className="flex flex-wrap items-center gap-1.5 text-xs">
    <span className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-medium text-primary">{c.className}</span>
    <span className="text-muted-foreground">{c.startDate} ~ {c.endDate}</span>
  </div>;
}

/**
 * 수강기간 칸 — 과목마다 '처음 시작일 ~ 퇴원일 (기간)' 한 줄, 그 아래 다닌 반을 **라벨**로 구분해 보인다
 * (원장 2026-10-30 *"수강기간에서 반에는 라벨처럼 보이게 구분시켜줄것. 텍스트가 전부 서식 같아서 구분이 안됨"*).
 * 특강은 줄로 적지 않고 '특강 수강 × n회' 라벨 하나로 묶는다(원장 2026-11-02).
 */
export function PeriodCell({ groups }: { groups: SubjectPeriodGroup[] }) {
  return <div className="space-y-1.5">
    {groups.map((g, i) => <div key={i} className="space-y-1">
      <div>{g.subjectLabel && <span className="mr-1 font-semibold">{g.subjectLabel}</span>}{g.first} ~ {g.until} ({g.duration}{g.gaps ? ` · 중단 ${g.gaps}회` : ""})</div>
      {g.classes.map((c, j) => <ClassRow key={j} course={c} />)}
      {g.specials.length > 0 && <div><SpecialCourses label={specialCourseLabel(g.specials.length)}>
        {g.specials.map((c, j) => <ClassRow key={j} course={c} />)}
      </SpecialCourses></div>}
    </div>)}
  </div>;
}
