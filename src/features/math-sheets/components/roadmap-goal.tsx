"use client";

import type { RoadmapView } from "@/features/textbooks/book-plans";
import { keyOrdinal, parseKey } from "@/features/textbooks/book-sequence";
import { BookHover } from "./book-hover";
import { TargetEditor } from "./target-editor";
import { examBarParts } from "../lib/exam-bar";
import css from "./plan-card.module.css";

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
 * 제목 아래 사실 칩(남은 수업·기간·목표) — 막대와 겹치는 '현재 위치/최종 목표' 블록은 뺐다(원장 *"중복되는거 빼고"*):
 *  현재 차시는 그 권 칸 이름 옆·점 오버에, 목표 권 변경은 목표 칩 안에. 내신 날짜는 권 칸 오버에만.
 */
export function RoadmapGoal({ r, studentId, studentName }: { r: RoadmapView; studentId: string; studentName: string }) {
  const first = r.books[0]!, last = r.books[r.books.length - 1]!;
  const done = r.done ?? 0;
  const started = r.status !== "not-started";
  const pos = r.position;
  const from = r.startDate, to = r.scheduleEnd;
  const days = Math.max(1, span(from, to));
  const x = (d: string) => Math.max(0, Math.min(100, (span(from, d) / days) * 100));
  const todayX = x(r.referenceDate);
  const doneX = r.doneDate ? x(r.doneDate) : null;
  const posOrd = pos ? keyOrdinal(pos.key) : null;
  const state = (key: string) => (posOrd == null ? "todo" : keyOrdinal(key) < posOrd ? "done" : keyOrdinal(key) === posOrd ? "now" : "todo");
  const pc = (n: number) => `${n}%`;
  const pinNear = doneX != null && Math.abs(doneX - todayX) < 14;
  // 최종 목표 권 — 막대에서 가장 먼저 읽혀야 하는 칸(원장 2026-10-20 *"마지막 교재라는게 가시성이 좀 떨어짐"*).
  // 그 권이 끝나는 날에 깃발 선을 긋고, 목표 뒤 권(마감에 걸린 점선 칸)은 흐리게 한다.
  const targetIdx = r.schedule.findIndex((b) => b.key === r.target.key);
  // 목표 = 11.30에 닿는 권·차시(자동이면 끝 = 마감일). 깃발·제목이 같은 값을 읽는다.
  const goalX = x(r.endDate);
  const goalName = `${shortBook(last.key, last.title)}${r.target.lesson != null ? ` ${r.target.lesson}차시` : ""}`;
  return (
    <>
      <div className={css.goalHead}>
        {/* 목표 권은 제목에서도 막대와 같은 초록 표시(원장 "마지막 교재라는게 가시성이 좀 떨어짐" — 제목 줄 지적). */}
        <h4 className={css.goalTitle}>
          <span>{r.series} {shortBook(first.key, first.title)}</span>
          <span aria-hidden className={css.goalArrow}>→</span>
          <span className={css.goalBook}><small>최종 목표</small>{goalName}</span>
        </h4>
        <span className={css.right}>
          {r.done == null ? "진도 확인 필요" : <><b>{done}/{r.total}차시</b> · {Math.round((done / Math.max(1, r.total)) * 100)}% · {Math.max(0, r.total - done)}차시 남음</>}
        </span>
      </div>
      {/* 사실은 칩으로 나눠 한 줄에 — 제목과 붙어 쭉 이어지면 어디까지가 무엇인지 안 보인다(원장 "구별이 안 가는데"). */}
      <div className={css.factChips}>
        {r.remainingClasses != null ? <span><small>남은 수업</small><b>{r.remainingClasses}회</b></span> : null}
        <span><small>기간</small><b>{ymd(r.startDate)} – {ymd(r.endDate)}</b></span>
        {/* 앞선 만큼만 날짜로(원장 "안내 나갈 필요 없음 … 얼마나 앞서는지만 일자로"). 재계산은 조용히 한다. */}
        {r.aheadLessons ? <span className={css.rebased} title={r.rebased ? "앞서 다음 교재로 넘어가 오늘부터 일정을 다시 폈습니다" : undefined}><b>{r.aheadLessons}차시 앞섬</b></span> : null}
        <span>
          <small>목표</small>
          <b>{r.target.auto ? (r.deadline ? "자동 · 중3 11월 말까지" : r.seriesEnd ? "자동 · 시리즈 마지막 권" : r.deadlinePassed ? "자동 · 마감 지남(지금 3개월 끝)" : "자동 · 지금 3개월 끝") : "직접 지정"}</b>
          <TargetEditor key={r.target.key} r={r} studentId={studentId} studentName={studentName} />
        </span>
      </div>
      <div className={css.trail}>
        <div className={css.tTrack}>
          {doneX != null ? <span className={css.tFill} style={{ width: pc(started && r.status === "ahead" ? Math.min(doneX, todayX) : doneX) }} /> : null}
          {started && doneX != null && doneX < todayX && r.status === "behind"
            ? <span className={css.tLate} style={{ left: pc(doneX), width: pc(todayX - doneX) }} /> : null}
          {started && doneX != null && doneX > todayX && r.status === "ahead" ? <span className={css.tAhead} style={{ left: pc(todayX), width: pc(doneX - todayX) }} /> : null}
          {/* 내신기간은 막대 안에(A안) — 진도·밀림 위는 흰 | 내신기간 |, 앞으로 올 곳은 연보라 칸. */}
          {examBarParts(r.exams, x, doneX, started && r.status === "behind" ? todayX : null).map((p) => (
            <span key={`${p.left}-${p.kind}`} className={css.tExam} data-kind={p.kind} style={{ left: pc(p.left), width: pc(p.width) }}>{p.label}</span>
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
              data-target={b.key === r.target.key || undefined}
              data-after={i > targetIdx || undefined}
              title={b.title}
              period={`${ymd(b.startDate)} – ${ymd(b.finishDate)} 예정${partial ? ` · ${md(r.deadline!)}까지 ${b.byDeadline}/${b.lessonCount}차시` : ""}`}
              notes={r.exams.filter((p) => p.to >= b.startDate && p.from <= b.finishDate)
                .map((p) => `내신 ${p.label.replace(/^중\d\s/, "")} ${ymd(p.from)}–${md(p.to)} · 진도 멈춤`)}
              lessonUnits={b.lessonUnits}
              lessonCount={b.lessonCount}
              at={pos?.key === b.key ? pos.lessonNo : null}
              align={i >= r.schedule.length / 2 ? "end" : "start"}
            >
              <i><b>{shortBook(b.key, b.title)}{pos?.key === b.key ? ` · ${pos.lessonNo}차시` : ""}</b><small>{partial ? `${md(r.deadline!)}까지 ${b.byDeadline}/${b.lessonCount}` : `~${md(b.finishDate)}`}</small></i>
            </BookHover>
          );
        })}
        {started && r.referenceDate <= to ? (
          <span className={css.plan} style={{ left: pc(todayX) }}>
            {/* 현재 핀 꼬리표와 가까우면 글자만 감춘다(선은 남는다) — 둘이 겹쳐 둘 다 안 읽히는 것보다 낫다. */}
            {pinNear ? null : <em>오늘 계획 {r.planned}차시</em>}
          </span>
        ) : null}
        <span className={css.goalFlag} data-end={goalX > 85 || undefined} data-near={(started && Math.abs(goalX - todayX) < 18) || undefined} style={{ left: pc(goalX) }}>
          <em>최종 목표 · {ymd(r.endDate)}</em>
        </span>
        {/* 현재 위치 = 핀(A안, 원장 2026-10-20 "동그라미 A안으로") — 네이비 꼬리표 + 흰 테두리 점. 막대 색(네이비·빨강) 경계에 묻히지 않게. */}
        {doneX != null ? (
          <span className={css.pin} style={{ left: pc(doneX) }} title={pos ? `${shortBook(pos.key, pos.title)} ${pos.lessonNo}차시 · ${pos.unit} (${md(pos.date)} 보고서)` : undefined}>
            <span className={css.pinDot} />
            <span className={css.pinTag} data-edge={doneX > 88 ? "end" : doneX < 8 ? "start" : undefined}>현재 · {pos ? `${shortBook(pos.key, pos.title)} ${pos.lessonNo}차시` : `${done}차시`}</span>
          </span>
        ) : null}
      </div>
      {/* 내신기간은 알리기만 — 날짜는 권 칸에 마우스를 올리면 그 권에 걸린 것만(원장 "기간은 교재 호버하면 거기 안에"). */}
      <p className={css.legend}>
        <span><i className={css.examKey} data-kind="open" />내신기간 · 진도 멈춤</span>
        <span><i className={css.examKey} data-kind="filled" />지난 진도 위 내신</span>
        <span><i className={css.examKey} data-kind="late" />밀린 구간</span>
        {r.examNow ? <em>지금 {r.examNow.label.replace(/^중\d\s/, "")} 기간</em> : null}
        <span className={css.legendEnd}>교재 칸에 마우스를 올리면 차시·내신 날짜</span>
      </p>
    </>
  );
}
