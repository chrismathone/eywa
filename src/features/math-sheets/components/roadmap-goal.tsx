"use client";

import type { RoadmapView } from "@/features/textbooks/book-plans";
import { parseKey } from "@/features/textbooks/book-sequence";
import { BookHover } from "./book-hover";
import { TargetEditor } from "./target-editor";
import css from "./plan-card.module.css";

const pct = (n: number, total: number) => `${Math.max(0, Math.min(100, (n / Math.max(1, total)) * 100))}%`;
const dot = (date: string) => date.replaceAll("-", ".");
const md = (date: string) => date.slice(5).replace("-", ".");
const span = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
/** `가우스|중2-2|3` → `중2-2 3권`. */
export const shortBook = (key: string, title: string) => {
  const p = parseKey(key);
  return p ? `${p.level}${p.grade}-${p.sem} ${p.volume}권` : title;
};

/**
 * 전체 목표 — 교재 로드맵(원장 2026-10-20 *"중3 11월말 까지 3개월당 교재 2권씩 … 자동으로 목표"*).
 * 레일은 차시 눈금이고 **권마다 구간**을 나눠 마우스를 올리면 그 권의 차시별 소단원이 뜬다.
 * 아래 띠는 달력 눈금 — 회색 빗금이 내신기간(진도 계획이 멈추는 날)이다.
 * 남은 수업·기간은 제목 줄 옆에 둔다(원장 *"해당 기간 및 수업을 해당 위치 옆으로"*).
 */
export function RoadmapGoal({ r, studentId, studentName }: { r: RoadmapView; studentId: string; studentName: string }) {
  const first = r.books[0]!, last = r.books[r.books.length - 1]!;
  const done = r.done ?? 0;
  const started = r.status !== "not-started";
  const plan = started ? r.planned : 0;
  const pos = r.position;
  const now = pos ? `${shortBook(pos.key, pos.title)} ${pos.lessonNo}차시 · ${pos.unit}` : "진도 확인 필요";
  const days = Math.max(1, span(r.startDate, r.endDate));
  const at = (d: string) => `${Math.max(0, Math.min(100, (span(r.startDate, d) / days) * 100))}%`;
  // 권마다 레일 위 시작 차시(누적) — 렌더 중에 변수를 다시 쓰지 않게 미리 센다.
  const offsets = r.books.map((_, i) => r.books.slice(0, i).reduce((n, b) => n + b.lessonCount, 0));
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
      <div className={css.rail}>
        {r.books.map((b, i) => {
          const left = offsets[i]!;
          return (
            <BookHover
              key={b.key}
              className={css.seg}
              style={{ left: pct(left, r.total), width: pct(b.lessonCount, r.total) }}
              title={b.title}
              period={`${dot(b.startDate)} – ${dot(b.finishDate)} 예정`}
              lessonUnits={b.lessonUnits}
              lessonCount={b.lessonCount}
              at={pos?.key === b.key ? pos.lessonNo : null}
              align={i >= r.books.length / 2 ? "end" : "start"}
            >
              <i>{shortBook(b.key, b.title)}</i>
            </BookHover>
          );
        })}
        <span className={css.fill} style={{ width: pct(Math.min(done, plan), r.total) }} />
        {started && done < plan ? <span className={css.late} style={{ left: pct(done, r.total), width: pct(plan - done, r.total) }} /> : null}
        {done > plan ? <span className={css.ahead} style={{ left: pct(plan, r.total), width: pct(done - plan, r.total) }} /> : null}
        {started ? <span className={css.plan} style={{ left: pct(plan, r.total) }}><em>오늘 계획 {plan}</em></span> : null}
        {r.done != null ? <span className={css.dot} style={{ left: pct(done, r.total) }} /> : null}
      </div>
      <div className={css.timeline} aria-label="기간과 내신기간">
        {r.exams.map((p) => {
          const a = p.from < r.startDate ? r.startDate : p.from, b = p.to > r.endDate ? r.endDate : p.to;
          return <span key={p.from} className={css.exam} style={{ left: at(a), width: `calc(${at(b)} - ${at(a)})` }} title={`${p.label} ${md(p.from)}–${md(p.to)} · 진도 계획 멈춤`} />;
        })}
        {r.referenceDate >= r.startDate && r.referenceDate <= r.endDate ? <span className={css.today} style={{ left: at(r.referenceDate) }} title={`기준일 ${dot(r.referenceDate)}`} /> : null}
        <small>{md(r.startDate)}</small>
        <small>{r.exams.length ? <><i className={css.examKey} />내신기간 {r.exams.length}회 제외</> : "내신기간 없음"}</small>
        <small>{dot(r.endDate)}</small>
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
