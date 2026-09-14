"use client";

import { formatShortKoreanDate } from "@/lib/date-kst";
import { WindowLink } from "@/components/workspace/window-link";
import type { OverviewData } from "@/features/dashboard/overview/model";
import { ABSENT_STATUS_LABEL } from "@/features/dashboard/absent-students";
import { NameCell, PopupEmpty, PopupTotal, Tag } from "./kpi-popup-parts";
import s from "./overview.module.css";

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
            </li>
          ))}
        </ul>
      )}
      <p className={s.footnote}>접수 시각 = 상담이 등록된 시각(QR 접수 포함).</p>
    </>
  );
}

/**
 * 보강예정 팝업(원장 2026-09-14) — 이번 주 보강 예약을 날짜·시각 순으로. 카드와 **같은 배열**(`rows`)이라 숫자가 같다.
 * 지난 요일인데 아직 이행 안 된 줄은 '지남' 표식 — 숨기지 않는다(안 한 보강이 사라지면 안 된다).
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
  return (
    <>
      <PopupTotal label="이번 주 보강 예약" value={rows.length} unit="건" />
      {rows.length === 0 ? (
        <PopupEmpty>이번 주에 잡힌 보강 예약이 없습니다.</PopupEmpty>
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
                {row.periodLabel ? ` · ${row.periodLabel}` : ""}
              </span>
              {row.overdue ? <Tag tone="caution">지남</Tag> : row.makeupDate === today ? <Tag tone="info">오늘</Tag> : null}
            </li>
          ))}
        </ul>
      )}
      <p className={s.footnote}>
        이번 주(월~일) 예약만 셉니다{data.later > 0 ? ` · 다음 주 이후 ${data.later}건은 시간표 보강 탭에서 주를 옮겨 보세요` : ""}.
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
export function LevelTestPopup({ events }: { events: OverviewData["calendar"] | null }) {
  if (!events) return <PopupEmpty>일정을 불러오지 못했습니다.</PopupEmpty>;
  return (
    <>
      <PopupTotal label="오늘 레벨테스트" value={events.length} unit="건" />
      {events.length === 0 ? (
        <PopupEmpty>오늘 레벨테스트 일정이 없습니다.</PopupEmpty>
      ) : (
        <ul className={s.kpiList}>
          {events.map((event) => (
            <li key={event.id} className={s.kpiListRow}>
              <time className={s.kpiTime}>{event.startTime?.slice(0, 5) ?? "종일"}</time>
              {event.matchedConsultation ? (
                // 🔴 WindowLink의 title = 창 제목(영속) — 일정 원문(전화번호)을 싣지 않고 상담 이름만.
                <WindowLink
                  href={`/enrollment/${event.matchedConsultation.id}`}
                  title={`${event.matchedConsultation.name} 콜&상담`}
                  ariaLabel={`${event.displayTitle ?? event.title} · ${event.matchedConsultation.name} 콜&상담 상세`}
                  className={`${s.kpiListMeta} ${s.studentLink}`}
                >
                  <span title={originalTitleNote(event)}>{event.displayTitle ?? event.title}</span>
                </WindowLink>
              ) : (
                <span className={s.kpiListMeta} title={originalTitleNote(event)}>
                  {event.displayTitle ?? event.title}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

type AbsentRow = OverviewData["absent"]["absent"][number];

/** 결석 학생 한 줄 — 반 이름(없으면 과목)과 표식. 일부 교시 결석은 '연락 필요'로 부르지 않는다. */
function AbsentLine({
  row,
  subjectLabels,
  canOpen,
  partial,
}: {
  row: AbsentRow;
  subjectLabels: Record<string, string>;
  canOpen: boolean;
  partial: boolean;
}) {
  const where =
    row.classes.map((c) => c.name).filter(Boolean).join(" · ") ||
    (row.subject ? (subjectLabels[row.subject] ?? "기타 과목") : "");
  return (
    <li className={s.kpiListRow}>
      <NameCell
        href={canOpen ? `/students/${row.studentId}?tab=attendance` : null}
        title={row.name}
        ariaLabel={`${row.name} 출결 상세`}
      >
        {row.name}
      </NameCell>
      <span className={s.kpiListMeta}>{where}</span>
      {row.statuses.includes("excused") ? <Tag tone="muted">{ABSENT_STATUS_LABEL.excused}</Tag> : null}
      {partial ? (
        <Tag tone="muted">일부 교시 결석</Tag>
      ) : row.preNotified ? (
        <Tag tone="muted">사전 통보</Tag>
      ) : (
        <Tag tone="caution">연락 필요</Tag>
      )}
    </li>
  );
}

/**
 * 전일 결석 팝업 — **어제**(원장 2026-09-12) **한 교시도 안 온 학생**(결석·공결)만 센다. 사전 통보는 숫자에서
 * 빼지 않고 표식으로, 일부 교시만 결석한 학생은 세지 않고 아래 '일부 교시 결석' 무리로 따로 보인다
 * (원장 2026-09-11 기본값).
 *
 * 🔑 며칠인지는 **`day.date`**(서버가 조회한 그날)에서 만든다 — '어제'를 글자로 박으면 카드와 갈릴 수 있다.
 *    다이얼로그 머리(`어제 9/11 (금) 결석 학생`)가 이미 그 말을 하므로 아래 합계 줄은 날짜를 되풀이하지 않는다.
 */
export function AbsentPopup({
  day,
  subjectLabels,
  canOpen,
}: {
  day: OverviewData["absent"] | null | undefined;
  subjectLabels: Record<string, string>;
  canOpen: boolean;
}) {
  if (!day) return <PopupEmpty>출결 정보를 불러오지 못했습니다.</PopupEmpty>;
  const rows = day.absent;
  const notified = rows.filter((row) => row.preNotified).length;
  // 연락이 필요한 학생(사전 통보 없음)을 앞에 둔다.
  const sorted = [...rows].sort(
    (a, b) => Number(a.preNotified) - Number(b.preNotified) || a.name.localeCompare(b.name, "ko"),
  );
  const partial = [...day.partial].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return (
    <>
      <PopupTotal label="결석 학생" value={rows.length} unit="명" />
      <p className={s.popupSummary}>
        연락 필요 {rows.length - notified}명 · 사전 통보 {notified}명
      </p>
      {rows.length === 0 ? (
        <PopupEmpty>{formatShortKoreanDate(day.date)}엔 한 교시도 안 온 학생이 없습니다.</PopupEmpty>
      ) : (
        <ul className={s.kpiList}>
          {sorted.map((row) => (
            <AbsentLine key={row.studentId} row={row} subjectLabels={subjectLabels} canOpen={canOpen} partial={false} />
          ))}
        </ul>
      )}
      {partial.length > 0 ? (
        <>
          <p className={s.popupGroup}>
            일부 교시 결석 {partial.length}명 · 다른 교시엔 와서 결석 학생 수에는 넣지 않습니다
          </p>
          <ul className={s.kpiList}>
            {partial.map((row) => (
              <AbsentLine key={row.studentId} row={row} subjectLabels={subjectLabels} canOpen={canOpen} partial />
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
