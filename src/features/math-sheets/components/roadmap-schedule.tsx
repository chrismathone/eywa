"use client";

import type { RoadmapView } from "@/features/textbooks/book-plans";
import { keyOrdinal } from "@/features/textbooks/book-sequence";
import { shortBook } from "./roadmap-goal";
import css from "./plan-card.module.css";

const md = (date: string) => date.slice(5).replace("-", ".");
const ymd = (date: string) => `${date.slice(2, 4)}.${md(date)}`;
const span = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * 교재 일정 — 달력 눈금 위에 **권마다 칸**(원장 2026-10-20 *"27년 11월 말까지 나가는 교재는 쭉 뽑아야함"*).
 * 칸 폭 = 그 권에 걸리는 날수(내신기간이 끼면 그만큼 넓다). 아래 얇은 줄이 내신기간(회색 빗금, 진도 멈춤) —
 * 따로 떨어진 띠로 두지 않고 같은 눈금에 붙여, 어느 권이 내신 때문에 늘어났는지 한눈에 보이게
 * (원장 *"내신기간 제외 일자는 … 디자인에 잘 어울어져있지않음"*). 마감에 걸린 권은 점선 칸 + `11.30까지 N/8`.
 */
export function RoadmapSchedule({ r }: { r: RoadmapView }) {
  const from = r.startDate, to = r.scheduleEnd;
  const days = Math.max(1, span(from, to));
  const x = (d: string) => Math.max(0, Math.min(100, (span(from, d < from ? from : d > to ? to : d) / days) * 100));
  const posOrd = r.position ? keyOrdinal(r.position.key) : null;
  const state = (key: string) => posOrd == null ? "todo" : keyOrdinal(key) < posOrd ? "done" : keyOrdinal(key) === posOrd ? "now" : "todo";
  const today = r.referenceDate;
  return (
    <div className={css.sched}>
      <div className={css.schedHead}>
        <b>교재 일정</b>
        <span>{r.schedule.length}권 · {ymd(from)} – {ymd(to)}{r.deadline ? ` · 중3 11월 말(${md(r.deadline)})까지` : ""}</span>
      </div>
      <div className={css.schedBar}>
        {r.schedule.map((b) => {
          const left = x(b.startDate), right = x(b.finishDate > to ? to : b.finishDate);
          const label = shortBook(b.key, b.title);
          const partial = b.byDeadline != null;
          const tip = `${b.title} · ${ymd(b.startDate)} – ${ymd(b.finishDate)} 예정${partial ? ` · 마감까지 ${b.byDeadline}/${b.lessonCount}차시` : ""}`;
          return (
            <div key={b.key} className={css.schedBook} data-state={state(b.key)} data-partial={partial || undefined}
              style={{ left: `${left}%`, width: `${Math.max(0.5, right - left)}%` }} title={tip}>
              <b>{label}</b>
              <small>{partial ? `${md(r.deadline!)}까지 ${b.byDeadline}/${b.lessonCount}` : `~${md(b.finishDate)}`}</small>
            </div>
          );
        })}
        <div className={css.examLane} aria-hidden>
          {r.exams.map((p) => (
            <span key={p.from} style={{ left: `${x(p.from)}%`, width: `${x(p.to) - x(p.from)}%` }} title={`${p.label} ${md(p.from)}–${md(p.to)} · 진도 멈춤`} />
          ))}
        </div>
        {today >= from && today <= to ? <span className={css.schedToday} style={{ left: `${x(today)}%` }} title={`오늘 ${md(today)}`} /> : null}
      </div>
      {r.exams.length ? (
        <div className={css.examChips}>
          <span><i className={css.examKey} />내신기간 · 진도 멈춤</span>
          {r.exams.map((p) => (
            <em key={p.from} data-now={p.from <= today && today <= p.to || undefined}>{p.label.replace(/^중\d\s/, "")} {ymd(p.from)}–{md(p.to)}</em>
          ))}
        </div>
      ) : null}
    </div>
  );
}
