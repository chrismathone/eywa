"use client";

import type { OverviewData } from "@/features/dashboard/overview/model";
import { dashboardDate } from "@/features/dashboard/overview/display";
import { WindowLink } from "@/components/workspace/window-link";
import { ExternalLink } from "@/components/icons/eywa-icon-compat";
import s from "./overview.module.css";

export function AdmissionsSchedule({
  events,
}: {
  events: OverviewData["calendar"];
}) {
  return (
    <div className={s.notices}>
      {events.map((event) => (
        <div key={event.id} className={s.calendarEvent}>
          <time dateTime={event.startDate}>
            {dashboardDate(event.startDate)}
            <small>{event.startTime?.slice(0, 5) ?? "종일"}</small>
          </time>
          {event.matchedClass ? (
            <WindowLink
              href={`/classes/${event.matchedClass.id}`}
              title={event.matchedClass.name}
              className={s.calendarEventLink}
              ariaLabel={`${event.title} · ${event.matchedClass.name} 수업 상세`}
            >
              <span>{event.title}</span>
              <ExternalLink size={14} aria-hidden />
            </WindowLink>
          ) : (
            <span>{event.title}</span>
          )}
        </div>
      ))}
    </div>
  );
}
