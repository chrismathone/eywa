"use client";

import { useMathTextbooks } from "./math-textbook-context";
import local from "./math-textbook.module.css";

/** 계획 대비 판정 — 목표 레일과 같은 너그러움(±1차시 = 계획대로, goal-rail.ts). */
function toneOf(done: number, planned: number): { tone: "behind" | "on" | "ahead"; label: string } {
  const gap = done - planned;
  if (Math.abs(gap) <= 1) return { tone: "on", label: "계획대로" };
  return gap > 0 ? { tone: "ahead", label: `${gap}차시 빠름` } : { tone: "behind", label: `${-gap}차시 느림` };
}

const short = (date: string) => date.slice(5).replace("-", ".");

/**
 * 교재 3개월 바 — 주문일+7일부터 3개월 안에 주문한 권 ~ 그 학기 마지막 권을 끝내는 계획과 지금 위치(원장 2026-10-19).
 * 계산은 서버(`bookWindow`)가 끝내고 여기는 그리기만 한다. 주문 기록이 없는 학생은 아무것도 안 그린다.
 */
export function BookWindowBar({ studentId }: { studentId: string }) {
  const ctx = useMathTextbooks();
  const w = ctx?.windows[studentId];
  if (!w || w.total === 0) return null;
  const first = w.books[0]!.title;
  const last = w.books[w.books.length - 1]!.title;
  const name = w.books.length > 1 ? `${first.replace(/\s*\d+권$/, "")} ${volume(first)}~${volume(last)}권` : first;
  const state =
    w.referenceDate < w.startDate
      ? { tone: undefined, label: `${short(w.startDate)} 시작` }
      : w.done === null
        ? { tone: undefined, label: "진도 확인 필요" }
        : w.referenceDate > w.endDate
          // 3개월이 지났다 — 다 끝냈으면 완료, 아니면 남은 차시를 말한다(계획 대비 '느림'보다 사실이 분명하다).
          ? w.done >= w.total
            ? { tone: "on" as const, label: "기간 내 완료" }
            : { tone: "behind" as const, label: `기간 종료 · ${w.total - w.done}차시 남음` }
          : toneOf(w.done, w.planned);
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / w.total) * 100))}%`;
  // 권 경계 = 앞 권들의 차시 누적(마지막 권 뒤는 끝이라 선이 없다).
  const edges = w.books.slice(0, -1).map((b, i) => ({ id: b.id, at: w.books.slice(0, i + 1).reduce((n, x) => n + x.lessons, 0) }));
  return (
    <div className={local.window} title={w.position ? `${w.position.date} 보고서 진도: ${w.position.unit} (${w.position.title})` : undefined}>
      <div className={local.windowHead}>
        <span className={local.windowTag}>교재 3개월</span>
        <strong>{name}</strong>
        <span>
          {short(w.startDate)} ~ {short(w.endDate)} · 주문 {short(w.orderDate)}
        </span>
        <span className={local.windowState} data-tone={state.tone}>
          {w.done ?? "—"}/{w.total}차시 · 계획 {w.planned} · {state.label}
        </span>
      </div>
      <div className={local.track} role="img" aria-label={`${name} ${w.done ?? 0}/${w.total}차시, 계획 ${w.planned}차시`}>
        {w.done ? <div className={local.fill} style={{ width: pct(w.done) }} /> : null}
        {edges.map((e) => (
          <div key={e.id} className={local.divider} style={{ left: pct(e.at) }} />
        ))}
        <div className={local.plan} style={{ left: pct(w.planned) }} />
      </div>
      {w.books.length > 1 ? (
        <div className={local.volumes}>
          {w.books.map((b) => (
            <span key={b.id} style={{ width: pct(b.lessons) }}>
              {volume(b.title)}권 · {b.lessons}차시
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function volume(title: string): string {
  return title.match(/(\d+)권/)?.[1] ?? "";
}
