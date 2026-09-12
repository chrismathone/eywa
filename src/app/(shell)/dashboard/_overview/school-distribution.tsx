"use client";

import type { SchoolGroup } from "@/features/dashboard/overview/student-composition";
import { number } from "./charts";
import { StudentSubjectBars, StudentSubjectLegend } from "./student-subject-bars";
import { DetailPopup } from "./detail-popup";
import s from "./overview.module.css";

export function SchoolDistribution({ groups }: { groups: SchoolGroup[] }) {
  return (
    <div className={s.schoolGroups}>
      {groups.map((group) => (
        <section key={group.label} aria-label={`${group.label} 학교별 학생`}>
          <header className={s.subjectHeading}>
            <b>{group.label}</b>
            <span>{number(group.total)}명</span>
          </header>
          {group.schools.length ? (
            <>
              <StudentSubjectBars rows={group.schools.slice(0, 5)} max={Math.max(1, ...group.schools.map((school) => school.value))} />
              {group.schools.length > 5 && <DetailPopup title={`${group.label} 학교별 학생`} label={`전체 ${group.schools.length}개 보기`}>
                <StudentSubjectBars rows={group.schools} />
                <StudentSubjectLegend rows={group.schools} />
              </DetailPopup>}
            </>
          ) : (
            <p className={s.empty}>재원생이 없습니다.</p>
          )}
        </section>
      ))}
      <StudentSubjectLegend rows={groups.flatMap((group) => group.schools)} />
    </div>
  );
}
