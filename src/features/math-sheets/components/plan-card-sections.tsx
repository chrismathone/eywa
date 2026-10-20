"use client";

import type { BookWindow } from "@/features/textbooks/book-window";
import { bookSlices, lessonLabelAt, nextLessonLabel, shortDay, volumeOf } from "../lib/plan-card";
import { learningBlockLabel } from "../lib/learning-label";
import css from "./plan-card.module.css";

/**
 * 🔴 교재 3개월 **계획**(오늘 계획·밀린 차시·보완 필요)과 '오늘 기준' 구역은 **숨김**(원장 2026-10-20 BS3O 대조 후
 * *"데이터가 이상하면 현재 숨김처리"*). 까닭 셋 — ① 계획이 주문일부터 고르게 나눈 값이라 9월 내신대비 기간을 몰라
 * 부풀려진다(김수련: 실제 3권 7차시인데 계획 4권 8차시) ② 보고서 진도 글이 같은 주에도 반마다 앞뒤로 오가고 교재 칸과
 * 진도 글이 어긋난다(교재 4권 · 진도 3권 단원) ③ '다음 수업'은 +1차시 추정이고 오늘 수업일을 건너뛴다.
 * 계획 규칙을 바로잡으면 이 값만 true로. 나간 차시(발송 보고서 사실)는 그대로 보인다.
 */
export const SHOW_BOOK_PLAN = false;

const pct = (n: number, total: number) => `${Math.max(0, Math.min(100, (n / Math.max(1, total)) * 100))}%`;
const short = (date: string) => date.slice(5).replace("-", ".");

function windowName(w: BookWindow) {
  const first = w.books[0]!.title;
  const last = w.books[w.books.length - 1]!.title;
  return w.books.length > 1 ? `${first.replace(/\s*\d+권$/, "")} ${volumeOf(first)}~${volumeOf(last)}권` : first;
}

function windowState(w: BookWindow) {
  const done = w.done ?? 0;
  if (w.referenceDate < w.startDate) return { notStarted: true, text: done > 0 ? `${short(w.startDate)} 시작 전 · 먼저 진행 중` : `${short(w.startDate)} 시작`, behind: 0 };
  if (w.done === null) return { notStarted: false, text: "진도 확인 필요", behind: 0 };
  const behind = Math.max(0, w.planned - w.done);
  if (w.referenceDate > w.endDate) return { notStarted: false, text: w.done >= w.total ? "기간 내 완료" : `기간 종료 · ${w.total - w.done}차시 남음`, behind: w.total - w.done };
  return { notStarted: false, text: `오늘 계획 ${w.planned}차시`, behind: behind > 1 ? behind : 0 };
}

/** 교재 3개월 — 권마다 타일, 밀린 차시는 빨간 빗금. */
export function BookSection({ w }: { w: BookWindow }) {
  const st = windowState(w);
  const planned = st.notStarted ? 0 : w.planned;
  // 밀린 칸은 '보완 필요'와 같은 판정일 때만 칠한다(±1차시 = 계획대로 — 타일만 빨간 건 거짓 경보).
  const slices = bookSlices(w.books, w.done ?? 0, SHOW_BOOK_PLAN && st.behind ? planned : 0);
  const atBook = w.position ? w.books.findIndex((b) => b.title === w.position!.title) : -1;
  return (
    <>
      <div className={css.row}><h4>{windowName(w)}</h4><span className={css.right}>{short(w.startDate)} – {short(w.endDate)}</span></div>
      <div className={css.books}>
        {w.books.map((b, i) => {
          const s = slices[i]!;
          const note = i === atBook ? `현재 ${w.position!.lessonNo}차시` : s.done >= b.lessons ? "완료" : s.done === 0 && i > Math.max(0, atBook) ? "다음 교재" : `${s.done}차시 진행`;
          return (
            <div key={b.id} className={css.bk}>
              <div className={css.row}>
                <h5>{volumeOf(b.title)}권{b.unit ? ` · ${b.unit}` : ""}</h5>
                <span className={css.right}><b>{s.done}</b>/{b.lessons}차시</span>
              </div>
              <div className={css.bar} title={s.late ? `밀린 차시 ${s.late}` : undefined}>
                <i style={{ width: pct(s.done, b.lessons) }} />
                {s.late ? <s style={{ left: pct(s.done, b.lessons), width: pct(s.late, b.lessons) }} /> : null}
              </div>
              <small><span>{note}</span><span>{s.late ? <em>{s.late}차시 밀림</em> : `${b.lessons - s.done}차시 남음`}</span></small>
            </div>
          );
        })}
      </div>
      <div className={css.sum}>
        3개월 목표 {w.done ?? "—"}/{w.total}차시 완료
        {SHOW_BOOK_PLAN ? (
          <span>{st.text}{st.behind ? <> · <em>{st.behind}차시 보완 필요</em></> : null}</span>
        ) : (
          <span>{st.notStarted ? st.text : `${short(w.orderDate)} 주문`}</span>
        )}
      </div>
    </>
  );
}

/** 오늘 기준 — 계획 · 실제 · 다음 수업. '수업일 보기'는 학생 집중 보기(수업일 기록)로. */
export function TodaySection({ w, fallbackNow, onOpen }: { w?: BookWindow; fallbackNow: string | null; onOpen: () => void }) {
  const notStarted = w ? w.referenceDate < w.startDate : false;
  const plan = w && !notStarted ? lessonLabelAt(w.books, w.planned) : null;
  const real = w?.position ? `${volumeOf(w.position.title)}권 ${w.position.lessonNo}차시` : null;
  const next = w ? nextLessonLabel(w.books, w.position) : null;
  const ref = w?.referenceDate;
  return (
    <>
      <div className={css.row}>
        <h4>{ref ? `${shortDay(ref)} 기준` : "오늘 기준"}</h4>
        <span className={css.right}>발송된 수업 보고서 기준</span>
      </div>
      <div className={css.tiles}>
        <div className={css.t}><span>오늘 계획</span><b>{plan ?? "—"}</b><small>{w ? (notStarted ? "3개월 기간 시작 전" : "3개월 계획 기준") : "교재 주문 기록 없음"}</small></div>
        <div className={css.t} data-kind="real"><span>실제 위치</span><b>{real ?? (fallbackNow ? learningBlockLabel(fallbackNow) : "—")}</b><small>{w?.position ? `${short(w.position.date)} 보고서` : "수업 보고서 기준"}</small></div>
        <div className={css.t} data-kind="next"><span>다음 수업</span><b>{next ?? "—"}</b><small>{w?.nextClassDate ? `${shortDay(w.nextClassDate)} 수업` : "수업일 미정"}</small></div>
        <button type="button" className={css.open} onClick={onOpen}>수업일 보기</button>
      </div>
    </>
  );
}
