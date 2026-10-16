"use client";

import type { OverviewData } from "@/features/dashboard/overview/model";
import {
  admissionsListKind,
  dashboardDate,
  isCancelledAdmissionsRow,
} from "@/features/dashboard/overview/display";
import { WindowLink } from "@/components/workspace/window-link";
import { ExternalLink } from "@/components/icons/aywa-icon-compat";
import { CancelledMark } from "./cancelled-mark";
import { ConsultStageChip } from "./consult-progress";
import s from "./overview.module.css";

/**
 * 레벨테스트 및 첫수업 일정 — 제목은 표시용(`displayTitle`: 연결된 원생의 정식 이름으로 바로잡은 것)을 쓰고, 바로잡았으면
 * 마우스 오버에 원래 제목을 남긴다. 링크는 반(첫 수업)이 먼저, 없으면 그 일정의 콜&상담(원장 2026-09-13).
 * 취소된 일정은 **시간 순서 그대로** 줄을 긋고 '취소' 표식을 단다(원장 2026-09-30) — 열 머리 건수엔 안 들고 옆에 "취소 N"만.
 */
export function AdmissionsSchedule({
  events,
  limit,
}: {
  events: OverviewData["calendar"];
  limit?: number;
}) {
  const columns = [
    { kind: "levelTest", label: "입학 테스트" },
    { kind: "firstClass", label: "첫 수업" },
  ] as const;
  return (
    <div className={s.admissionsColumns}>
      {columns.map(({ kind, label }) => {
        const items = events.filter((event) => admissionsListKind(event) === kind);
        const cancelled = items.filter(isCancelledAdmissionsRow).length;
        const active = items.length - cancelled;
        return (
          <section key={kind} aria-label={label} className={s.admissionsColumn}>
            <h3 className={s.admissionsHeading}>
              {label}
              <span>{active}건{cancelled > 0 ? ` · 취소 ${cancelled}` : ""}</span>
            </h3>
            <AdmissionEvents events={limit === undefined ? items : items.slice(0, limit)} />
            {items.length === 0 && events.length > 0 ? <p className={s.empty}>예정된 {label}이 없습니다.</p> : null}
            {limit !== undefined && items.length > limit ? <p className={s.admissionsMore}>외 {items.length - limit}건</p> : null}
          </section>
        );
      })}
    </div>
  );
}

function AdmissionEvents({ events }: { events: OverviewData["calendar"] }) {
  return (
    <div className={s.notices}>
      {events.map((event) => {
        if (isCancelledAdmissionsRow(event)) {
          // 취소 = 목록에 줄만 긋는다. 반·콜&상담 링크와 단계 칩은 붙이지 않는다(서버도 싣지 않는다).
          return (
            <div key={event.id} className={s.calendarEvent} data-cancelled="">
              <time dateTime={event.startDate}>
                {dashboardDate(event.startDate)}
                <small>{event.startTime?.slice(0, 5) ?? "종일"}</small>
                <CancelledMark />
              </time>
              <span className={s.eventCancelled}>{event.title}</span>
            </div>
          );
        }
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
                title: `${event.matchedConsultation.name} 신규 콜&상담`,
                aria: `${shown} · ${event.matchedConsultation.name} 신규 콜&상담 상세`,
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
            {/* 그 일정의 콜&상담이 지금 어느 단계인지(원장 2026-09-22) — 연결된 상담이 있을 때만 · **입학 테스트 줄만**.
                첫 수업 줄엔 붙이지 않는다(원장 2026-10-16 *"첫 수업 건에도 상담 완료 입테 끝이 붙어있는건 좀 이상해. 여기 라벨은 지워도 될듯"* —
                첫 수업이 잡혔으면 상담·입테는 이미 지난 단계라 덧말이다). */}
            {event.kind !== "firstClass" && <ConsultStageChip id={event.matchedConsultation?.id} />}
          </div>
        );
      })}
    </div>
  );
}
