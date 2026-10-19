"use client";

import type { CSSProperties } from "react";
import { LEARNING_LESSON_WIDTH } from "../lib/learning-axis";
import { useMathTextbooks } from "./math-textbook-context";
import rails from "./learning-rails.module.css";
import overview from "./learning-overview.module.css";

/** 계획 대비 판정 — 목표 레일과 같은 너그러움(±1차시 = 계획대로, goal-rail.ts). */
function stateOf(done: number, planned: number): string {
  const gap = done - planned;
  if (Math.abs(gap) <= 1) return "계획대로";
  return gap > 0 ? `${gap}차시 빠름` : `${-gap}차시 느림`;
}

const short = (date: string) => date.slice(5).replace("-", ".");
const volume = (title: string) => title.match(/(\d+)권/)?.[1] ?? "";

/**
 * 교재 3개월 레일 — 주문일+7일부터 3개월 안에 주문한 권 ~ 그 학기 마지막 권을 끝내는 계획과 지금 위치(원장 2026-10-19).
 *
 * 🔴 **전체 목표 레일과 같은 모양**으로 그린다(원장 *"기존 디자인이랑 너무 동떨어짐"*) — `learning-rails.module.css`를
 *    그대로 쓴다: 파랑 1행 = 클래스노트로 실제 나간 보고서의 진도(현재) · 빨강 2행 = 3개월 계획 · 눈금 = 권 경계.
 *    한 차시 폭도 전체 목표 레일과 같은 상한(`LEARNING_LESSON_WIDTH`)을 쓴다.
 * 계산은 서버(`bookWindow`)가 끝내고 여기는 그리기만 한다. 주문 기록이 없는 학생은 아무것도 안 그린다.
 */
export function BookWindowBar({ studentId }: { studentId: string }) {
  const ctx = useMathTextbooks();
  const w = ctx?.windows[studentId];
  if (!w || w.total === 0) return null;
  const first = w.books[0]!.title;
  const last = w.books[w.books.length - 1]!.title;
  const name = w.books.length > 1 ? `${first.replace(/\s*\d+권$/, "")} ${volume(first)}~${volume(last)}권` : first;

  const done = w.done ?? 0;
  const status =
    w.referenceDate < w.startDate ? `${short(w.startDate)} 시작`
      : w.done === null ? "진도 확인 필요"
      : w.referenceDate > w.endDate ? (w.done >= w.total ? "기간 내 완료" : `기간 종료 · ${w.total - w.done}차시 남음`)
      : `기준일 계획 ${w.planned}차시 · ${stateOf(w.done, w.planned)}`;

  // 현재 위치 라벨 — "4권 1차시 · 삼각형에서 평행선 사이의 선분의 길이의 비". 창 앞 권이면 그 권을 말한다.
  const currentLabel = w.position
    ? `${volume(w.position.title)}권 ${w.position.lessonNo}차시 · ${w.position.unit}`
    : "발송된 보고서 진도 확인 필요";
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / w.total) * 100))}%`;
  const ends = w.books.map((b, i) => ({ id: b.id, title: b.title, at: w.books.slice(0, i + 1).reduce((n, x) => n + x.lessons, 0) }));
  const variables = {
    "--current-position": pct(done),
    "--target-position": "100%",
    "--lesson-count": w.total,
    "--scale-lessons": w.total,
    "--lesson-max-width": `${LEARNING_LESSON_WIDTH * 2}px`,
  } as CSSProperties;

  return (
    <div style={{ marginTop: 14 }}>
      <div className={overview.course}>
        <strong>교재 3개월 · {name}</strong>
        <span>
          {short(w.startDate)} – {short(w.endDate)} · {status}
        </span>
      </div>
      <div className={rails.viewport}>
        <div className={rails.rails} style={variables} data-planned>
          <div className={rails.plot}>
            <div
              className={`${rails.annotation} ${rails.currentAnnotation}`}
              title={w.position ? `${w.position.date} 클래스노트 발송 보고서 · ${w.position.title} ${w.position.lessonNo}차시` : undefined}
            >
              <span className={rails.annotationTag}>현재</span>
              <span className={rails.blockName}>{currentLabel}</span>
            </div>
            <div className={`${rails.track} ${rails.currentTrack}`} role="progressbar" aria-label="교재 현재 진도"
              aria-valuemin={0} aria-valuemax={w.total} aria-valuenow={done}>
              <span className={rails.currentFill} />
            </div>
            {w.done !== null ? <span className={rails.currentMarker} aria-hidden="true" /> : null}
            <div className={`${rails.track} ${rails.targetTrack}`} role="img" aria-label={`3개월 계획 ${w.total}차시`}>
              <span className={rails.targetFill} />
            </div>
            {/* 기준일 계획 자리 — 목표 레일의 정거장과 같은 빈 원. */}
            {w.referenceDate >= w.startDate && w.referenceDate <= w.endDate ? (
              <span className={rails.targetMarker} style={{ left: pct(w.planned) }} title={`기준일 계획 ${w.planned}차시`} />
            ) : null}
            {ends.map((e, i) => (
              <span key={e.id} className={rails.targetMarker} data-final={i === ends.length - 1 || undefined}
                style={{ left: pct(e.at) }} title={`${e.title} 끝 · ${e.at}차시`} />
            ))}
            <div className={rails.scale} aria-label="권 눈금">
              {ends.map((e) => (
                <span key={e.id} className={rails.scaleTick} style={{ left: pct(e.at) }}>
                  {volume(e.title)}권
                </span>
              ))}
            </div>
            <div className={`${rails.annotation} ${rails.targetAnnotation}`}>
              <span className={rails.annotationTag}>3개월 목표</span>
              <span className={rails.blockName}>{last} 끝 · {short(w.endDate)}</span>
            </div>
          </div>
          <div className={rails.values} aria-hidden="true">
            <span className={rails.currentValue}>{w.done === null ? "—" : <><b>{w.done}</b><small>차시</small></>}</span>
            <span className={rails.targetValue}><b>{w.total}</b><small>차시 목표</small></span>
          </div>
        </div>
      </div>
    </div>
  );
}
