"use client";

import type { OverviewData } from "@/features/dashboard/overview/model";
import { dashboardSubjectColor } from "@/features/dashboard/overview/subject-colors";
import { WindowLink } from "@/components/workspace/window-link";
import { DetailPopup } from "./detail-popup";
import s from "./overview.module.css";

type Slot = OverviewData["schedule"][number];

function ClassRow({ slot }: { slot: Slot }) {
  return (
    <WindowLink
      href={`/classes/${slot.classId}`}
      title={slot.className}
      className={s.scheduleRow}
    >
      <time>
        {slot.startTime.slice(0, 5)}
        <small>{slot.endTime.slice(0, 5)}</small>
      </time>
      <i
        className={
          slot.status === "ongoing"
            ? s.scheduleLive
            : slot.status === "done"
              ? s.scheduleDone
              : s.scheduleSoon
        }
      />
      <span>
        <b>{slot.className}</b>
        <small>
          {slot.teacherName ?? "강사 미정"} ·{" "}
          {slot.classroomName ?? "교실 미정"}
        </small>
      </span>
    </WindowLink>
  );
}

export function CurrentClasses({
  schedule,
  subjects,
}: {
  schedule: Slot[];
  subjects: Record<string, string>;
}) {
  const keys = [...new Set(schedule.map((slot) => slot.subject))];
  if (!keys.length)
    return <p className={s.empty}>오늘 예정된 수업이 없습니다.</p>;
  return (
    <div className={s.currentClasses}>
      <div className={s.scheduleGrid}>
        {keys.map((key) => {
          const all = schedule.filter((slot) => slot.subject === key);
          const ongoing = all.filter((slot) => slot.status === "ongoing");
          const next = all
            .filter((slot) => slot.status === "upcoming")
            .sort((a, b) => a.startTime.localeCompare(b.startTime));
          const visible = ongoing.length
            ? ongoing
            : next.filter((slot) => slot.startTime === next[0]?.startTime);
          const label = subjects[key] ?? key;
          return (
            <section
              key={key}
              className={s.subjectSchedule}
              aria-label={`${label} 수업`}
            >
              <div className={s.subjectHeading}>
                <b style={{ color: dashboardSubjectColor(key, subjects) }}>{label}</b>
                <span className={ongoing.length ? s.textGreen : undefined}>
                  {ongoing.length
                    ? `진행 중 ${ongoing.length}개`
                    : next.length
                      ? `다음 ${next[0].startTime.slice(0, 5)} · ${visible.length}개`
                      : "오늘 수업 종료"}
                </span>
              </div>
              {visible.slice(0, 2).map((slot) => (
                <ClassRow key={slot.id} slot={slot} />
              ))}
              {visible.length > 2 && (
                <DetailPopup
                  title={`${label} ${ongoing.length ? "진행 중인" : "다음"} 수업`}
                  label={`전체 ${visible.length}개 수업 보기`}
                >
                  {visible.map((slot) => (
                    <ClassRow key={slot.id} slot={slot} />
                  ))}
                </DetailPopup>
              )}
            </section>
          );
        })}
      </div>
      <DetailPopup
        title="오늘 전체 수업 일정"
        label={`오늘 전체 ${schedule.length}개 시간대 보기`}
      >
        {keys.map((key) => (
          <section key={key} className={s.subjectSchedule}>
            <div className={s.subjectHeading}>
              <b style={{ color: dashboardSubjectColor(key, subjects) }}>{subjects[key] ?? key}</b>
            </div>
            {schedule
              .filter((slot) => slot.subject === key)
              .map((slot) => (
                <ClassRow key={slot.id} slot={slot} />
              ))}
          </section>
        ))}
      </DetailPopup>
    </div>
  );
}
