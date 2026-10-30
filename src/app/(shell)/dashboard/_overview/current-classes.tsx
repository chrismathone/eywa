"use client";

import { useEffect, useRef } from "react";
import type { OverviewData } from "@/features/dashboard/overview/model";
import { dashboardSubjectColor } from "@/features/dashboard/overview/subject-colors";
import { WindowLink } from "@/components/workspace/window-link";
import { DetailPopup } from "./detail-popup";
import s from "./overview.module.css";

type Slot = OverviewData["schedule"][number];

/** 전체 일정 팝업이 열리면 이 표식이 붙은 줄로 스크롤한다(지금 진행 중인 첫 수업, 없으면 다음 수업). */
const NOW_ANCHOR = "js-now-anchor";

/** `hideTeacher` = 대시보드 첫 화면(강사 이름은 '전체 보기' 팝업에서만 — 원장 2026-10-30). */
function ClassRow({ slot, now = false, anchor = false, hideTeacher = false }: { slot: Slot; now?: boolean; anchor?: boolean; hideTeacher?: boolean }) {
  return (
    <WindowLink
      href={`/classes/${slot.classId}`}
      title={slot.className}
      className={[s.scheduleRow, now && s.scheduleNow, anchor && NOW_ANCHOR].filter(Boolean).join(" ")}
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
          {hideTeacher ? null : <>{slot.teacherName ?? "강사 미정"} ·{" "}</>}
          {slot.classroomName ?? "교실 미정"}
        </small>
      </span>
    </WindowLink>
  );
}

const byStart = (a: Slot, b: Slot) => a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id);

/**
 * '오늘 전체 N개 시간대 보기' 팝업 본문 — 원장 2026-09-12: *"자동 스크롤해서 지금 시간대로 이동시켜주고, 지금 시간대 수업중인
 * 수업은 테두리로 하이라이트"* · *"하나도 없으면 최상단에 '지금 진행중인 수업이 없습니다' 따로 표시"*.
 * 팝업 내용은 열릴 때 마운트되므로(Dialog Popup) 효과 한 번이 곧 "열 때마다"다. 지금 판정은 서버 스냅샷의 `status`
 * (30초 갱신)이라 화면 시계와 따로 재지 않는다.
 */
function AllSchedule({ schedule, keys, subjects }: { schedule: Slot[]; keys: string[]; subjects: Record<string, string> }) {
  const ref = useRef<HTMLDivElement>(null);
  const ongoing = schedule.filter((slot) => slot.status === "ongoing");
  const anchor = (ongoing.length ? [...ongoing] : schedule.filter((slot) => slot.status === "upcoming")).sort(byStart)[0];
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(`.${NOW_ANCHOR}`);
    // 팝업 본문(.popupBody overflow:auto)만 움직인다 — 포털이라 뒤 화면의 <main>은 조상이 아니다.
    el?.scrollIntoView({ block: "center" });
  }, []);
  return (
    <div ref={ref}>
      {!ongoing.length && (
        <p className={s.nowEmpty} role="status">
          지금 진행중인 수업이 없습니다
        </p>
      )}
      {keys.map((key) => (
        <section key={key} className={s.subjectSchedule}>
          <div className={s.subjectHeading}>
            <b style={{ color: dashboardSubjectColor(key, subjects) }}>{subjects[key] ?? key}</b>
          </div>
          {schedule
            .filter((slot) => slot.subject === key)
            .map((slot) => (
              <ClassRow key={slot.id} slot={slot} now={slot.status === "ongoing"} anchor={slot.id === anchor?.id} />
            ))}
        </section>
      ))}
    </div>
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
      <div className={s.scheduleGrid} data-overview="schedule-grid">
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
                <ClassRow key={slot.id} slot={slot} hideTeacher />
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
        <AllSchedule schedule={schedule} keys={keys} subjects={subjects} />
      </DetailPopup>
    </div>
  );
}
