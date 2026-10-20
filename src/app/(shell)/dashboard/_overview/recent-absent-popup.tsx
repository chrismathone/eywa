"use client";

import { formatShortKoreanDate } from "@/lib/date-kst";
import type { OverviewData } from "@/features/dashboard/overview/model";
import { NameCell, PopupEmpty, PopupTotal, Tag } from "./kpi-popup-parts";
import s from "./overview.module.css";

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
/** "2026-10-14" → "10/14 화". */
function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))} ${DOW[d.getUTCDay()]}`;
}

type Absent = OverviewData["absent"];

/**
 * 최근 결석 팝업(원장 2026-10-20) — 어제까지 7일 결석을 **학생별 누적 결석 많은 순**으로(서버·과목 필터가 정렬한 그대로),
 * 줄마다 결석한 날·반과 **그 수업을 가르친 선생님**(출결 강사 귀속 — 입력한 사람이 아니다).
 * 세는 단위 = 빠진 수업(같은 반·같은 날은 교시가 여럿이어도 1회). 사전 통보는 숫자에서 빼지 않고 표식으로.
 * 🔑 기간은 **`data.from/to`**(서버가 센 창)에서 만든다 — '어제'·'7일'을 글자로 박으면 카드와 갈릴 수 있다.
 */
export function RecentAbsentPopup({
  data,
  subjectLabels,
  canOpen,
}: {
  data: Absent | null | undefined;
  subjectLabels: Record<string, string>;
  canOpen: boolean;
}) {
  if (!data) return <PopupEmpty>출결 정보를 불러오지 못했습니다.</PopupEmpty>;
  const rows = data.students;
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  const contact = rows.filter((r) => r.unnotified > 0).length;
  return (
    <>
      <PopupTotal label="결석 학생" value={rows.length} unit="명" />
      <p className={s.popupSummary}>
        결석 {total}회 · 연락 필요 {contact}명 · 같은 반·같은 날은 교시가 여럿이어도 1회
      </p>
      {rows.length === 0 ? (
        <PopupEmpty>
          {formatShortKoreanDate(data.from)} ~ {formatShortKoreanDate(data.to)}엔 결석한 학생이 없습니다.
        </PopupEmpty>
      ) : (
        <ul className={s.kpiList}>
          {rows.map((row) => (
            <li key={row.studentId} className="border-line-faint border-b py-1.5">
              <div className="flex items-center gap-2 text-xs">
                <NameCell href={canOpen ? `/students/${row.studentId}?tab=attendance` : null} title={row.name} ariaLabel={`${row.name} 출결 상세`}>
                  {row.name}
                </NameCell>
                <b className="num whitespace-nowrap">{row.count}회</b>
                <span className="flex-1" />
                {row.unnotified > 0 ? <Tag tone="caution">연락 필요</Tag> : <Tag tone="muted">사전 통보</Tag>}
              </div>
              <ul className="text-muted-foreground mt-1 flex flex-col gap-0.5 text-xs">
                {row.absences.map((a) => (
                  <li key={`${a.date}-${a.classId}`} className="flex flex-wrap gap-x-1.5">
                    <span className="num text-foreground whitespace-nowrap">{dayLabel(a.date)}</span>
                    <span>{a.className ?? (a.subject ? (subjectLabels[a.subject] ?? "기타 과목") : "반 모름")}</span>
                    <span aria-hidden>·</span>
                    <span className="text-foreground">{a.teachers.length ? a.teachers.join(" · ") : "담당 모름"}</span>
                    {a.preNotified ? <span>(사전 통보)</span> : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
