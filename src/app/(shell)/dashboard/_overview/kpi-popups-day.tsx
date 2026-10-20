"use client";

import { formatShortKoreanDate } from "@/lib/date-kst";
import { WindowLink } from "@/components/workspace/window-link";
import type { OverviewData } from "@/features/dashboard/overview/model";
import { windowUntilLabel } from "@/features/dashboard/overview/upcoming-window";
import { rosterOriginLabel } from "@/features/makeups/roster-merge";
import { NameCell, PopupEmpty, PopupTotal, Tag } from "./kpi-popup-parts";
import { isCancelledAdmissionsRow, type todayLevelTestList } from "@/features/dashboard/overview/display";
import { ConsultStageChip } from "./consult-progress";
import { CancelledMark } from "./cancelled-mark";
import s from "./overview.module.css";

type LevelTestList = ReturnType<typeof todayLevelTestList<OverviewData["calendar"][number]>>;

/** 신규문의 팝업 — 오늘 접수(시각 · 이름). */
export function IntakePopup({
  rows,
  canOpen,
}: {
  rows: OverviewData["intake"] | null | undefined;
  canOpen: boolean;
}) {
  if (!rows) return <PopupEmpty>접수 정보를 불러오지 못했습니다.</PopupEmpty>;
  return (
    <>
      <PopupTotal label="오늘 신규문의" value={rows.length} unit="건" />
      {rows.length === 0 ? (
        <PopupEmpty>오늘 접수된 상담이 없습니다.</PopupEmpty>
      ) : (
        <ul className={s.kpiList}>
          {rows.map((row) => (
            <li key={row.id} className={s.kpiListRow}>
              <time className={s.kpiTime}>{row.time ?? "—"}</time>
              <NameCell
                href={canOpen ? `/enrollment/${row.id}` : null}
                title={row.name}
                ariaLabel={`${row.name} 상담 상세`}
              >
                {row.name}
              </NameCell>
              <ConsultStageChip id={row.id} />
            </li>
          ))}
        </ul>
      )}
      <p className={s.footnote}>접수 시각 = 상담이 등록된 시각(QR 접수 포함).</p>
    </>
  );
}

/**
 * 금일 등록 팝업(원장 2026-09-23) — 오늘 콜&상담 '등록 완료'로 옮긴 상담(옮긴 시각 · 이름 · 반 배정 여부).
 * 카드와 **같은 배열**이라 숫자가 같다. 이름은 그 상담으로 간다(콜&상담 권한이 있을 때만).
 */
export function EnrolledTodayPopup({
  rows,
  canOpen,
}: {
  rows: OverviewData["enrolledToday"] | null | undefined;
  canOpen: boolean;
}) {
  if (!rows) return <PopupEmpty>등록 정보를 불러오지 못했습니다.</PopupEmpty>;
  return (
    <>
      <PopupTotal label="오늘 등록 완료" value={rows.length} unit="명" />
      {rows.length === 0 ? (
        <PopupEmpty>오늘 등록 완료로 옮긴 상담이 없습니다.</PopupEmpty>
      ) : (
        <ul className={s.kpiList}>
          {rows.map((row) => (
            <li key={row.id} className={s.kpiListRow}>
              <time className={s.kpiTime}>{row.time ?? "—"}</time>
              <NameCell
                href={canOpen ? `/enrollment/${row.id}` : null}
                title={row.name}
                ariaLabel={`${row.name} 상담 상세`}
              >
                {row.name}
              </NameCell>
              {row.schoolGrade ? <span className={s.kpiListMeta}>{row.schoolGrade}</span> : null}
              {row.assigned ? <Tag tone="info">반 배정 완료</Tag> : <Tag tone="caution">배정 전</Tag>}
            </li>
          ))}
        </ul>
      )}
      <p className={s.footnote}>시각 = 신규 콜&상담에서 등록 완료로 옮긴 때. 반 배정은 칸반의 ‘반 배정 완료’와 같은 기준입니다.</p>
    </>
  );
}

/**
 * 보강예정 팝업(원장 2026-09-14) — **오늘부터 한 달**(원장 2026-09-16) 보강 예약을 날짜·시각 순으로. 카드와 **같은 배열**
 * (`rows`)이라 숫자가 같고, 끝 날짜도 카드와 같은 값(`data.range`)을 읽는다.
 * 지난 날짜인데 아직 이행 안 된 줄은 '지남' 표식 — 숨기지 않는다(안 한 보강이 사라지면 안 된다).
 */
export function MakeupPopup({
  data,
  today,
  canOpen,
}: {
  data: OverviewData["makeup"] | null | undefined;
  today: string;
  canOpen: boolean;
}) {
  if (!data) return <PopupEmpty>보강 예약을 불러오지 못했습니다.</PopupEmpty>;
  const rows = data.rows;
  const until = windowUntilLabel(data.range);
  return (
    <>
      <PopupTotal label={`${until} 보강 예약`} value={rows.length} unit="건" />
      {rows.length === 0 ? (
        <PopupEmpty>오늘부터 {until} 잡힌 보강 예약이 없습니다.</PopupEmpty>
      ) : (
        <ul className={s.kpiList}>
          {rows.map((row) => (
            <li key={row.id} className={s.kpiListRow}>
              <time className={s.kpiTime}>
                {formatShortKoreanDate(row.makeupDate)} {row.slotStart}
              </time>
              <NameCell
                href={canOpen ? `/students/${row.studentId}` : null}
                title={row.name}
                ariaLabel={`${row.name} 학생 상세`}
              >
                {row.name}
              </NameCell>
              <span className={s.kpiListMeta}>
                {row.className} · {row.absenceDate.slice(5).replace("-", "/")} 결석분
                {row.createdByName ? ` · 예약: ${row.createdByName}` : " · 예약자 미상"}
              </span>
              {row.origin === "native" || row.origin === "additional" ? <Tag tone={row.origin === "additional" ? "muted" : "info"}>{rosterOriginLabel(row.origin, "ko")}</Tag> : null}
              {row.overdue ? <Tag tone="caution">지남</Tag> : row.makeupDate === today ? <Tag tone="info">오늘</Tag> : null}
            </li>
          ))}
        </ul>
      )}
      <p className={s.footnote}>
        오늘부터 {until} 잡힌 예약과, 지난 60일 안에 아직 이행 안 된 예약(지남)을 셉니다
        {data.later > 0 ? ` · 그 뒤로 잡힌 ${data.later}건은 시간표 보강 탭에서 주를 옮겨 보세요` : ""}.
        보강일에 출결을 찍으면 예약은 자동으로 이행 처리됩니다.
      </p>
    </>
  );
}

/** 이름을 바로잡은 줄은 원래 제목을 툴팁으로 남긴다(카드와 같다). */
const originalTitleNote = (event: OverviewData["calendar"][number]) =>
  event.displayTitle && event.displayTitle !== event.title ? `원래 제목: ${event.title}` : undefined;

/**
 * 금일입테 팝업 — 오늘 레벨테스트(시각 · 제목). 캘린더 메뉴가 숨김이라 일정 자체로 가는 링크는 없고, 그 일정의 콜&상담이
 * 한 건으로 확정된 줄만 상담 상세로 간다(서버가 콜&상담 권한이 있을 때만 싣는다). 제목은 운영실 일정 카드와 같은 표시용.
 */
export function LevelTestPopup({ list }: { list: LevelTestList | null }) {
  if (!list) return <PopupEmpty>일정을 불러오지 못했습니다.</PopupEmpty>;
  const events = list.rows;
  return (
    <>
      {/* 합계 = 살아 있는 입테만(카드 숫자와 같다). 취소된 일정은 목록에 시간 순서 그대로 줄을 그어 남긴다(원장 2026-09-30). */}
      <PopupTotal label="오늘 레벨테스트" value={list.active.length} unit="건" />
      {events.length === 0 ? (
        <PopupEmpty>오늘 레벨테스트 일정이 없습니다.</PopupEmpty>
      ) : (
        <ul className={s.kpiList}>
          {events.map((event) => (
            <li key={event.id} className={s.kpiListRow}>
              <time className={s.kpiTime}>{event.startTime?.slice(0, 5) ?? "종일"}</time>
              {isCancelledAdmissionsRow(event) ? (
                <>
                  <span className={`${s.kpiListMeta} ${s.eventCancelled}`}>{event.title}</span>
                  <CancelledMark />
                </>
              ) : event.matchedConsultation ? (
                // 🔴 WindowLink의 title = 창 제목(영속) — 일정 원문(전화번호)을 싣지 않고 상담 이름만.
                <WindowLink
                  href={`/enrollment/${event.matchedConsultation.id}`}
                  title={`${event.matchedConsultation.name} 신규 콜&상담`}
                  ariaLabel={`${event.displayTitle ?? event.title} · ${event.matchedConsultation.name} 신규 콜&상담 상세`}
                  className={`${s.kpiListMeta} ${s.studentLink}`}
                >
                  <span title={originalTitleNote(event)}>{event.displayTitle ?? event.title}</span>
                </WindowLink>
              ) : (
                <span className={s.kpiListMeta} title={originalTitleNote(event)}>
                  {event.displayTitle ?? event.title}
                </span>
              )}
              <ConsultStageChip id={event.matchedConsultation?.id} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
