"use client";

import type { RoadmapView } from "@/features/textbooks/book-plans";
import { keyOrdinal, parseKey } from "@/features/textbooks/book-sequence";
import { BookHover } from "./book-hover";
import { TargetEditor } from "./target-editor";
import css from "./plan-card.module.css";

const dot = (date: string) => date.replaceAll("-", ".");
const md = (date: string) => date.slice(5).replace("-", ".");
const ymd = (date: string) => `${date.slice(2, 4)}.${md(date)}`;
const span = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
/** `가우스|중2-2|3` → `중2-2 3권`. */
export const shortBook = (key: string, title: string) => {
  const p = parseKey(key);
  return p ? `${p.level}${p.grade}-${p.sem} ${p.volume}권` : title;
};

/**
 * 전체 목표 — 교재 로드맵 **막대 하나**(원장 2026-10-20 *"교재일정이 어쨌든 전체 목표와 동일하자나 … 하나의 막대그래프에
 * 같이 잘 녹여낼순없는가"*). 가로축 = **날짜**(시작 ~ 중3 11월 말):
 *  · 권마다 칸(폭 = 그 권에 걸리는 날수 — 내신이 끼면 넓다) · 칸 아래 권 이름과 끝나는 날 · 마우스 오버 = 차시별 소단원
 *  · 회색 빗금 = 내신기간(진도 멈춤) — 같은 막대 위에 겹친다
 *  · 검은 선 = 오늘(= 오늘 계획) · 점 = 실제 위치(나간 차시를 계획이 끝냈어야 할 날, `doneDate`)
 *  · 점이 오늘보다 앞이면 그 사이가 **밀린 만큼(빨간 빗금)**, 뒤면 앞선 만큼(옅은 네이비)
 * 남은 수업·기간은 제목 줄 옆에 둔다(원장 *"해당 기간 및 수업을 해당 위치 옆으로"*).
 */
export function RoadmapGoal({ r, studentId, studentName }: { r: RoadmapView; studentId: string; studentName: string }) {
  const first = r.books[0]!, last = r.books[r.books.length - 1]!;
  const done = r.done ?? 0;
  const started = r.status !== "not-started";
  const pos = r.position;
  const now = pos ? `${shortBook(pos.key, pos.title)} ${pos.lessonNo}차시 · ${pos.unit}` : "진도 확인 필요";
  const from = r.startDate, to = r.scheduleEnd;
  const days = Math.max(1, span(from, to));
  const x = (d: string) => Math.max(0, Math.min(100, (span(from, d) / days) * 100));
  const todayX = x(r.referenceDate);
  const doneX = r.doneDate ? x(r.doneDate) : null;
  const posOrd = pos ? keyOrdinal(pos.key) : null;
  const state = (key: string) => (posOrd == null ? "todo" : keyOrdinal(key) < posOrd ? "done" : keyOrdinal(key) === posOrd ? "now" : "todo");
  const pc = (n: number) => `${n}%`;
  return (
    <>
      <div className={css.goalRow}>
        <h4>{r.series} {shortBook(first.key, first.title)} → {shortBook(last.key, last.title)}</h4>
        <span className={css.inlineFacts}>
          {r.remainingClasses != null ? <>남은 수업<b>{r.remainingClasses}회</b></> : null}
          <>기간<b>{dot(r.startDate)} – {dot(r.endDate)}</b></>
        </span>
        <span className={css.right}>
          {r.done == null ? "진도 확인 필요" : <><b>{done}/{r.total}차시</b> · {Math.round((done / Math.max(1, r.total)) * 100)}% · {Math.max(0, r.total - done)}차시 남음</>}
        </span>
      </div>
      {r.examNow ? (
        <p className={css.examNow}>지금 내신기간 · {r.examNow.label} ({md(r.examNow.from)}–{md(r.examNow.to)}) — 이 기간엔 진도 계획이 늘지 않습니다</p>
      ) : null}
      <div className={css.trail}>
        <div className={css.tTrack}>
          {doneX != null ? <span className={css.tFill} style={{ width: pc(started && r.status === "ahead" ? Math.min(doneX, todayX) : doneX) }} /> : null}
          {started && doneX != null && doneX < todayX && r.status === "behind"
            ? <span className={css.tLate} style={{ left: pc(doneX), width: pc(todayX - doneX) }} /> : null}
          {started && doneX != null && doneX > todayX && r.status === "ahead" ? <span className={css.tAhead} style={{ left: pc(todayX), width: pc(doneX - todayX) }} /> : null}
          {r.exams.map((p) => (
            <span key={p.from} className={css.tExam} style={{ left: pc(x(p.from)), width: pc(x(p.to) - x(p.from)) }} />
          ))}
        </div>
        {r.schedule.map((b, i) => {
          const left = x(b.startDate), right = x(b.finishDate > to ? to : b.finishDate);
          const partial = b.byDeadline != null;
          return (
            <BookHover
              key={b.key}
              className={css.tSeg}
              style={{ left: pc(left), width: pc(Math.max(0.4, right - left)) }}
              data-state={state(b.key)}
              data-partial={partial || undefined}
              title={b.title}
              period={`${ymd(b.startDate)} – ${ymd(b.finishDate)} 예정${partial ? ` · ${md(r.deadline!)}까지 ${b.byDeadline}/${b.lessonCount}차시` : ""}`}
              lessonUnits={b.lessonUnits}
              lessonCount={b.lessonCount}
              at={pos?.key === b.key ? pos.lessonNo : null}
              align={i >= r.schedule.length / 2 ? "end" : "start"}
            >
              <i><b>{shortBook(b.key, b.title)}</b><small>{partial ? `${md(r.deadline!)}까지 ${b.byDeadline}/${b.lessonCount}` : `~${md(b.finishDate)}`}</small></i>
            </BookHover>
          );
        })}
        {started && r.referenceDate <= to ? (
          <span className={css.plan} style={{ left: pc(todayX) }}><em>오늘 계획 {r.planned}차시</em></span>
        ) : null}
        {doneX != null ? <span className={css.dot} style={{ left: pc(doneX) }} title={`실제 ${done}차시`} /> : null}
      </div>
      <div className={css.examChips}>
        <span>{ymd(from)} 시작</span>
        {r.exams.length ? <span><i className={css.examKey} />내신기간 · 진도 멈춤</span> : null}
        {r.exams.map((p) => (
          <em key={p.from} data-now={(p.from <= r.referenceDate && r.referenceDate <= p.to) || undefined}>
            {p.label.replace(/^중\d\s/, "")} {ymd(p.from)}–{md(p.to)}
          </em>
        ))}
        <span className={css.chipsEnd}>{ymd(to)}{r.deadline ? " · 중3 11월 말" : ""}</span>
      </div>
      <div className={css.ends}>
        <div><b>현재 위치</b>{now}{pos ? ` (${md(pos.date)})` : ""}</div>
        <div>
          <b>최종 목표</b>
          {last.title} · {dot(last.finishDate)} 완료 예정
          <span className={css.targetNote}>
            {r.target.auto ? (r.deadline ? `자동 · 중3 11월 말(${dot(r.deadline)})까지` : r.deadlinePassed ? "자동 · 중3 11월 말 마감 지남 — 지금 3개월 창 끝" : "자동 · 지금 3개월 창 끝") : "직접 지정"}
            <TargetEditor key={r.target.key} r={r} studentId={studentId} studentName={studentName} />
          </span>
        </div>
      </div>
    </>
  );
}
