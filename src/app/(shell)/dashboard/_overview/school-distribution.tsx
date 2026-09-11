"use client";

import type { SchoolGroup } from "@/features/dashboard/overview/student-composition";
import { Bars, COLORS, number } from "./charts";
import s from "./overview.module.css";

export function SchoolDistribution({ groups }: { groups: SchoolGroup[] }) {
  return (
    <div className={s.schoolGroups}>
      {groups.map((group, i) => (
        <section key={group.label} aria-label={`${group.label} 학교별 학생`}>
          <header className={s.subjectHeading}>
            <b>{group.label}</b>
            <span>{number(group.total)}명</span>
          </header>
          {group.schools.length ? (
            <Bars
              data={group.schools}
              limit={5}
              color={COLORS[i % COLORS.length]}
              title={`${group.label} 학교별 학생`}
            />
          ) : (
            <p className={s.empty}>재원생이 없습니다.</p>
          )}
        </section>
      ))}
    </div>
  );
}
