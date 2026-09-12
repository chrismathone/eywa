"use client";

import { formatShortKoreanDate } from "@/lib/date-kst";
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

/** 금일입테 팝업 — 오늘 레벨테스트(시각 · 제목). 캘린더 메뉴가 없어 링크는 두지 않는다. */
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
              <span className={s.kpiListMeta}>{event.title}</span>
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
