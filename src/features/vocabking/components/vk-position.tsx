import type { VocabkingReport } from "../model";
import { SCORE_LEVELS } from "../bands";

/**
 * 보카킹 리포트 **머리 + ① 현재 학습 위치**. 순수 프레젠테이션(훅·"use client" 없음).
 * 🔴 총 응시 인원은 그리지 않는다(원장 2026-10-07 *"1위 옆에 총원 몇명인지는 지워줘"*) — 석차와 상위 %만.
 */
const signed = (n: number) => `${n > 0 ? "+" : ""}${n}점`;

export function VkHeader({ report }: { report: VocabkingReport }) {
  const h = report.header;
  return (
    <header className="border-line flex flex-wrap items-end justify-between gap-4 border-b-2 pb-4">
      <div className="min-w-0">
        <p className="text-primary text-xs font-bold tracking-wide">VOCABKING · 종합평가 리포트</p>
        <h1 className="text-foreground mt-1 text-2xl font-bold">{h.deckName}</h1>
        <p className="text-text-dim mt-1 text-sm">어휘 평가와 학습 데이터를 분석해 현재 위치와 다음 학습 방향을 정리했습니다.</p>
      </div>
      <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-sm">
        <dt className="text-text-dim">이름</dt>
        <dd className="text-foreground font-bold">{h.name}</dd>
        {h.grade ? (
          <>
            <dt className="text-text-dim">학년</dt>
            <dd className="text-foreground font-bold">{h.grade}</dd>
          </>
        ) : null}
        {h.date ? (
          <>
            <dt className="text-text-dim">응시일</dt>
            <dd className="num text-foreground font-bold">{h.date.replaceAll("-", ".")}</dd>
          </>
        ) : null}
      </dl>
    </header>
  );
}

export function VkPosition({ report }: { report: VocabkingReport }) {
  const p = report.position;
  return (
    <section className="grid gap-4 @lg:grid-cols-[13rem_minmax(0,1fr)_15rem]">
      <div className="bg-primary text-primary-foreground flex flex-col items-center justify-center gap-2 rounded-2xl px-4 py-5">
        {p.rank !== null ? (
          <>
            <p className="text-xs opacity-85">전체 응시자 중</p>
            <p className="num text-5xl leading-none font-bold">
              {p.rank}
              <span className="text-2xl">위</span>
            </p>
            {p.band ? <p className="bg-amber-soft text-amber rounded-full px-3 py-1 text-sm font-bold">{p.band}</p> : null}
          </>
        ) : (
          <>
            <p className="text-xs opacity-85">점수</p>
            <p className="num text-5xl leading-none font-bold">{report.score.score}</p>
            <p className="text-xs opacity-85">석차 정보가 없습니다</p>
          </>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="bg-green-soft text-green rounded-full px-3 py-1 text-xs font-bold">① 현재 학습 위치</span>
          <span className="text-text-dim text-sm font-bold">
            {report.header.grade ? `${report.header.grade} · ` : ""}Lv.{p.level.level} {p.level.label}
          </span>
        </div>
        <p className="text-foreground text-lg font-bold">
          점수 <span className="num text-primary text-3xl">{report.score.score}</span>
          <span className="text-text-dim text-sm font-medium">
            {" "}
            · {report.score.total}문제 중 {report.score.correct}개
            {p.topPercent !== null ? ` · 상위 ${p.topPercent}%` : ""}
          </span>
        </p>
        {p.comparisons.length ? (
          <div className="grid grid-cols-1 gap-2 @md:grid-cols-3">
            {p.comparisons.map((c) => (
              <div key={c.key} className="border-line rounded-xl border px-3 py-2.5 text-center">
                <p className="text-text-dim text-xs font-medium">{c.label}</p>
                <p className={`num text-xl font-bold ${c.diff >= 0 ? "text-primary" : "text-text-dim"}`}>{signed(c.diff)}</p>
                <p className="text-text-faint text-xs">평균 {c.avg}점</p>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-text-dim text-xs font-bold">우리 아이의 현재 위치</p>
        <p className="text-foreground text-2xl font-bold">{p.band ?? `Lv.${p.level.level} ${p.level.label}`}</p>
        <ol className="mt-1 grid grid-cols-5 gap-1" aria-label={`레벨 ${p.level.level}단계 (5단계 중)`}>
          {SCORE_LEVELS.map((l) => {
            const on = l.level === p.level.level;
            return (
              <li key={l.level} className="flex flex-col items-center gap-1">
                <span className={`h-2 w-full rounded-full ${l.level <= p.level.level ? "bg-green" : "bg-bg-soft"}`} />
                <span className={`text-xs ${on ? "text-green font-bold" : "text-text-faint"}`}>Lv.{l.level}</span>
                <span className={`text-xs ${on ? "text-green font-bold" : "text-text-faint"}`}>{l.label}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
