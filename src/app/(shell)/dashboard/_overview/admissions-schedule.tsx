"use client";

import type { OverviewData } from "@/features/dashboard/overview/model";
import { dashboardDate } from "@/features/dashboard/overview/display";
import { WindowLink } from "@/components/workspace/window-link";
import { ExternalLink } from "@/components/icons/aywa-icon-compat";
import s from "./overview.module.css";

/**
 * 레벨테스트 및 첫수업 일정 — 제목은 표시용(`displayTitle`: 연결된 원생의 정식 이름으로 바로잡은 것)을 쓰고, 바로잡았으면
 * 마우스 오버에 원래 제목을 남긴다. 링크는 반(첫 수업)이 먼저, 없으면 그 일정의 콜&상담(원장 2026-09-13).
 */
export function AdmissionsSchedule({
  events,
}: {
  events: OverviewData["calendar"];
}) {
  return (
    <div className={s.notices}>
      {events.map((event) => {
        const shown = event.displayTitle ?? event.title;
        const original = shown !== event.title ? `원래 제목: ${event.title}` : undefined;
        const link = event.matchedClass
          ? {
              href: `/classes/${event.matchedClass.id}`,
              title: event.matchedClass.name,
              aria: `${shown} · ${event.matchedClass.name} 수업 상세`,
            }
          : event.matchedConsultation
            ? {
                href: `/enrollment/${event.matchedConsultation.id}`,
                title: `${event.matchedConsultation.name} 콜&상담`,
                aria: `${shown} · ${event.matchedConsultation.name} 콜&상담 상세`,
              }
            : null;
        return (
          <div key={event.id} className={s.calendarEvent}>
            <time dateTime={event.startDate}>
              {dashboardDate(event.startDate)}
              <small>{event.startTime?.slice(0, 5) ?? "종일"}</small>
            </time>
            {link ? (
              // 🔴 WindowLink의 title은 툴팁이 아니라 **창 제목**이다(창 목록·전환기에 뜨고 localStorage에 영속된다) — 원문 제목(전화번호
              // 포함)을 거기 싣지 말 것. 원문은 안쪽 글자의 툴팁으로만.
              <WindowLink
                href={link.href}
                title={link.title}
                className={s.calendarEventLink}
                ariaLabel={link.aria}
              >
                <span title={original}>{shown}</span>
                <ExternalLink size={14} aria-hidden />
              </WindowLink>
            ) : (
              <span title={original}>{shown}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
