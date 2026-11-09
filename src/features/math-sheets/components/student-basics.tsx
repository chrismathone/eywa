"use client";

import { useSubjectMaps } from "@/features/owner/operations-context";
import type { StudentBasics as Basics } from "../lib/student-basics";
import css from "./student-basics.module.css";

const dateLabel = (date: string) => date.replaceAll("-", ".");

export function StudentBasics({ info, studentName, identity }: { info?: Basics; studentName: string; identity?: string }) {
  const { labelOf } = useSubjectMaps();
  if (!info) return null;
  return (
    <section className={css.root} aria-label={`${studentName} 수강 기본정보`}>
      <div className={css.heading}>
        {identity ? <strong className={css.identity}>{identity}</strong> : null}
        <span className={css.summary} data-unavailable={info.status === "unavailable" || undefined}>{info.summary}</span>
        <span className={css.asOf}>현재 수강 · {dateLabel(info.asOf)} 기준</span>
      </div>
      {info.status === "unavailable" ? <p className={css.notice}>수강정보를 불러오지 못했습니다. 새로고침해 주세요.</p> : (
        <div className={css.subjects}>
          {info.subjects.map(subject => (
            <div key={subject.subject} className={css.subject} data-subject={subject.subject}>
              <b className={css.subjectName}>{labelOf(subject.subject)}</b>
              {subject.state === "none" ? <span className={css.muted}>현재 미수강</span> : <>
                <span>{subject.state === "paused" ? "휴원 · " : ""}{subject.startedOn
                  ? <><time dateTime={subject.startedOn}>{dateLabel(subject.startedOn)}</time>{subject.state === "upcoming" ? " 시작 예정" : "부터"}</>
                  : "시작일 확인 필요"}</span>
                <span className={css.teacher}>{subject.state === "upcoming" ? "예정 담임" : "담임"} <strong>{subject.teachers.join(" · ")}</strong></span>
              </>}
              {subject.firstRecordedOn && subject.firstRecordedOn !== subject.startedOn ? <span className={css.first}>최초 기록 {dateLabel(subject.firstRecordedOn)}</span> : null}
            </div>
          ))}
        </div>
      )}
      <p className={css.note}>영어·수학 수강기록 자동 반영 · 반 이동 전 기간 포함 · 휴원 기간 포함</p>
    </section>
  );
}
